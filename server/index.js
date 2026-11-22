// FinTerm server: serves the terminal UI and a small JSON API that aggregates
// free, public market-data sources (with caching and provider fallback).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from './config.js';
import { HttpError } from './lib/http.js';
import { normalizeSymbol, classify } from './lib/symbols.js';
import { nyDate } from './lib/time.js';
import { getQuotes } from './services/quotes.js';
import { getHistory, RANGE_KEYS } from './services/history.js';
import { categoryNews, symbolNews, CATEGORIES } from './services/news.js';
import { etfHoldings } from './services/etf.js';
import { nasdaqMovers, nasdaqEarnings, nasdaqEconomic, nasdaqSummary } from './providers/nasdaq.js';
import { treasuryCurve, fredSeries, cryptoMarkets, ecbRates } from './providers/macro.js';
import { searchSecurities, companyProfile, fundamentals, lookupFund } from './providers/sec.js';
import { yahooStatus, yahooSearch } from './providers/yahoo.js';
import { biRate, indonesiaIndicators } from './providers/indonesia.js';
import { pheiData, globalCurves, treasuryByCusip, fxOnDate, interpolate } from './providers/bonds.js';
import { sbnInfo } from '../public/js/lib/bonds.js';
import { valuationData, peerMultiples } from './services/valuation.js';
import { cached } from './lib/cache.js';
import * as store from './store.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function send(res, status, body, headers = {}, req) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers };
  if (!h['Content-Type']) h['Content-Type'] = 'application/json; charset=utf-8';
  if (buf.length > 2048 && /gzip/.test(req?.headers['accept-encoding'] || '') && /json|text|javascript|css|svg/.test(h['Content-Type'])) {
    buf = zlib.gzipSync(buf);
    h['Content-Encoding'] = 'gzip';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(buf);
}

const symbolsParam = (q) =>
  String(q.get('s') || q.get('symbols') || '')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean);

function requireSymbol(q) {
  const s = symbolsParam(q)[0];
  if (!s) throw new HttpError('Missing ?s=SYMBOL', { status: 400 });
  return s;
}

async function readBody(req, limit = 6e6) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError('Request body too large', { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---- API routes ------------------------------------------------------------
const routes = {
  'GET /api/health': async () => ({
    ok: true,
    time: new Date().toISOString(),
    providers: { yahoo: yahooStatus() },
  }),

  'GET /api/quotes': async (q) => getQuotes(symbolsParam(q)),

  'GET /api/chart': async (q) => {
    const range = q.get('range') || '1y';
    if (!RANGE_KEYS.includes(range)) throw new HttpError(`range must be one of ${RANGE_KEYS.join(', ')}`, { status: 400 });
    return getHistory(requireSymbol(q), range);
  },

  // Multiple symbols' daily history (for portfolio analytics).
  'GET /api/history': async (q) => {
    const syms = symbolsParam(q).slice(0, 30);
    const range = q.get('range') || '5y';
    const results = await Promise.allSettled(syms.map((s) => getHistory(s, range)));
    const series = {};
    const errors = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        const v = r.value;
        const yearAgo = Date.now() - 365 * 86400e3;
        const ttmDividends = v.dividends?.length || v.adjusted ? v.dividends.filter((d) => d.t >= yearAgo).reduce((sum, d) => sum + d.amount, 0) : null;
        series[syms[i]] = { dates: v.points.map((p) => p.d), close: v.points.map((p) => p.a ?? p.c), adjusted: v.adjusted, source: v.source, name: v.name, ttmDividends };
      } else errors[syms[i]] = r.reason.message;
    });
    return { range, series, errors };
  },

  'GET /api/profile': async (q) => {
    const s = requireSymbol(q);
    const [summary, sec, fund] = await Promise.allSettled([
      classify(s) === 'us' ? nasdaqSummary(s) : Promise.reject(new Error('Nasdaq summary covers US listings only')),
      companyProfile(s),
      lookupFund(s),
    ]);
    return {
      symbol: s,
      summary: summary.status === 'fulfilled' ? summary.value : null,
      sec: sec.status === 'fulfilled' ? sec.value : null,
      isFund: (fund.status === 'fulfilled' && !!fund.value) || (summary.status === 'fulfilled' && summary.value.assetClass === 'etf'),
      errors: [summary, sec].filter((r) => r.status === 'rejected').map((r) => r.reason.message),
    };
  },

  'GET /api/fundamentals': async (q) => fundamentals(requireSymbol(q)),

  // VAL screen: analyst views, financials, beta, dividends, risk-free rate, peer list.
  'GET /api/valuation': async (q) => valuationData(requireSymbol(q)),
  'GET /api/valuation/peers': async (q) => {
    const syms = symbolsParam(q);
    if (!syms.length) throw new HttpError('Missing ?s=PEER1,PEER2', { status: 400 });
    return peerMultiples(syms);
  },

  'GET /api/news': async (q) => {
    const s = symbolsParam(q)[0];
    if (s) return symbolNews(s, q.get('name') || '');
    const cat = q.get('cat') || 'top';
    if (cat !== 'all' && !CATEGORIES.includes(cat)) throw new HttpError(`cat must be one of all, ${CATEGORIES.join(', ')}`, { status: 400 });
    return categoryNews(cat, Number(q.get('limit')) || 60);
  },

  'GET /api/movers': async () => cached('movers', 60e3, nasdaqMovers),

  'GET /api/calendar/earnings': async (q) => {
    const date = q.get('date') || nyDate();
    return cached(`earn:${date}`, 30 * 60e3, async () => ({ date, rows: await nasdaqEarnings(date), source: 'Nasdaq earnings calendar' }));
  },

  'GET /api/calendar/economic': async (q) => {
    const date = q.get('date') || nyDate();
    return cached(`econ:${date}`, 15 * 60e3, async () => ({ date, rows: await nasdaqEconomic(date), source: 'Nasdaq economic calendar' }));
  },

  'GET /api/yields': async () => treasuryCurve(),

  'GET /api/fred': async (q) => {
    const ids = String(q.get('ids') || '')
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter((x) => /^[A-Z0-9_]{2,40}$/.test(x))
      .slice(0, 20);
    if (!ids.length) throw new HttpError('Missing ?ids=SERIES1,SERIES2', { status: 400 });
    const start = /^\d{4}-\d{2}-\d{2}$/.test(q.get('start') || '') ? q.get('start') : undefined;
    const results = await Promise.allSettled(ids.map((id) => fredSeries(id, start)));
    const series = {};
    const errors = {};
    results.forEach((r, i) => (r.status === 'fulfilled' ? (series[ids[i]] = r.value) : (errors[ids[i]] = r.reason.message)));
    return { series, errors };
  },

  'GET /api/crypto': async (q) => ({ coins: await cryptoMarkets(Math.min(50, Number(q.get('n')) || 20)), source: 'CoinGecko' }),

  'GET /api/fx': async () => ecbRates(),

  // ---- bonds ----
  'GET /api/bonds/overview': async () => {
    const [curves, phei] = await Promise.allSettled([globalCurves(), pheiData()]);
    return {
      curves: curves.status === 'fulfilled' ? curves.value.curves : [],
      curveErrors: curves.status === 'fulfilled' ? curves.value.errors : { all: curves.reason.message },
      phei: phei.status === 'fulfilled' ? phei.value : null,
      errors: [curves, phei].filter((r) => r.status === 'rejected').map((r) => r.reason.message),
    };
  },

  // PHEI fair prices only (fast; used to value bonds in PORT).
  'GET /api/bonds/phei': async () => pheiData(),

  'GET /api/bonds/search': async (q) => {
    const query = String(q.get('q') || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!query) throw new HttpError('Missing ?q=', { status: 400 });
    const info = sbnInfo(query);
    if (info) {
      const [phei, bi] = await Promise.allSettled([pheiData(), biRate()]);
      const p = phei.status === 'fulfilled' ? phei.value : null;
      return {
        kind: 'sbn',
        query,
        info,
        row: p?.series.find((s) => s.series === info.series) || null,
        asOf: p?.asOf || null,
        curve: p?.curve || [],
        biRate: bi.status === 'fulfilled' ? bi.value.decisions : [],
        source: p?.source || null,
        sourceUrl: p?.sourceUrl || null,
      };
    }
    const tenor = /^(?:US|UST|T)(\d{1,2})(Y|M)$/.exec(query);
    if (tenor) {
      const { curves } = await globalCurves();
      const us = curves.find((c) => c.code === 'US');
      const years = Number(tenor[1]) / (tenor[2] === 'M' ? 12 : 1);
      return { kind: 'curve-point', query, country: 'United States', years, yield: us ? interpolate(us.points, years) : null, curve: us };
    }
    if (/^[0-9A-Z]{9}$/.test(query) && /\d/.test(query)) {
      try {
        return { kind: 'treasury', query, security: await treasuryByCusip(query) };
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
    return { kind: 'none', query };
  },

  'GET /api/fx/on': async (q) => fxOnDate(String(q.get('date') || ''), String(q.get('base') || 'USD').toUpperCase(), String(q.get('quote') || 'IDR').toUpperCase()),

  // Indonesia: Bank Indonesia policy rate + IMF/World Bank macro indicators.
  'GET /api/indonesia/macro': async () => {
    const [rate, ind] = await Promise.allSettled([biRate(), indonesiaIndicators()]);
    return {
      biRate: rate.status === 'fulfilled' ? rate.value : null,
      indicators: ind.status === 'fulfilled' ? ind.value : null,
      errors: [rate, ind].filter((r) => r.status === 'rejected').map((r) => r.reason.message),
    };
  },

  'GET /api/etf/holdings': async (q) => etfHoldings(requireSymbol(q)),

  'GET /api/search': async (q) => {
    const query = String(q.get('q') || '').slice(0, 40);
    const local = await searchSecurities(query).catch(() => []);
    if (local.length >= 5 || !yahooStatus().available) return { results: local };
    const remote = await yahooSearch(query).catch(() => []);
    const seen = new Set(local.map((r) => r.symbol));
    return { results: [...local, ...remote.filter((r) => !seen.has(r.symbol))].slice(0, 12) };
  },

  'GET /api/portfolio': async () => store.load(),

  'PUT /api/portfolio': async (q, req) => {
    let doc;
    try {
      doc = JSON.parse(await readBody(req));
    } catch {
      throw new HttpError('Body must be JSON', { status: 400 });
    }
    return store.save(doc);
  },
};

// ---- static files ------------------------------------------------------------
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(config.publicDir, rel));
  if (!file.startsWith(config.publicDir + path.sep)) return send(res, 403, { error: 'Forbidden' }, {}, req);
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    return send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, req);
  } catch {
    // SPA fallback for client-side routes like /eq/AAPL
    if (!path.extname(rel)) {
      const index = await fs.readFile(path.join(config.publicDir, 'index.html'));
      return send(res, 200, index, { 'Content-Type': MIME['.html'] }, req);
    }
    return send(res, 404, { error: 'Not found' }, {}, req);
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;
  try {
    // DNS-rebinding guard: when bound to loopback, only answer to loopback host names.
    if (LOOPBACK.has(config.host) && !LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, ''))) {
      throw new HttpError('Host not allowed', { status: 403 });
    }
    if (url.pathname.startsWith('/api/')) {
      // The API is meant for this UI only: reject cross-site browser requests.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError('Cross-origin requests are not allowed', { status: 403 });
      const handler = routes[key];
      if (!handler) throw new HttpError(`No route ${key}`, { status: 404 });
      const t0 = Date.now();
      const body = await handler(url.searchParams, req);
      if (config.logRequests) console.log(`[api] ${key}${url.search} ${Date.now() - t0}ms`);
      return send(res, 200, body, {}, req);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError('Method not allowed', { status: 405 });
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err instanceof HttpError && err.status >= 400 && err.status < 600 ? (err.status === 429 ? 503 : err.status) : 502;
    if (status >= 500 && config.logRequests) console.warn(`[api] ${key} -> ${status}: ${err.message}`);
    return send(res, status, { error: err.message }, {}, req);
  }
});

server.listen(config.port, config.host, () => {
  const where = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  console.log(`\n  FinTerm running at ${where}\n  Your portfolio data is stored in ${config.userDataDir}\n`);
});
