// Yahoo Finance public chart API (no key). Broadest coverage: indices,
// futures, FX, crypto, international listings, and dividend-adjusted history.
// Yahoo rate-limits aggressively (HTTP 429), so we back off and let the
// quote/history services fall back to other providers.
import { request, browserHeaders, HttpError } from '../lib/http.js';
import { parseFeed } from '../lib/xml.js';

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
let cookie = '';
let cookieFetchedAt = 0;
let cooldownUntil = 0;
let cooldownMs = 30e3;
let lastError = null;
let lastOk = 0;

const disabled = process.env.DISABLE_YAHOO === '1';

export function yahooStatus() {
  return {
    available: !disabled && Date.now() >= cooldownUntil,
    disabled,
    cooldownUntil: cooldownUntil > Date.now() ? new Date(cooldownUntil).toISOString() : null,
    lastOk: lastOk ? new Date(lastOk).toISOString() : null,
    lastError,
  };
}

let cookiePromise = null;
function ensureCookie() {
  const age = Date.now() - cookieFetchedAt;
  if ((cookie && age < 6 * 3600e3) || (!cookie && age < 5 * 60e3)) return Promise.resolve(); // failed fetches retry after 5 min
  // Concurrent callers share one fetch, so nobody proceeds without the cookie.
  cookiePromise ||= fetchCookie().finally(() => (cookiePromise = null));
  return cookiePromise;
}
async function fetchCookie() {
  cookieFetchedAt = Date.now();
  try {
    const res = await fetch('https://fc.yahoo.com/', { headers: browserHeaders({ Accept: 'text/html' }), redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const a3 = set.map((c) => c.split(';')[0]).filter((c) => /^A[13S]?=/.test(c));
    if (a3.length) cookie = a3.join('; ');
  } catch {
    /* cookie is optional */
  }
}

// `auth`: a 401/403 means a stale session crumb, not rate-limiting (no cooldown).
async function yget(pathAndQuery, { auth = false } = {}) {
  if (disabled) throw new HttpError('Yahoo Finance disabled (DISABLE_YAHOO=1)', { status: 503 });
  if (Date.now() < cooldownUntil) {
    throw new HttpError('Yahoo Finance is rate-limiting; cooling down', { status: 429 });
  }
  await ensureCookie();
  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await request(`https://${host}${pathAndQuery}`, {
        headers: browserHeaders(cookie ? { Cookie: cookie } : {}),
        timeout: 12000,
      });
      lastOk = Date.now();
      cooldownMs = 30e3;
      lastError = null;
      return res;
    } catch (err) {
      lastErr = err;
      if (err.status === 404 || (auth && err.status === 401)) throw err; // not found / stale crumb: don't retry other host
    }
  }
  if (auth && (lastErr?.status === 401 || lastErr?.status === 403)) throw lastErr;
  if (lastErr?.status === 429 || lastErr?.status === 401 || lastErr?.status === 403) {
    cooldownUntil = Date.now() + cooldownMs;
    cooldownMs = Math.min(cooldownMs * 2, 15 * 60e3);
  }
  lastError = lastErr?.message || 'unknown error';
  throw lastErr;
}

export async function yahooChart(symbol, { range = '1d', interval = '5m', prepost = false } = {}) {
  const q = new URLSearchParams({ range, interval, includePrePost: String(prepost), events: 'div,split' });
  const res = await yget(`/v8/finance/chart/${encodeURIComponent(symbol)}?${q}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new HttpError(json?.chart?.error?.description || `No Yahoo data for ${symbol}`, { status: 404 });
  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const q0 = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q0.close?.[i];
    if (c == null) continue;
    points.push({
      t: ts[i] * 1000,
      o: q0.open?.[i] ?? c,
      h: q0.high?.[i] ?? c,
      l: q0.low?.[i] ?? c,
      c,
      v: q0.volume?.[i] ?? 0,
      a: adj ? adj[i] ?? c : c,
    });
  }
  const dividends = Object.values(result.events?.dividends || {}).map((d) => ({ t: d.date * 1000, amount: d.amount }));
  const splits = Object.values(result.events?.splits || {}).map((s) => ({ t: s.date * 1000, ratio: `${s.numerator}:${s.denominator}` }));
  return { meta, points, dividends, splits, adjusted: !!adj };
}

function marketState(meta) {
  const p = meta.currentTradingPeriod;
  if (!p) return null;
  const now = Date.now() / 1000;
  if (now >= p.regular?.start && now < p.regular?.end) return 'REGULAR';
  if (now >= p.pre?.start && now < p.pre?.end) return 'PRE';
  if (now >= p.post?.start && now < p.post?.end) return 'POST';
  return 'CLOSED';
}

export async function yahooQuote(symbol) {
  const { meta, points } = await yahooChart(symbol, { range: '1d', interval: '5m' });
  const price = meta.regularMarketPrice ?? points.at(-1)?.c;
  const prev = meta.previousClose ?? meta.chartPreviousClose;
  if (price == null) throw new HttpError(`No price for ${symbol}`, { status: 404 });
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    price,
    prevClose: prev ?? null,
    change: prev != null ? price - prev : null,
    changePct: prev ? ((price - prev) / prev) * 100 : null,
    open: points[0]?.o ?? null,
    high: meta.regularMarketDayHigh ?? null,
    low: meta.regularMarketDayLow ?? null,
    volume: meta.regularMarketVolume ?? null,
    high52: meta.fiftyTwoWeekHigh ?? null,
    low52: meta.fiftyTwoWeekLow ?? null,
    currency: meta.currency || 'USD',
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    type: meta.instrumentType || '',
    time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    marketState: marketState(meta),
    spark: points.map((p) => p.c),
    source: 'Yahoo Finance',
  };
}

// Batch "spark" endpoint: last price, previous close and an intraday sparkline
// for up to 20 symbols per request (far fewer requests than one chart each).
export async function yahooSpark(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    const q = new URLSearchParams({ symbols: chunk.join(','), range: '1d', interval: '5m' });
    const res = await yget(`/v8/finance/spark?${q}`);
    const json = await res.json();
    // v8 shape: { SYM: { timestamp, close, previousClose, chartPreviousClose, symbol } }
    // v7 shape: { spark: { result: [ { symbol, response: [ chart-like ] } ] } }
    const entries = json?.spark?.result
      ? json.spark.result.map((r) => {
          const c = r.response?.[0] || {};
          return [r.symbol, { close: c.indicators?.quote?.[0]?.close || [], timestamp: c.timestamp || [], previousClose: c.meta?.previousClose ?? c.meta?.chartPreviousClose, meta: c.meta }];
        })
      : Object.entries(json || {});
    for (const [sym, s] of entries) {
      const closes = (s.close || []).filter((v) => v != null);
      const price = s.meta?.regularMarketPrice ?? closes.at(-1);
      const prev = s.previousClose ?? s.chartPreviousClose;
      if (price == null) continue;
      const lastT = (s.timestamp || []).at(-1);
      out[sym] = {
        symbol: sym,
        name: s.meta?.longName || s.meta?.shortName || sym,
        currency: s.meta?.currency || null,
        price,
        prevClose: prev ?? null,
        change: prev != null ? price - prev : null,
        changePct: prev ? ((price - prev) / prev) * 100 : null,
        high: closes.length ? Math.max(...closes) : null,
        low: closes.length ? Math.min(...closes) : null,
        time: lastT ? new Date(lastT * 1000).toISOString() : null,
        spark: closes,
        source: 'Yahoo Finance',
      };
    }
  }
  return out;
}

export async function yahooSearch(query) {
  const q = new URLSearchParams({ q: query, quotesCount: '10', newsCount: '0', listsCount: '0' });
  const res = await yget(`/v1/finance/search?${q}`);
  const json = await res.json();
  return (json.quotes || [])
    .filter((x) => x.symbol)
    .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || '', exchange: x.exchDisp || x.exchange || '', type: x.quoteType || '' }));
}

export async function yahooNews(symbol) {
  if (disabled) throw new HttpError('Yahoo Finance disabled (DISABLE_YAHOO=1)', { status: 503 });
  // Yahoo's per-symbol RSS headline feed.
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const res = await request(url, { headers: browserHeaders({ Accept: 'application/rss+xml, text/xml' }), timeout: 10000 });
  return parseFeed(await res.text()).map((i) => ({ ...i, source: 'Yahoo Finance' }));
}

// ---- fundamentals & analyst data (quoteSummary needs a session "crumb") -----------------
let crumb = '';
let crumbAt = 0;
async function getCrumb(force = false) {
  if (!force && crumb && Date.now() - crumbAt < 6 * 3600e3) return crumb;
  if (force) {
    cookie = ''; // a new crumb needs a fresh cookie
    cookieFetchedAt = 0;
  }
  const res = await yget('/v1/test/getcrumb', { auth: true });
  const text = (await res.text()).trim();
  if (!text || text.length > 40 || /[<{\s]/.test(text)) throw new HttpError('Yahoo Finance: no session crumb', { status: 502 });
  crumb = text;
  crumbAt = Date.now();
  return crumb;
}

// Yahoo wraps numbers as {raw, fmt}; a missing value comes back as {}.
const raw = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? ('raw' in v ? v.raw : Object.keys(v).length ? v : null) : v);
// Flatten {raw, fmt} values one level deep; keep arrays/objects as-is otherwise.
export function flattenYahoo(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, raw(v)]));
}

export async function yahooQuoteSummary(symbol, modules) {
  const run = async (force) => {
    const c = await getCrumb(force);
    const res = await yget(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}&crumb=${encodeURIComponent(c)}`, { auth: true });
    return res.json();
  };
  let json;
  try {
    json = await run(false);
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    json = await run(true);
  }
  const r = json?.quoteSummary?.result?.[0];
  if (!r) throw new HttpError(json?.quoteSummary?.error?.description || `No fundamentals for ${symbol}`, { status: 404 });
  return r;
}

// Statement items by full key, e.g. ['annualTotalRevenue', 'trailingEBIT', 'quarterlyTotalDebt']
// -> { annual: {TotalRevenue: [{date, value}]}, trailing: {...}, quarterly: {...}, currency }
export async function yahooTimeseries(symbol, keys) {
  const now = Math.floor(Date.now() / 1000);
  const res = await yget(`/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${keys.join(',')}&period1=1420070400&period2=${now}`);
  const json = await res.json();
  const out = { annual: {}, trailing: {}, quarterly: {}, currency: null };
  for (const item of json?.timeseries?.result || []) {
    const key = item.meta?.type?.[0];
    if (!key || !item[key]) continue;
    const [, kind, name] = /^(annual|trailing|quarterly)(.+)$/.exec(key) || [];
    if (!kind) continue;
    const rows = item[key].filter(Boolean).map((x) => ({ date: x.asOfDate, value: x.reportedValue?.raw ?? null, currency: x.currencyCode })).filter((x) => x.value != null);
    if (rows.length) {
      out[kind][name] = rows.sort((a, b) => a.date.localeCompare(b.date));
      out.currency ||= rows.at(-1).currency || null;
    }
  }
  return out;
}

export async function yahooPeers(symbol) {
  const res = await yget(`/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`);
  const json = await res.json();
  return (json?.finance?.result?.[0]?.recommendedSymbols || []).map((x) => x.symbol).filter(Boolean);
}
