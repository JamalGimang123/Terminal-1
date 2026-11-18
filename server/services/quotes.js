// Unified real-time quote service with provider fallback chains:
//   US stocks/ETFs : Nasdaq (real-time last sale)  -> Yahoo
//   Indices        : Yahoo -> Nasdaq index / CBOE delayed
//   FX             : Yahoo -> ECB reference rates (Frankfurter)
//   Crypto         : Yahoo -> CoinGecko
//   Futures/intl   : Yahoo
import { cached } from '../lib/cache.js';
import { mapLimit } from '../lib/http.js';
import { normalizeSymbol, classify, INDEX_FALLBACK, COINGECKO_IDS, fxPair, currencyOf } from '../lib/symbols.js';
import { nasdaqQuotes } from '../providers/nasdaq.js';
import { yahooQuote, yahooSpark, yahooStatus } from '../providers/yahoo.js';
import { cboeQuote, ecbPair, coingeckoSimple } from '../providers/macro.js';

const TTL = { us: 10e3, default: 30e3 };
const fail = new Map(); // symbol -> last error message

function base(sym, extra) {
  return { symbol: sym, name: sym, price: null, change: null, changePct: null, prevClose: null, ...extra };
}

async function viaYahoo(symbols) {
  const out = {};
  if (!symbols.length || !yahooStatus().available) return out;
  try {
    Object.assign(out, await yahooSpark(symbols));
  } catch {
    /* spark failed — try per-symbol charts below */
  }
  const rest = symbols.filter((s) => !out[s]);
  if (rest.length && yahooStatus().available) {
    const res = await mapLimit(rest, 4, (s) => yahooQuote(s));
    res.forEach((r, i) => {
      if (r.ok) out[rest[i]] = r.value;
      else fail.set(rest[i], r.error.message);
    });
  }
  return out;
}

async function fallbackIndex(sym) {
  const fb = INDEX_FALLBACK[sym];
  if (!fb) return null;
  if (fb.nasdaq) {
    try {
      const q = (await nasdaqQuotes([fb.nasdaq]))[fb.nasdaq];
      if (q?.price != null) return { ...q, symbol: sym, source: 'Nasdaq', realtime: false };
    } catch {
      /* try CBOE */
    }
  }
  if (fb.cboe) {
    const q = await cboeQuote(fb.cboe);
    const k = fb.scale || 1;
    const scale = (v) => (v == null ? null : v * k);
    return base(sym, {
      price: scale(q.price),
      change: scale(q.change),
      changePct: q.changePct,
      prevClose: scale(q.prevClose),
      open: scale(q.open),
      high: scale(q.high),
      low: scale(q.low),
      time: q.time,
      source: fb.scale ? `CBOE (${fb.cboe} × ${fb.scale}, delayed)` : 'CBOE (15-min delayed)',
      delayed: true,
    });
  }
  return null;
}

async function fallbackFx(sym) {
  const pair = fxPair(sym);
  if (!pair) return null;
  const q = await ecbPair(pair[0], pair[1]);
  return base(sym, { ...q, source: 'ECB reference rate (daily)', delayed: true });
}

async function fallbackCrypto(symbols) {
  const ids = symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean);
  if (!ids.length) return {};
  const data = await coingeckoSimple(ids);
  const out = {};
  for (const s of symbols) {
    const d = data[COINGECKO_IDS[s]];
    if (!d) continue;
    const price = d.usd;
    const pct = d.usd_24h_change;
    const prev = pct != null ? price / (1 + pct / 100) : null;
    out[s] = base(s, { price, changePct: pct, change: prev != null ? price - prev : null, prevClose: prev, volume: d.usd_24h_vol, time: d.last_updated_at ? new Date(d.last_updated_at * 1000).toISOString() : null, source: 'CoinGecko' });
  }
  return out;
}

async function fetchQuotes(symbols) {
  const out = {};
  const us = symbols.filter((s) => classify(s) === 'us');
  const other = symbols.filter((s) => classify(s) !== 'us');

  // 1) US stocks & ETFs from Nasdaq in one batched request.
  if (us.length) {
    try {
      Object.assign(out, await nasdaqQuotes(us));
    } catch (err) {
      us.forEach((s) => fail.set(s, err.message));
    }
  }
  // 2) Everything else (and US misses) from Yahoo.
  const needYahoo = [...other, ...us.filter((s) => !out[s])];
  Object.assign(out, await viaYahoo(needYahoo));

  // 3) Fallbacks for what is still missing.
  const missing = symbols.filter((s) => !out[s]);
  const cryptoMissing = missing.filter((s) => classify(s) === 'crypto');
  if (cryptoMissing.length) {
    try {
      Object.assign(out, await fallbackCrypto(cryptoMissing));
    } catch (err) {
      cryptoMissing.forEach((s) => fail.set(s, err.message));
    }
  }
  await mapLimit(
    missing.filter((s) => !out[s]),
    4,
    async (s) => {
      try {
        const kind = classify(s);
        const q = kind === 'index' ? await fallbackIndex(s) : kind === 'fx' ? await fallbackFx(s) : null;
        if (q) out[s] = q;
      } catch (err) {
        fail.set(s, err.message);
      }
    },
  );
  return out;
}

// Public: get quotes for many symbols, using a short per-symbol cache.
export async function getQuotes(rawSymbols) {
  const symbols = [...new Set(rawSymbols.map(normalizeSymbol).filter(Boolean))].slice(0, 120);
  const result = {};
  const toFetch = [];
  const now = Date.now();
  for (const s of symbols) {
    const hit = quoteCache.get(s);
    if (hit && hit.exp > now) result[s] = hit.q;
    else toFetch.push(s);
  }
  if (toFetch.length) {
    const fresh = await cached(`qbatch:${toFetch.join(',')}`, 5e3, () => fetchQuotes(toFetch));
    for (const s of toFetch) {
      if (fresh[s]) {
        const ttl = classify(s) === 'us' ? TTL.us : TTL.default;
        quoteCache.set(s, { q: fresh[s], exp: Date.now() + ttl });
        result[s] = fresh[s];
      } else {
        // Serve the last good quote (flagged stale) rather than nothing.
        const old = quoteCache.get(s);
        if (old) result[s] = { ...old.q, stale: true };
      }
    }
  }
  const errors = {};
  for (const s of symbols) if (!result[s]) errors[s] = fail.get(s) || 'No data from any source';
  for (const [s, q] of Object.entries(result)) if (!q.currency) result[s] = { ...q, currency: currencyOf(s) };
  return { quotes: result, errors };
}

const quoteCache = new Map();
