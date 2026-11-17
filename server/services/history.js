// Price history with provider fallback: Yahoo (dividend-adjusted) -> Nasdaq (split-adjusted).
import { cached } from '../lib/cache.js';
import { HttpError } from '../lib/http.js';
import { normalizeSymbol, classify } from '../lib/symbols.js';
import { yahooChart, yahooStatus } from '../providers/yahoo.js';
import { nasdaqHistory, nasdaqIntraday } from '../providers/nasdaq.js';

// chart range -> Yahoo params + lookback days for the Nasdaq fallback
const RANGES = {
  '1d': { range: '1d', interval: '5m', days: 1, ttl: 60e3 },
  '5d': { range: '5d', interval: '15m', days: 7, ttl: 5 * 60e3 },
  '1mo': { range: '1mo', interval: '60m', days: 31, ttl: 15 * 60e3 },
  '3mo': { range: '3mo', interval: '1d', days: 92, ttl: 30 * 60e3 },
  '6mo': { range: '6mo', interval: '1d', days: 183, ttl: 30 * 60e3 },
  ytd: { range: 'ytd', interval: '1d', days: null, ttl: 30 * 60e3 },
  '1y': { range: '1y', interval: '1d', days: 366, ttl: 30 * 60e3 },
  '2y': { range: '2y', interval: '1d', days: 731, ttl: 60 * 60e3 },
  '3y': { range: '5y', interval: '1d', days: 1096, ttl: 60 * 60e3, trimDays: 1096 },
  '5y': { range: '5y', interval: '1d', days: 1827, ttl: 60 * 60e3 },
  '10y': { range: '10y', interval: '1d', days: 3653, ttl: 3 * 3600e3 },
  max: { range: 'max', interval: '1wk', days: 3653, ttl: 6 * 3600e3 },
};

export const RANGE_KEYS = Object.keys(RANGES);

function fromDate(days) {
  if (days == null) return `${new Date().getUTCFullYear()}-01-01`;
  return new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
}

function withDates(points, gmtoffsetSec = -5 * 3600) {
  return points.map((p) => ({ ...p, d: new Date(p.t + gmtoffsetSec * 1000).toISOString().slice(0, 10) }));
}

export async function getHistory(rawSym, rangeKey = '1y') {
  const sym = normalizeSymbol(rawSym);
  const cfg = RANGES[rangeKey] || RANGES['1y'];
  return cached(`hist:${sym}:${rangeKey}`, cfg.ttl, async () => {
    const errors = [];
    if (yahooStatus().available) {
      try {
        const r = await yahooChart(sym, { range: cfg.range, interval: cfg.interval });
        let points = withDates(r.points, r.meta.gmtoffset ?? -5 * 3600);
        if (cfg.trimDays) {
          const cut = Date.now() - cfg.trimDays * 86400e3;
          points = points.filter((p) => p.t >= cut);
        }
        if (points.length) {
          return {
            symbol: sym,
            range: rangeKey,
            interval: cfg.interval,
            name: r.meta.longName || r.meta.shortName || sym,
            currency: r.meta.currency || 'USD',
            prevClose: r.meta.chartPreviousClose ?? null,
            points,
            dividends: r.dividends,
            splits: r.splits,
            adjusted: r.adjusted,
            source: 'Yahoo Finance',
          };
        }
      } catch (err) {
        errors.push(`Yahoo: ${err.message}`);
      }
    } else errors.push('Yahoo: rate-limited (cooling down)');

    // Nasdaq covers US stocks/ETFs and the Nasdaq indices.
    const nasdaqSym = sym === '^IXIC' ? 'COMP' : sym === '^NDX' ? 'NDX' : sym;
    if (classify(sym) === 'us' || nasdaqSym !== sym) {
      try {
        if (rangeKey === '1d') {
          const r = await nasdaqIntraday(nasdaqSym);
          if (r.points.length)
            return { symbol: sym, range: rangeKey, interval: '1m', name: r.name, currency: 'USD', prevClose: r.prevClose, points: withDates(r.points), dividends: [], splits: [], adjusted: false, source: 'Nasdaq' };
        } else {
          const r = await nasdaqHistory(nasdaqSym, fromDate(cfg.days));
          let points = r.points;
          if (rangeKey === 'max' && points.length > 600) points = points.filter((_, i) => i % 5 === 0 || i === points.length - 1);
          if (points.length)
            return { symbol: sym, range: rangeKey, interval: '1d', name: sym, currency: 'USD', prevClose: null, points: withDates(points), dividends: [], splits: [], adjusted: false, source: 'Nasdaq (price only, not dividend-adjusted)' };
        }
      } catch (err) {
        errors.push(`Nasdaq: ${err.message}`);
      }
    }
    throw new HttpError(`No price history for ${sym}. ${errors.join('; ')}`, { status: 502 });
  });
}
