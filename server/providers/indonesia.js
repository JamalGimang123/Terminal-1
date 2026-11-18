// Indonesia: Bank Indonesia (official BI-Rate decisions & press releases, bi.go.id)
// and IMF World Economic Outlook indicators (World Bank as fallback).
import { getText, getJSON, browserHeaders, HttpError } from '../lib/http.js';
import { cached, diskCached } from '../lib/cache.js';
import { decodeEntities, stripTags } from '../lib/xml.js';

const BI = 'https://www.bi.go.id';
const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

// "18 November 2026" -> "2026-11-18"
export function parseLongDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (!m || MONTHS[m[2].toLowerCase()] == null) return null;
  return new Date(Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]))).toISOString().slice(0, 10);
}

// ---- BI-Rate decisions ---------------------------------------------------------
export function parseBiRate(html) {
  const rows = [];
  const re = /<td class="text-center">\s*(\d{1,2} [A-Za-z]+ \d{4})\s*<\/td>\s*<td class="text-center">\s*([\d.,]+)\s*%\s*<\/td>\s*<td class="text-center">\s*(?:<a href="([^"]+)")?/g;
  let m;
  while ((m = re.exec(html))) {
    const date = parseLongDate(m[1]);
    const rate = Number(m[2].replace(',', '.'));
    if (date && Number.isFinite(rate)) rows.push({ date, rate, url: m[3] ? new URL(decodeEntities(m[3]), BI).href : null });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function biRate() {
  return cached('bi:rate', 3 * 3600e3, async () => {
    const html = await getText(`${BI}/en/statistik/indikator/bi-rate.aspx`, { headers: browserHeaders({ Accept: 'text/html' }), timeout: 25000 });
    const decisions = parseBiRate(html);
    if (!decisions.length) throw new HttpError('Could not read the BI-Rate table from bi.go.id', { status: 502 });
    return { source: 'Bank Indonesia — BI-Rate', sourceUrl: `${BI}/en/statistik/indikator/bi-rate.aspx`, decisions };
  });
}

// ---- Bank Indonesia press releases ------------------------------------------------
export function parseBiPress(html) {
  const items = [];
  const re = /<a href="([^"]+)" class="link-berita-item-sp">\s*([\s\S]*?)\s*<\/a>\s*(?:<!--[\s\S]*?-->\s*)?(?:<p class="deskripsi-berita-item">([\s\S]*?)<\/p>)?[\s\S]*?<p class="info1-berita-item">\s*([^<]+?)\s*<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    const date = parseLongDate(m[4]);
    items.push({
      title: stripTags(m[2]),
      link: new URL(decodeEntities(m[1]), BI).href,
      summary: stripTags(m[3] || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/^No\.?\s*[\d/]+\/DKom\s*/i, '').slice(0, 400),
      // BI publishes dates only; mark them at 12:00 Jakarta time (05:00 UTC).
      published: date ? `${date}T05:00:00.000Z` : null,
      dateOnly: true,
      author: '',
      category: 'Press Release',
    });
  }
  return items;
}

export async function biPress() {
  return cached('bi:press', 30 * 60e3, async () => {
    const html = await getText(`${BI}/en/publikasi/ruang-media/news-release/default.aspx`, { headers: browserHeaders({ Accept: 'text/html' }), timeout: 25000 });
    const items = parseBiPress(html);
    if (!items.length) throw new HttpError('Could not read Bank Indonesia press releases', { status: 502 });
    return items;
  });
}

// ---- IMF World Economic Outlook / World Bank ------------------------------------
// The IMF DataMapper serves WEO data (history + projections). It rejects browser-like
// user agents, so we identify the app plainly.
export const ID_INDICATORS = [
  { id: 'NGDP_RPCH', wb: 'NY.GDP.MKTP.KD.ZG', name: 'Real GDP growth', unit: '%' },
  { id: 'PCPIPCH', wb: 'FP.CPI.TOTL.ZG', name: 'Inflation (CPI, avg)', unit: '%' },
  { id: 'LUR', wb: 'SL.UEM.TOTL.ZS', name: 'Unemployment rate', unit: '%' },
  { id: 'BCA_NGDPD', wb: 'BN.CAB.XOKA.GD.ZS', name: 'Current account (% GDP)', unit: '%' },
  { id: 'GGXCNL_NGDP', wb: null, name: 'Budget balance (% GDP)', unit: '%' },
  { id: 'GGXWDG_NGDP', wb: 'GC.DOD.TOTL.GD.ZS', name: 'Government debt (% GDP)', unit: '%' },
  { id: 'NGDPDPC', wb: 'NY.GDP.PCAP.CD', name: 'GDP per capita (US$)', unit: '$' },
  { id: 'NGDPD', wb: 'NY.GDP.MKTP.CD', name: 'GDP (US$ billions)', unit: '$B', wbScale: 1e-9 },
];

async function imfSeries(code) {
  const json = await getJSON(`https://www.imf.org/external/datamapper/api/v1/${code}/IDN`, {
    headers: { 'User-Agent': 'FinTerm/1.0 (+personal finance terminal)', Accept: 'application/json' },
    timeout: 25000,
  });
  const v = json?.values?.[code]?.IDN;
  if (!v) throw new HttpError(`IMF: no Indonesia data for ${code}`, { status: 404 });
  return Object.entries(v)
    .map(([y, val]) => ({ year: Number(y), value: Number(val) }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.year - b.year);
}

async function worldBankSeries(code, scale = 1) {
  const json = await getJSON(`https://api.worldbank.org/v2/country/IDN/indicator/${code}?format=json&per_page=80`, { timeout: 25000 });
  const rows = Array.isArray(json) ? json[1] || [] : [];
  return rows
    .filter((r) => r.value != null)
    .map((r) => ({ year: Number(r.date), value: r.value * scale }))
    .sort((a, b) => a.year - b.year);
}

export async function indonesiaIndicators() {
  return diskCached('id-indicators', 24 * 3600e3, async () => {
    const thisYear = new Date().getUTCFullYear();
    const out = [];
    await Promise.all(
      ID_INDICATORS.map(async (ind) => {
        let points = null;
        let source = null;
        try {
          points = (await imfSeries(ind.id)).filter((p) => p.year >= 1995 && p.year <= thisYear + 5);
          source = 'IMF World Economic Outlook';
        } catch {
          if (ind.wb) {
            try {
              points = (await worldBankSeries(ind.wb, ind.wbScale || 1)).filter((p) => p.year >= 1995);
              source = 'World Bank WDI';
            } catch {
              /* both failed */
            }
          }
        }
        if (points?.length) {
          // WEO marks the current year onward as estimates/projections.
          out.push({ ...ind, source, points: points.map((p) => ({ ...p, projection: source.startsWith('IMF') && p.year >= thisYear })) });
        }
      }),
    );
    if (!out.length) throw new HttpError('IMF and World Bank data unavailable', { status: 502 });
    return { indicators: ID_INDICATORS.map((i) => out.find((o) => o.id === i.id)).filter(Boolean), asOf: new Date().toISOString().slice(0, 10) };
  });
}
