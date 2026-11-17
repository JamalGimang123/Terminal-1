// ETF holdings resolution:
//   1. State Street (SSGA) daily holdings file — SPDR funds incl. the SPY/DIA/MDY unit trusts
//   2. SEC EDGAR N-PORT — latest quarterly portfolio report of any registered open-end fund
//   3. Nasdaq-100 constituents (cap-weighted approximation) for QQQ/QQQM if both fail
// Holdings are enriched with tickers via SEC fails-to-deliver CUSIP data and EDGAR names.
import { getBuffer, browserHeaders, HttpError } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { readFirstSheet } from '../lib/xlsx.js';
import { normalizeSymbol } from '../lib/symbols.js';
import { lookupFund, nportHoldings, cusipTickerMap, companyTickers } from '../providers/sec.js';
import { nasdaq100List } from '../providers/nasdaq.js';

const SSGA_CIKS = new Set([1064641, 1064642, 1168164, 1516212]);

export function parseSsgaWorkbook(rows) {
  let fundName = '';
  let asOf = '';
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [];
    const a = String(r[0] ?? '').trim();
    if (/^Fund Name/i.test(a)) fundName = String(r[1] ?? '');
    if (/^Holdings/i.test(a)) asOf = String(r[1] ?? '').replace(/^As of\s*/i, '');
    if (r.some((c) => /^Name$/i.test(String(c ?? '').trim())) && r.some((c) => /^Weight/i.test(String(c ?? '').trim()))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('SSGA workbook: holdings header not found');
  const header = rows[headerIdx].map((h) => String(h ?? '').trim().toLowerCase());
  const col = (re) => header.findIndex((h) => re.test(h));
  const ci = { name: col(/^name$/), ticker: col(/^ticker/), id: col(/^identifier|cusip/), sedol: col(/sedol/), weight: col(/^weight/), sector: col(/sector/), shares: col(/shares/), ccy: col(/currency/) };
  const holdings = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = r[ci.name];
    if (name == null || String(name).trim() === '') {
      if (holdings.length) break;
      continue;
    }
    const weight = Number(r[ci.weight]);
    if (!Number.isFinite(weight)) continue;
    const id = String(r[ci.id] ?? '').trim();
    const rawTicker = String(r[ci.ticker] ?? '').trim();
    const ticker = rawTicker && rawTicker !== '-' ? normalizeSymbol(rawTicker) : '';
    holdings.push({
      name: String(name).trim(),
      ticker,
      cusip: /^[0-9A-Z]{9}$/.test(id) ? id : '',
      isin: /^[A-Z]{2}[0-9A-Z]{10}$/.test(id) ? id : '',
      sedol: String(r[ci.sedol] ?? '').trim(),
      weight,
      shares: Number(r[ci.shares]) || 0,
      sector: ci.sector >= 0 && r[ci.sector] !== '-' ? String(r[ci.sector] ?? '') : '',
      currency: String(r[ci.ccy] ?? ''),
      assetCat: /cash|currency|dollar/i.test(String(name)) && !ticker ? 'CASH' : 'EC',
    });
  }
  return { fundName, asOf, holdings };
}

async function ssgaHoldings(sym) {
  const url = `https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-${sym.toLowerCase()}.xlsx`;
  const buf = await getBuffer(url, { headers: browserHeaders({ Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*' }), timeout: 25000 });
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new HttpError('SSGA: not a holdings workbook', { status: 404 });
  const parsed = parseSsgaWorkbook(readFirstSheet(buf));
  return { ...parsed, source: 'State Street Global Advisors (daily holdings file)', sourceUrl: url, frequency: 'daily' };
}

const SUFFIX = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|GROUP|SA|NV|AG|SE|LP|THE|CLASS [A-C]|CL [A-C]|COM|NEW|REIT)\b\.?/g;
export function normName(n) {
  return String(n || '')
    .toUpperCase()
    .replace(/&AMP;/g, '&')
    .replace(/[.,'’()/-]/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function enrichTickers(holdings) {
  const missing = holdings.filter((h) => !h.ticker);
  if (!missing.length) return;
  let cmap = {};
  try {
    cmap = await cusipTickerMap();
  } catch {
    /* optional */
  }
  let byName = null;
  for (const h of missing) {
    if (h.cusip && cmap[h.cusip]) {
      h.ticker = cmap[h.cusip][0];
      continue;
    }
    if (!byName) {
      byName = new Map();
      try {
        for (const c of await companyTickers()) {
          const k = normName(c.name);
          if (!byName.has(k)) byName.set(k, c.ticker);
        }
      } catch {
        /* optional */
      }
    }
    const t = byName.get(normName(h.name));
    if (t) h.ticker = t;
  }
}

function isNonSecurity(h) {
  const cat = String(h.assetCat || '').toUpperCase();
  return cat === 'STIV' || cat === 'CASH' || /^D[A-Z]{1,2}$/.test(cat) || h.payoff === 'Short';
}

async function resolve(sym) {
  const errors = [];
  const fund = await lookupFund(sym).catch(() => null);
  const trySsga = !fund || SSGA_CIKS.has(Number(fund.cik));
  const attempts = [];
  if (trySsga) attempts.push('ssga');
  if (fund) attempts.push('nport');
  if (!trySsga) attempts.push('ssga');

  for (const a of attempts) {
    try {
      if (a === 'ssga') {
        const r = await ssgaHoldings(sym);
        if (r.holdings.length) return { symbol: sym, name: r.fundName, asOf: r.asOf, source: r.source, sourceUrl: r.sourceUrl, frequency: r.frequency, holdings: r.holdings };
      } else {
        const r = await nportHoldings(fund.seriesId);
        if (r.holdings.length)
          return {
            symbol: sym,
            name: r.seriesName,
            registrant: r.registrant,
            asOf: r.reportDate,
            filed: r.filed,
            netAssets: r.netAssets,
            source: 'SEC EDGAR Form N-PORT (quarterly portfolio report)',
            sourceUrl: r.url,
            frequency: 'quarterly (filed up to 60 days after period end)',
            holdings: r.holdings,
          };
      }
    } catch (err) {
      errors.push(`${a === 'ssga' ? 'SSGA' : 'SEC N-PORT'}: ${err.message}`);
    }
  }
  if (sym === 'QQQ' || sym === 'QQQM') {
    try {
      const list = await nasdaq100List();
      const total = list.reduce((s, x) => s + (x.marketCap || 0), 0);
      if (total > 0)
        return {
          symbol: sym,
          name: 'Nasdaq-100 constituents (approximation)',
          asOf: new Date().toISOString().slice(0, 10),
          source: 'Nasdaq-100 constituent list — weights approximated by market cap (index uses modified cap weighting)',
          sourceUrl: 'https://www.nasdaq.com/market-activity/quotes/nasdaq-ndx-index',
          frequency: 'approximation',
          approximate: true,
          holdings: list.map((x) => ({ name: x.name, ticker: x.symbol, cusip: '', weight: (100 * (x.marketCap || 0)) / total, assetCat: 'EC' })),
        };
    } catch (err) {
      errors.push(`Nasdaq-100: ${err.message}`);
    }
  }
  if (!fund && !errors.length) errors.push('not found in SEC registered-fund list');
  throw new HttpError(`No holdings found for ${sym}: ${errors.join('; ')}`, { status: 404 });
}

export async function etfHoldings(rawSym) {
  const sym = normalizeSymbol(rawSym);
  return cached(`etf:${sym}`, 6 * 3600e3, async () => {
    const r = await resolve(sym);
    const securities = r.holdings.filter((h) => !isNonSecurity(h) && h.weight > 0);
    const other = r.holdings.filter((h) => isNonSecurity(h) || h.weight <= 0);
    await enrichTickers(securities);
    securities.sort((a, b) => b.weight - a.weight);
    const totalWeight = securities.reduce((s, h) => s + h.weight, 0);
    return {
      ...r,
      count: securities.length,
      totalWeight,
      otherWeight: other.reduce((s, h) => s + h.weight, 0),
      holdings: securities.map((h) => ({ name: h.name, ticker: h.ticker || '', cusip: h.cusip || '', isin: h.isin || '', weight: h.weight, shares: h.shares || 0, value: h.value || 0, sector: h.sector || '', country: h.country || '', assetCat: h.assetCat || '' })),
    };
  });
}
