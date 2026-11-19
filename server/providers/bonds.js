// Bond market data from official sources:
//  - PHEI (Indonesia Bond Pricing Agency): government yield curve (IGSYC), fair prices & yields
//    for benchmark FR/PBS series and tradable retail ORI/SR, corporate yields by rating
//  - US Treasury (par curve) and TreasuryDirect (security details by CUSIP)
//  - ECB (euro-area AAA curve), Deutsche Bundesbank (Bunds), Japan Ministry of Finance (JGBs),
//    Bank of Canada (GoC benchmarks)
//  - ECB reference rates via Frankfurter for historical exchange rates
import { getText, getJSON, browserHeaders, HttpError } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseCSV } from '../lib/csv.js';
import { stripTags } from '../lib/xml.js';
import { treasuryCurve } from './macro.js';

const UA = { 'User-Agent': 'FinTerm/1.0 (+personal finance terminal)', Accept: '*/*' };
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// "93,8805" -> 93.8805 ; "1.234,5" -> 1234.5
export const idNum = (s) => {
  const t = String(s ?? '').trim().replace(/ /g, '');
  if (!t || t === '-') return null;
  const n = Number(t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ---- PHEI --------------------------------------------------------------------------
function parseTables(html) {
  // Returns tables in document order with the nearest preceding <h6> title.
  const out = [];
  const re = /<h6[^>]*>([\s\S]*?)<\/h6>|<table[^>]*>([\s\S]*?)<\/table>/gi;
  let title = '';
  let m;
  while ((m = re.exec(html))) {
    if (m[1] != null) {
      title = stripTags(m[1]);
      continue;
    }
    const rows = [];
    for (const tr of m[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => ({ th: c[1] === 'h', text: stripTags(c[2].replace(/<br\s*\/?>/gi, ' ')) }));
      if (cells.length) rows.push(cells);
    }
    out.push({ title, rows });
  }
  return out;
}

export function parsePhei(html) {
  const asOfM = /per\s+(\d{1,2})-([A-Za-z]+)-(\d{4})/.exec(html);
  const asOf = asOfM && MONTHS[asOfM[2].toLowerCase()] ? `${asOfM[3]}-${String(MONTHS[asOfM[2].toLowerCase()]).padStart(2, '0')}-${asOfM[1].padStart(2, '0')}` : null;
  const curve = [];
  const series = [];
  const corporate = [];
  for (const t of parseTables(html)) {
    // Tables have blank spacer cells at both ends of each row: drop them so columns line up.
    const trim = (cells) => cells.filter((x, i, a) => !(x === '' && (i === 0 || i === a.length - 1)));
    const header = trim((t.rows.find((r) => r.some((c) => c.th)) || []).map((c) => c.text.toLowerCase()));
    const body = t.rows.filter((r) => !r.some((c) => c.th)).map((r) => trim(r.map((c) => c.text)));
    if (header.includes('tenor year') && header.includes('today')) {
      for (const [tenor, today, yesterday] of body) if (idNum(tenor) != null) curve.push({ years: idNum(tenor), yield: idNum(today), prev: idNum(yesterday) });
    } else if (header.includes('series') && header.some((h) => h.startsWith('today yield'))) {
      const group = /sbsn/i.test(t.title) ? 'SBSN benchmark (sukuk)' : /retail/i.test(t.title) ? 'Retail (tradable)' : 'SBN benchmark';
      for (const r of body) {
        const [code, ttm, y, p, py, pp, cpn] = r;
        if (!/^[A-Z]{2,4}\d/.test(code || '')) continue;
        series.push({ series: code, group, ttm: idNum(ttm), yield: idNum(y), price: idNum(p), prevYield: idNum(py), prevPrice: idNum(pp), coupon: idNum(cpn) });
      }
    } else if (header.some((h) => h.startsWith('tenor')) && header.includes('aaa')) {
      const cols = header.slice(1);
      for (const r of body) {
        const row = { years: idNum(r[0]) };
        cols.forEach((c, i) => (row[c.toUpperCase()] = idNum(r[i + 1])));
        if (row.years != null) corporate.push(row);
      }
    }
  }
  curve.sort((a, b) => a.years - b.years);
  return { asOf, curve, series, corporate };
}

export async function pheiData() {
  return cached('phei:hpw', 60 * 60e3, async () => {
    const html = await getText('https://www.phei.co.id/Data/HPW-dan-Imbal-Hasil', { headers: browserHeaders({ Accept: 'text/html' }), timeout: 25000 });
    const d = parsePhei(html);
    if (!d.curve.length) throw new HttpError('Could not read the PHEI yield curve', { status: 502 });
    return { ...d, source: 'PHEI — Penilai Harga Efek Indonesia (Indonesia Bond Pricing Agency)', sourceUrl: 'https://www.phei.co.id/Data/HPW-dan-Imbal-Hasil' };
  });
}

// ---- global government curves -----------------------------------------------------------
const pt = (label, years, value, prev) => ({ label, years, yield: value, prev: prev ?? null });
// Dot-decimal ("1.672") and comma-decimal ("3,43") parsers for the non-Indonesian sources.
const dotNum = (s) => (s == null || String(s).trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : null);
const commaNum = (s) => dotNum(String(s ?? '').replace(',', '.'));

async function usCurve() {
  const y = await treasuryCurve();
  const keys = { '1 Mo': 1 / 12, '3 Mo': 0.25, '6 Mo': 0.5, '1 Yr': 1, '2 Yr': 2, '3 Yr': 3, '5 Yr': 5, '7 Yr': 7, '10 Yr': 10, '20 Yr': 20, '30 Yr': 30 };
  return {
    country: 'United States', code: 'US', asOf: y.latest.date, source: 'U.S. Treasury (par yields)',
    points: Object.entries(keys).filter(([k]) => y.latest.yields[k] != null).map(([k, yrs]) => pt(k.replace(' Mo', 'M').replace(' Yr', 'Y'), yrs, y.latest.yields[k], y.previous?.yields?.[k])),
  };
}

async function idCurve() {
  const d = await pheiData();
  const want = [0.1, 1, 2, 3, 5, 7, 10, 15, 20, 30];
  return { country: 'Indonesia', code: 'ID', asOf: d.asOf, source: 'PHEI IGSYC (IDR government bonds)', points: d.curve.filter((p) => want.includes(p.years)).map((p) => pt(p.years < 1 ? `${Math.round(p.years * 12)}M` : `${p.years}Y`, p.years, p.yield, p.prev)), full: d.curve };
}

async function euroCurve() {
  const tenors = { SR_3M: 0.25, SR_1Y: 1, SR_2Y: 2, SR_5Y: 5, SR_10Y: 10, SR_20Y: 20, SR_30Y: 30 };
  const csv = await getText(`https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.${Object.keys(tenors).join('+')}?lastNObservations=2&format=csvdata`, { headers: UA, timeout: 20000 });
  const rows = parseCSV(csv);
  const h = rows.shift();
  const iT = h.indexOf('DATA_TYPE_FM');
  const iD = h.indexOf('TIME_PERIOD');
  const iV = h.indexOf('OBS_VALUE');
  const by = {};
  for (const r of rows) (by[r[iT]] ||= []).push({ d: r[iD], v: Number(r[iV]) });
  let asOf = '';
  const points = Object.entries(tenors).map(([k, yrs]) => {
    const obs = (by[k] || []).sort((a, b) => a.d.localeCompare(b.d));
    asOf = obs.at(-1)?.d || asOf;
    return pt(k.replace('SR_', ''), yrs, obs.at(-1)?.v ?? null, obs.at(-2)?.v);
  });
  return { country: 'Euro area (AAA)', code: 'EA', asOf, source: 'ECB AAA government yield curve (spot rates)', points: points.filter((p) => p.yield != null) };
}

async function germanyCurve() {
  const tenors = { R02XX: 2, R05XX: 5, R10XX: 10, R30XX: 30 };
  const results = await Promise.all(
    Object.entries(tenors).map(async ([k, yrs]) => {
      const csv = await getText(`https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.${k}.R.A.A._Z._Z.A?lastNObservations=2&format=csv`, { headers: UA, timeout: 20000 });
      const obs = csv.split(/\r?\n/).map((l) => l.split(';')).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && commaNum(r[1]) != null);
      return { k, yrs, obs };
    }),
  );
  let asOf = '';
  const points = results.map(({ yrs, obs }) => {
    asOf = obs.at(-1)?.[0] || asOf;
    return pt(`${yrs}Y`, yrs, commaNum(obs.at(-1)?.[1]), commaNum(obs.at(-2)?.[1]));
  });
  return { country: 'Germany', code: 'DE', asOf, source: 'Deutsche Bundesbank (Bund yield curve)', points: points.filter((p) => p.yield != null) };
}

async function japanCurve() {
  const parse = (txt) =>
    parseCSV(txt)
      .filter((r) => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(r[0]))
      .map((r) => r);
  let csv = await getText('https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv', { headers: UA, timeout: 20000 });
  let header = parseCSV(csv).find((r) => r[0] === 'Date');
  let rows = parse(csv);
  if (rows.length < 2) {
    csv = await getText('https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv', { headers: UA, timeout: 30000 });
    header = parseCSV(csv).find((r) => r[0] === 'Date');
    rows = parse(csv);
  }
  const [prev, last] = rows.slice(-2);
  const want = ['1Y', '2Y', '5Y', '10Y', '20Y', '30Y', '40Y'];
  const d = last[0].split('/');
  return {
    country: 'Japan', code: 'JP', asOf: `${d[0]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}`, source: 'Ministry of Finance Japan (JGB yields)',
    points: want.map((w) => {
      const i = header.indexOf(w);
      return pt(w, Number(w.replace('Y', '')), dotNum(last[i]), dotNum(prev?.[i]));
    }).filter((p) => p.yield != null),
  };
}

async function canadaCurve() {
  const ser = { 'BD.CDN.2YR.DQ.YLD': [2, '2Y'], 'BD.CDN.5YR.DQ.YLD': [5, '5Y'], 'BD.CDN.10YR.DQ.YLD': [10, '10Y'], 'BD.CDN.LONG.DQ.YLD': [30, 'Long'] };
  const j = await getJSON(`https://www.bankofcanada.ca/valet/observations/${Object.keys(ser).join(',')}/json?recent=3`, { headers: UA, timeout: 20000 });
  const obs = (j.observations || []).sort((a, b) => a.d.localeCompare(b.d));
  const last = obs.at(-1);
  const prev = obs.at(-2);
  return {
    country: 'Canada', code: 'CA', asOf: last?.d, source: 'Bank of Canada (benchmark bond yields)',
    points: Object.entries(ser).map(([k, [yrs, label]]) => pt(label, yrs, dotNum(last?.[k]?.v), dotNum(prev?.[k]?.v))).filter((p) => p.yield != null),
  };
}

export async function globalCurves() {
  return cached('bonds:curves', 60 * 60e3, async () => {
    const jobs = { US: usCurve, ID: idCurve, EA: euroCurve, DE: germanyCurve, JP: japanCurve, CA: canadaCurve };
    const res = await Promise.allSettled(Object.values(jobs).map((f) => f()));
    const curves = [];
    const errors = {};
    Object.keys(jobs).forEach((k, i) => (res[i].status === 'fulfilled' ? curves.push(res[i].value) : (errors[k] = res[i].reason.message)));
    if (!curves.length) throw new HttpError('No yield-curve source reachable', { status: 502 });
    return { curves, errors };
  });
}

// Linear interpolation on a curve's points (years -> yield).
export function interpolate(points, years) {
  const p = [...points].filter((x) => x.yield != null).sort((a, b) => a.years - b.years);
  if (!p.length) return null;
  if (years <= p[0].years) return p[0].yield;
  if (years >= p.at(-1).years) return p.at(-1).yield;
  for (let i = 1; i < p.length; i++) {
    if (years <= p[i].years) {
      const t = (years - p[i - 1].years) / (p[i].years - p[i - 1].years);
      return p[i - 1].yield + t * (p[i].yield - p[i - 1].yield);
    }
  }
  return null;
}

// ---- TreasuryDirect: US Treasury security by CUSIP ----------------------------------------
export async function treasuryByCusip(cusip) {
  const c = String(cusip).toUpperCase();
  if (!/^[0-9A-Z]{9}$/.test(c)) throw new HttpError('A CUSIP has 9 letters/digits', { status: 400 });
  return cached(`td:${c}`, 24 * 3600e3, async () => {
    const list = await getJSON(`https://www.treasurydirect.gov/TA_WS/securities/search?cusip=${c}&format=json`, { headers: UA, timeout: 20000 });
    if (!Array.isArray(list) || !list.length) throw new HttpError(`No US Treasury security with CUSIP ${c}`, { status: 404 });
    const auctions = list
      .map((s) => ({
        auctionDate: (s.auctionDate || s.competitiveAuctionCloseDate || '').slice(0, 10),
        issueDate: (s.issueDate || '').slice(0, 10),
        reopening: s.reopening === 'Yes',
        highYield: dotNum(s.highYield) ?? dotNum(s.highDiscountRate) ?? dotNum(s.highInvestmentRate),
        price: dotNum(s.pricePer100) ?? dotNum(s.highPrice),
        bidToCover: dotNum(s.bidToCoverRatio),
        offering: dotNum(s.offeringAmount),
      }))
      .sort((a, b) => a.auctionDate.localeCompare(b.auctionDate));
    const s = list[0];
    return {
      cusip: c,
      type: s.securityType,
      term: s.securityTerm,
      description: `${s.securityTerm || ''} ${s.securityType || ''}${s.tips === 'Yes' ? ' (TIPS)' : ''}${s.floatingRate === 'Yes' ? ' (FRN)' : ''}`.trim(),
      coupon: dotNum(s.interestRate) ?? 0,
      originalIssueDate: (s.originalIssueDate || s.issueDate || '').slice(0, 10),
      maturity: (s.maturityDate || '').slice(0, 10),
      tips: s.tips === 'Yes',
      frn: s.floatingRate === 'Yes',
      callable: s.callable === 'Yes',
      auctions,
      source: 'TreasuryDirect (U.S. Department of the Treasury)',
      sourceUrl: `https://www.treasurydirect.gov/auctions/auction-query/`,
    };
  });
}

// ---- historical exchange rates (ECB reference rates) ---------------------------------------
export async function fxOnDate(date, base = 'USD', quote = 'IDR') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError('date must be YYYY-MM-DD', { status: 400 });
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) throw new HttpError('Currencies must be 3-letter codes', { status: 400 });
  return cached(`fxon:${date}:${base}${quote}`, 7 * 24 * 3600e3, async () => {
    const j = await getJSON(`https://api.frankfurter.dev/v1/${date}?base=${base}&symbols=${quote}`, { headers: UA, timeout: 15000 });
    const rate = j?.rates?.[quote];
    if (!rate) throw new HttpError(`No ${base}/${quote} rate for ${date}`, { status: 404 });
    return { date: j.date, requested: date, base, quote, rate, source: 'ECB euro foreign exchange reference rates (via Frankfurter)' };
  });
}
