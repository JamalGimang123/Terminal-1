// Nasdaq.com public data API (no key): real-time "Nasdaq Last Sale" quotes for
// US-listed stocks and ETFs, daily history, intraday charts, market movers,
// earnings & economic calendars and per-symbol news.
import { getJSON, browserHeaders, HttpError } from '../lib/http.js';
import { num } from '../lib/csv.js';
import { toNasdaq, fromNasdaq } from '../lib/symbols.js';
import { parseETDateTime, parseNasdaqTimestamp, etWallClockToEpoch, mdyToISO, nyDate } from '../lib/time.js';
import { isFundTicker } from './sec.js';
import { cached } from '../lib/cache.js';

const API = 'https://api.nasdaq.com/api';
const headers = () =>
  browserHeaders({
    Origin: 'https://www.nasdaq.com',
    Referer: 'https://www.nasdaq.com/',
  });

// Learned asset class per symbol ("stocks" | "etf" | "index" | "crypto").
const classMemo = new Map([
  ['COMP', 'index'],
  ['NDX', 'index'],
  ['NQUSB', 'index'],
]);

async function nq(path) {
  const json = await getJSON(`${API}${path}`, { headers: headers(), timeout: 12000 });
  if (json?.status?.rCode && json.status.rCode !== 200) {
    const msg = json.status.bCodeMessage?.[0]?.errorMessage || `Nasdaq error ${json.status.rCode}`;
    throw new HttpError(msg, { status: json.status.rCode === 400 ? 404 : 502 });
  }
  return json;
}

export async function guessClass(sym) {
  const s = toNasdaq(sym);
  if (classMemo.has(s)) return classMemo.get(s);
  return (await isFundTicker(sym)) ? 'etf' : 'stocks';
}

function quoteFromWatchlist(row) {
  const price = num(row.lastSalePrice);
  const prev = num(row.previousClosePrice);
  const change = num(row.netChange);
  return {
    symbol: fromNasdaq(row.symbol),
    name: cleanName(row.companyName),
    price,
    prevClose: prev,
    change: change ?? (prev != null && price != null ? price - prev : null),
    changePct: num(row.percentageChange),
    open: num(row.openingPrice),
    high: null,
    low: null,
    volume: num(row.volume),
    currency: 'USD',
    exchange: '',
    type: row.assetClass,
    time: toISO(parseETDateTime(row.lastTradeTimestampDateTime) ?? parseNasdaqTimestamp(row.lastTradeTimestamp)),
    marketState: marketStateFrom(row.marketStatus),
    source: 'Nasdaq',
    realtime: row.assetClass !== 'INDEX',
  };
}

function toISO(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

function marketStateFrom(s) {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.includes('pre')) return 'PRE';
  if (v.includes('after') || v.includes('post')) return 'POST';
  if (v.includes('open')) return 'REGULAR';
  return 'CLOSED';
}

export function cleanName(n) {
  return String(n || '')
    .replace(/\s+(Common Stock|Common Shares|Ordinary Shares|Class [A-C] (Common Stock|Ordinary Shares|Common Shares)|American Depositary Shares.*|ADS.*)$/i, '')
    .trim();
}

// Batch quotes via the watchlist endpoint. Symbols that come back missing are
// retried once under the other asset class (stocks <-> etf).
export async function nasdaqQuotes(symbols) {
  const out = {};
  const tryBatch = async (pairs) => {
    for (let i = 0; i < pairs.length; i += 20) {
      const chunk = pairs.slice(i, i + 20);
      const qs = chunk.map(([s, c]) => `symbol=${encodeURIComponent(`${toNasdaq(s).toLowerCase()}|${c}`)}`).join('&');
      const json = await nq(`/quote/watchlist?${qs}`);
      for (const row of json.data || []) {
        if (!row?.symbol) continue;
        const q = quoteFromWatchlist(row);
        out[q.symbol] = q;
        const cls = row.assetClass === 'ETF' ? 'etf' : row.assetClass === 'INDEX' ? 'index' : 'stocks';
        classMemo.set(toNasdaq(q.symbol), cls);
      }
    }
  };
  const first = await Promise.all(symbols.map(async (s) => [s, await guessClass(s)]));
  await tryBatch(first);
  const missing = first.filter(([s, c]) => !out[s] && c !== 'index').map(([s, c]) => [s, c === 'etf' ? 'stocks' : 'etf']);
  if (missing.length) await tryBatch(missing);
  return out;
}

export async function nasdaqInfo(sym, cls) {
  cls = cls || (await guessClass(sym));
  const json = await nq(`/quote/${encodeURIComponent(toNasdaq(sym))}/info?assetclass=${cls}`);
  return json.data;
}

export async function nasdaqSummary(sym) {
  return cached(`nq:summary:${sym}`, 30 * 60e3, async () => {
    let cls = await guessClass(sym);
    let json;
    try {
      json = await nq(`/quote/${encodeURIComponent(toNasdaq(sym))}/summary?assetclass=${cls}`);
    } catch (err) {
      // Unit trusts like SPY/DIA are ETFs on Nasdaq but not in the SEC fund list: retry as the other class.
      if (err.status !== 404 || cls === 'index') throw err;
      cls = cls === 'etf' ? 'stocks' : 'etf';
      json = await nq(`/quote/${encodeURIComponent(toNasdaq(sym))}/summary?assetclass=${cls}`);
    }
    classMemo.set(toNasdaq(sym), cls);
    const out = {};
    for (const [k, v] of Object.entries(json.data?.summaryData || {})) out[k] = { label: v.label, value: v.value };
    return { assetClass: cls, fields: out };
  });
}

// Daily OHLCV, oldest first. Nasdaq only returns ranges ending today and
// at most ~10 years. Prices are split-adjusted but NOT dividend-adjusted.
export async function nasdaqHistory(sym, fromISO) {
  const cls = await guessClass(sym);
  const to = nyDate();
  const json = await nq(`/quote/${encodeURIComponent(toNasdaq(sym))}/historical?assetclass=${cls}&fromdate=${fromISO}&todate=${to}&limit=9999`);
  const rows = json.data?.tradesTable?.rows || [];
  const points = [];
  for (const r of rows) {
    const d = mdyToISO(r.date);
    const c = num(r.close);
    if (!d || c == null) continue;
    points.push({ t: Date.parse(d + 'T21:00:00Z'), o: num(r.open) ?? c, h: num(r.high) ?? c, l: num(r.low) ?? c, c, v: num(r.volume) ?? 0, a: c });
  }
  points.sort((a, b) => a.t - b.t);
  return { points, adjusted: false };
}

// Intraday minute chart for the current/last session.
export async function nasdaqIntraday(sym) {
  const cls = await guessClass(sym);
  const json = await nq(`/quote/${encodeURIComponent(toNasdaq(sym))}/chart?assetclass=${cls}`);
  const d = json.data || {};
  const vols = new Map((d.volumeChart || []).map((p) => [p.x, p.y]));
  const points = (d.chart || [])
    .filter((p) => p.y != null)
    .map((p) => ({ t: etWallClockToEpoch(p.x), o: p.y, h: p.y, l: p.y, c: p.y, v: vols.get(p.x) || 0, a: p.y }));
  return { points, prevClose: num(d.previousClose), name: cleanName(d.company) };
}

export async function nasdaqMovers() {
  const json = await nq(`/marketmovers?assetclass=stocks&exchangestatus=currentMarket&limit=50`);
  const s = json.data?.STOCKS || {};
  const map = (t) =>
    (t?.table?.rows || []).map((r) => ({
      symbol: fromNasdaq(r.symbol),
      name: cleanName(r.name),
      price: num(r.lastSalePrice),
      change: num(r.lastSaleChange),
      changePct: num(r.change),
    }));
  // The all-market lists are dominated by warrants, rights and sub-$1 shares;
  // keep real common stock trading above $2.
  const tradable = (r) => r.price >= 2 && !/warrant|right|unit|notes? due|depositary/i.test(r.name) && !/(W|WS|R|U)$/.test(r.symbol.length > 4 ? r.symbol : '');
  const ndx = map(s.Nasdaq100Movers).filter((r) => r.changePct != null);
  return {
    asOf: (s.Nasdaq100Movers?.dataAsOf || s.MostAdvanced?.dataAsOf || '').replace(/^Data as of /, '') || null,
    ndxGainers: [...ndx].sort((a, b) => b.changePct - a.changePct).slice(0, 10),
    ndxLosers: [...ndx].sort((a, b) => a.changePct - b.changePct).slice(0, 10),
    gainers: map(s.MostAdvanced).filter(tradable).slice(0, 10),
    losers: map(s.MostDeclined).filter(tradable).slice(0, 10),
    active: map(s.MostActiveByDollarVolume).slice(0, 10),
  };
}

export async function nasdaqEarnings(dateISO) {
  const json = await nq(`/calendar/earnings?date=${dateISO}`);
  return (json.data?.rows || []).map((r) => ({
    symbol: fromNasdaq(r.symbol),
    name: r.name,
    time: r.time === 'time-pre-market' ? 'BMO' : r.time === 'time-after-hours' ? 'AMC' : '—',
    marketCap: num(r.marketCap),
    fiscalQuarter: r.fiscalQuarterEnding,
    epsForecast: num(r.epsForecast),
    numEstimates: num(r.noOfEsts),
    lastYearEPS: num(r.lastYearEPS),
    lastYearDate: r.lastYearRptDt,
  }));
}

export async function nasdaqEconomic(dateISO) {
  const json = await nq(`/calendar/economicevents?date=${dateISO}`);
  const clean = (v) => (v == null ? '' : String(v).replace(/&nbsp;/g, '').trim());
  return (json.data?.rows || []).map((r) => ({
    timeGMT: r.gmt,
    country: r.country,
    event: clean(r.eventName),
    actual: clean(r.actual),
    consensus: clean(r.consensus),
    previous: clean(r.previous),
  }));
}

export async function nasdaqNews(sym) {
  const cls = await guessClass(sym);
  const q = encodeURIComponent(`${toNasdaq(sym).toLowerCase()}|${cls}`);
  const json = await getJSON(`https://www.nasdaq.com/api/news/topic/articlebysymbol?q=${q}&offset=0&limit=25&fallback=true`, {
    headers: headers(),
    timeout: 12000,
  });
  return (json.data?.rows || []).map((r) => ({
    title: r.title,
    link: r.url?.startsWith('http') ? r.url : `https://www.nasdaq.com${r.url}`,
    summary: r.description || '',
    published: parseAgo(r.ago) ?? (Date.parse(r.created) ? new Date(Date.parse(r.created)).toISOString() : null),
    source: r.publisher ? `${r.publisher} via Nasdaq` : 'Nasdaq',
    symbols: (r.related_symbols || []).map((x) => fromNasdaq(String(x).split('|')[0])).slice(0, 12),
  }));
}

function parseAgo(ago) {
  const m = String(ago || '').match(/(\d+)\s+(minute|hour|day)s?\s+ago/i);
  if (!m) return null;
  const unit = { minute: 60e3, hour: 3600e3, day: 86400e3 }[m[2].toLowerCase()];
  return new Date(Date.now() - Number(m[1]) * unit).toISOString();
}

// Nasdaq-100 constituents with market caps (used as a QQQ holdings approximation fallback).
export async function nasdaq100List() {
  const json = await nq('/quote/list-type/nasdaq100');
  return (json.data?.data?.rows || []).map((r) => ({ symbol: fromNasdaq(r.symbol), name: cleanName(r.companyName), marketCap: num(r.marketCap) }));
}
