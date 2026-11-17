// SEC EDGAR (no key; requires a descriptive User-Agent). Authoritative source for
// company identity, filings, XBRL financial statements and fund holdings (N-PORT).
import { getJSON, getText, getBuffer, secHeaders, HttpError } from '../lib/http.js';
import { cached, diskCached } from '../lib/cache.js';
import { blocks, tag, attr, decodeEntities } from '../lib/xml.js';
import { readZip } from '../lib/zip.js';
import { normalizeSymbol } from '../lib/symbols.js';

const DAY = 86400e3;
const opts = () => ({ headers: secHeaders(), timeout: 30000 });

// ---- ticker maps -----------------------------------------------------------
export async function companyTickers() {
  return diskCached('sec-company-tickers-exchange', 1 * DAY, async () => {
    const json = await getJSON('https://www.sec.gov/files/company_tickers_exchange.json', opts());
    // fields: cik, name, ticker, exchange
    return json.data.map(([cik, name, ticker, exchange]) => ({ cik, name, ticker: normalizeSymbol(ticker), exchange: exchange || '' }));
  });
}

export async function fundTickers() {
  return diskCached('sec-company-tickers-mf', 1 * DAY, async () => {
    const json = await getJSON('https://www.sec.gov/files/company_tickers_mf.json', opts());
    // fields: cik, seriesId, classId, symbol
    return json.data.map(([cik, seriesId, classId, symbol]) => ({ cik, seriesId, classId, ticker: normalizeSymbol(symbol) }));
  });
}

async function indexes() {
  return cached('sec:index', 6 * 3600e3, async () => {
    const [cos, funds] = await Promise.all([companyTickers().catch(() => []), fundTickers().catch(() => [])]);
    const byTicker = new Map(cos.map((c) => [c.ticker, c]));
    const fundByTicker = new Map(funds.map((f) => [f.ticker, f]));
    return { cos, byTicker, fundByTicker };
  });
}

export async function isFundTicker(sym) {
  try {
    const { fundByTicker } = await indexes();
    return fundByTicker.has(normalizeSymbol(sym));
  } catch {
    return false;
  }
}

export async function lookupCompany(sym) {
  const { byTicker } = await indexes();
  return byTicker.get(normalizeSymbol(sym)) || null;
}

export async function lookupFund(sym) {
  const { fundByTicker } = await indexes();
  return fundByTicker.get(normalizeSymbol(sym)) || null;
}

export async function searchSecurities(query, limit = 12) {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const { cos, fundByTicker } = await indexes();
  const exact = [];
  const prefix = [];
  const nameHits = [];
  for (const c of cos) {
    if (c.ticker === q) exact.push(c);
    else if (c.ticker.startsWith(q)) prefix.push(c);
    else if (q.length >= 3 && c.name.toUpperCase().includes(q)) nameHits.push(c);
    if (prefix.length > 50 && nameHits.length > 50) break;
  }
  const out = [...exact, ...prefix.sort((a, b) => a.ticker.length - b.ticker.length), ...nameHits].map((c) => ({
    symbol: c.ticker,
    name: c.name,
    exchange: c.exchange,
    type: 'EQUITY',
  }));
  if (fundByTicker.has(q) && !out.some((o) => o.symbol === q)) out.unshift({ symbol: q, name: 'Registered fund / ETF', exchange: '', type: 'FUND' });
  const seen = new Set();
  return out.filter((o) => !seen.has(o.symbol) && seen.add(o.symbol)).slice(0, limit);
}

// ---- company submissions (profile + filings) -----------------------------
const pad = (cik) => String(cik).padStart(10, '0');

export async function submissions(cik) {
  return cached(`sec:sub:${cik}`, 3600e3, () => getJSON(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`, opts()));
}

export async function companyProfile(sym) {
  const co = (await lookupCompany(sym)) || (await lookupFund(sym));
  if (!co) throw new HttpError(`${sym} not found in SEC EDGAR`, { status: 404 });
  const sub = await submissions(co.cik);
  const recent = sub.filings?.recent || {};
  const filings = [];
  for (let i = 0; i < (recent.accessionNumber || []).length && filings.length < 60; i++) {
    const acc = recent.accessionNumber[i];
    const folder = `https://www.sec.gov/Archives/edgar/data/${Number(co.cik)}/${acc.replace(/-/g, '')}`;
    filings.push({
      form: recent.form[i],
      filed: recent.filingDate[i],
      reportDate: recent.reportDate?.[i] || '',
      description: recent.primaryDocDescription?.[i] || '',
      items: recent.items?.[i] || '',
      url: recent.primaryDocument?.[i] ? `${folder}/${recent.primaryDocument[i]}` : `${folder}/`,
      indexUrl: `${folder}/${acc}-index.htm`,
    });
  }
  const addr = sub.addresses?.business || {};
  return {
    cik: Number(co.cik),
    name: sub.name,
    tickers: sub.tickers || [],
    exchanges: sub.exchanges || [],
    sic: sub.sic,
    industry: sub.sicDescription,
    category: sub.category,
    fiscalYearEnd: sub.fiscalYearEnd,
    stateOfIncorporation: sub.stateOfIncorporation,
    website: sub.website || '',
    phone: sub.phone || '',
    address: [addr.street1, addr.city, addr.stateOrCountry, addr.zipCode].filter(Boolean).join(', '),
    formerNames: (sub.formerNames || []).map((f) => f.name),
    edgarUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${pad(co.cik)}`,
    filings,
  };
}

// ---- XBRL fundamentals -------------------------------------------------------
const FLOW = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'TotalRevenuesAndOtherIncome'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  epsDiluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  rnd: ['ResearchAndDevelopmentExpense'],
  dividendsPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
  buybacks: ['PaymentsForRepurchaseOfCommonStock'],
};
const INSTANT = {
  totalAssets: ['Assets'],
  totalLiabilities: ['Liabilities'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  longTermDebt: ['LongTermDebtNoncurrent', 'LongTermDebt'],
};

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
const ANNUAL_FORMS = /^(10-K|20-F|40-F)/;

function factsFor(gaap, names, unitPref) {
  // Merge candidate concepts; earlier concepts win for a given period end.
  const byKey = new Map();
  for (const name of names) {
    const units = gaap?.[name]?.units;
    if (!units) continue;
    const list = units[unitPref] || units.USD || Object.values(units)[0] || [];
    for (const f of list) {
      const key = `${f.start || ''}|${f.end}`;
      const prev = byKey.get(key);
      if (!prev || (prev.concept === name && f.filed > prev.filed)) byKey.set(key, { ...f, concept: name });
    }
  }
  return [...byKey.values()];
}

function extractFlow(gaap, names, unit = 'USD') {
  const facts = factsFor(gaap, names, unit).filter((f) => f.start);
  const annual = new Map();
  const quarterly = new Map();
  const ytd = new Map(); // `${start}|${end}` -> fact, for year-to-date differencing
  for (const f of facts) {
    const d = days(f.start, f.end);
    if (d > 350 && d < 380 && (ANNUAL_FORMS.test(f.form) || f.fp === 'FY')) {
      const p = annual.get(f.end);
      if (!p || f.filed > p.filed) annual.set(f.end, f);
    }
    if (d > 80 && d < 100) {
      const p = quarterly.get(f.end);
      if (!p || f.filed > p.filed) quarterly.set(f.end, f);
    }
    if (d > 80 && d < 380) {
      const k = `${f.start}|${f.end}`;
      const p = ytd.get(k);
      if (!p || f.filed > p.filed) ytd.set(k, f);
    }
  }
  // Cash-flow statements (and fiscal Q4s) are only reported year-to-date:
  // derive a quarter as YTD(n) - YTD(n-1) for periods sharing a start date.
  const byStart = new Map();
  for (const f of ytd.values()) {
    if (!byStart.has(f.start)) byStart.set(f.start, []);
    byStart.get(f.start).push(f);
  }
  for (const list of byStart.values()) {
    list.sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      const prev = list[i - 1];
      const gap = days(prev.end, cur.end);
      if (gap > 80 && gap < 100 && !quarterly.has(cur.end)) {
        quarterly.set(cur.end, { start: prev.end, end: cur.end, val: Math.round((cur.val - prev.val) * 1e4) / 1e4, fy: cur.fy, derived: true });
      }
    }
  }
  const sortV = (m) => [...m.values()].sort((a, b) => a.end.localeCompare(b.end)).map((f) => ({ end: f.end, val: f.val, fy: f.fy, derived: !!f.derived }));
  return { annual: sortV(annual).slice(-8), quarterly: sortV(quarterly).slice(-12) };
}

function extractInstant(gaap, names) {
  const facts = factsFor(gaap, names, 'USD').filter((f) => !f.start);
  const annual = new Map();
  const all = new Map();
  for (const f of facts) {
    const p = all.get(f.end);
    if (!p || f.filed > p.filed) all.set(f.end, f);
    if (ANNUAL_FORMS.test(f.form) && f.fp === 'FY') {
      const a = annual.get(f.end);
      if (!a || f.filed > a.filed) annual.set(f.end, f);
    }
  }
  const sortV = (m) => [...m.values()].sort((a, b) => a.end.localeCompare(b.end)).map((f) => ({ end: f.end, val: f.val }));
  return { annual: sortV(annual).slice(-8), quarterly: sortV(all).slice(-12) };
}

export async function fundamentals(sym) {
  const co = await lookupCompany(sym);
  if (!co) throw new HttpError(`${sym}: no SEC company record (funds and foreign listings have no XBRL statements)`, { status: 404 });
  return cached(`sec:facts:${co.cik}`, 12 * 3600e3, async () => {
    const json = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(co.cik)}.json`, opts());
    const gaap = json.facts?.['us-gaap'] || json.facts?.['ifrs-full'] || {};
    const dei = json.facts?.dei || {};
    const out = { cik: co.cik, name: json.entityName, series: {} };
    for (const [k, names] of Object.entries(FLOW)) out.series[k] = extractFlow(gaap, names, k === 'epsDiluted' ? 'USD/shares' : 'USD');
    for (const [k, names] of Object.entries(INSTANT)) out.series[k] = extractInstant(gaap, names);
    const shares = (dei.EntityCommonStockSharesOutstanding?.units?.shares || []).sort((a, b) => a.end.localeCompare(b.end)).at(-1);
    out.sharesOutstanding = shares ? { val: shares.val, asOf: shares.end } : null;
    // Trailing-twelve-month sums from the last four quarters.
    const ttm = {};
    for (const k of ['revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'epsDiluted', 'operatingCashFlow', 'capex', 'rnd', 'dividendsPaid', 'buybacks']) {
      const q = out.series[k].quarterly.slice(-4);
      const contiguous = q.length === 4 && days(q[0].end, q[3].end) < 290;
      ttm[k] = contiguous ? q.reduce((s, x) => s + x.val, 0) : out.series[k].annual.at(-1)?.val ?? null;
    }
    out.ttm = ttm;
    // Drop concepts whose data stopped years ago (e.g. a tag the filer no longer uses).
    const newest = Object.values(out.series).reduce((m, s) => [s.quarterly.at(-1)?.end, s.annual.at(-1)?.end, m].filter(Boolean).sort().at(-1), '');
    const cutoff = new Date(Date.parse(newest) - 730 * DAY).toISOString().slice(0, 10);
    for (const [k, s] of Object.entries(out.series)) {
      const last = s.quarterly.at(-1)?.end || s.annual.at(-1)?.end || '';
      if (last < cutoff) {
        out.series[k] = { annual: [], quarterly: [] };
        if (k in ttm) ttm[k] = null;
      }
    }
    out.ttmAsOf = newest || null;
    out.latest = Object.fromEntries(Object.keys(INSTANT).map((k) => [k, out.series[k].quarterly.at(-1) || null]));
    return out;
  });
}

// ---- N-PORT fund holdings ------------------------------------------------
export async function latestNport(seriesId) {
  const atom = await getText(
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${seriesId}&type=NPORT-P&dateb=&owner=include&count=10&output=atom`,
    opts(),
  );
  const entries = blocks(atom, 'entry')
    .map((e) => ({ date: tag(e, 'filing-date'), href: tag(e, 'filing-href'), type: tag(e, 'filing-type') }))
    .filter((e) => /^NPORT-P/.test(e.type) && e.href)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length) throw new HttpError(`No N-PORT filings for series ${seriesId}`, { status: 404 });
  return entries[0];
}

export function parseNport(xml) {
  const gen = tag(xml, 'genInfo');
  const fund = tag(xml, 'fundInfo');
  const netAssets = Number(tag(fund, 'netAssets')) || null;
  const holdings = [];
  for (const b of blocks(xml, 'invstOrSec')) {
    const pct = Number(tag(b, 'pctVal'));
    const isin = attr(b, 'isin', 'value');
    const ticker = attr(b, 'ticker', 'value');
    holdings.push({
      name: decodeEntities(tag(b, 'name')),
      title: decodeEntities(tag(b, 'title')),
      cusip: /^[0-9A-Z]{9}$/.test(tag(b, 'cusip')) ? tag(b, 'cusip') : isin && isin.startsWith('US') ? isin.slice(2, 11) : '',
      isin,
      ticker: ticker ? normalizeSymbol(ticker) : '',
      shares: Number(tag(b, 'balance')) || 0,
      units: tag(b, 'units'),
      value: Number(tag(b, 'valUSD')) || 0,
      weight: Number.isFinite(pct) ? pct : 0,
      assetCat: tag(b, 'assetCat') || (b.includes('assetConditional') ? attr(b, 'assetConditional', 'desc') : ''),
      country: tag(b, 'invCountry'),
      payoff: tag(b, 'payoffProfile'),
    });
  }
  return {
    seriesName: decodeEntities(tag(gen, 'seriesName')),
    registrant: decodeEntities(tag(gen, 'regName')),
    reportDate: tag(gen, 'repPdDate'),
    netAssets,
    holdings,
  };
}

export async function nportHoldings(seriesId) {
  return diskCached(`nport-${seriesId}`, 1 * DAY, async () => {
    const filing = await latestNport(seriesId);
    const folder = filing.href.replace(/\/[^/]+$/, '');
    const xml = await getText(`${folder}/primary_doc.xml`, { ...opts(), timeout: 60000 });
    return { ...parseNport(xml), filed: filing.date, url: filing.href };
  });
}

// ---- CUSIP -> ticker map from SEC "fails-to-deliver" data ----------------
// FTD files list CUSIP, symbol and description for thousands of US securities
// every half-month; we merge the latest few into a lookup table.
export async function cusipTickerMap() {
  return diskCached('sec-ftd-cusip-map', 7 * DAY, async () => {
    const map = {};
    const now = new Date();
    const candidates = [];
    for (let back = 0; back < 4; back++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      candidates.push(`${ym}b`, `${ym}a`);
    }
    let loaded = 0;
    for (const c of candidates) {
      if (loaded >= 3) break;
      try {
        const buf = await getBuffer(`https://www.sec.gov/files/data/fails-deliver-data/cnsfails${c}.zip`, { ...opts(), timeout: 45000 });
        const zip = readZip(buf);
        const text = zip.read(zip.names[0]).toString('latin1');
        for (const line of text.split(/\r?\n/)) {
          const parts = line.split('|');
          if (parts.length < 5 || parts[1] === 'CUSIP') continue;
          const [, cusip, sym, , desc] = parts;
          if (cusip && sym && !map[cusip]) map[cusip] = [normalizeSymbol(sym), desc.trim()];
        }
        loaded++;
      } catch {
        /* file not published yet (404) — try an older period */
      }
    }
    if (!loaded) throw new HttpError('No SEC fails-to-deliver files reachable', { status: 502 });
    return map;
  });
}
