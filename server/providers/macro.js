// Official macro & reference-rate sources:
//  - U.S. Treasury daily par yield curve (home.treasury.gov)
//  - FRED, Federal Reserve Bank of St. Louis (fred.stlouisfed.org)
//  - CBOE delayed index quotes (cdn.cboe.com) — fallback for S&P 500 / VIX / Russell
//  - Frankfurter (ECB euro foreign exchange reference rates)
//  - CoinGecko (crypto market data)
import { getText, getJSON, browserHeaders, HttpError } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseCSV, num } from '../lib/csv.js';
import { mdyToISO, parseETDateTime } from '../lib/time.js';
import { config } from '../config.js';

// ---- Treasury ----------------------------------------------------------------
const TENOR_YEARS = {
  '1 Mo': 1 / 12, '1.5 Month': 1.5 / 12, '2 Mo': 2 / 12, '3 Mo': 0.25, '4 Mo': 4 / 12, '6 Mo': 0.5,
  '1 Yr': 1, '2 Yr': 2, '3 Yr': 3, '5 Yr': 5, '7 Yr': 7, '10 Yr': 10, '20 Yr': 20, '30 Yr': 30,
};

export function parseTreasuryCSV(text) {
  const rows = parseCSV(text);
  const header = rows.shift().map((h) => h.trim());
  const tenors = header.slice(1).filter((h) => h in TENOR_YEARS);
  return rows
    .map((r) => {
      const date = mdyToISO(r[0]);
      const yields = {};
      header.forEach((h, i) => {
        if (i > 0 && h in TENOR_YEARS) {
          const v = num(r[i]);
          if (v != null) yields[h] = v;
        }
      });
      return { date, yields };
    })
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ ...r, tenors }));
}

async function treasuryYear(year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  return parseTreasuryCSV(await getText(url, { headers: browserHeaders({ Accept: 'text/csv' }), timeout: 20000 }));
}

export async function treasuryCurve() {
  return cached('treasury:curve', 30 * 60e3, async () => {
    const y = new Date().getUTCFullYear();
    const [prev, cur] = await Promise.all([treasuryYear(y - 1).catch(() => []), treasuryYear(y)]);
    const all = [...prev, ...cur];
    if (!all.length) throw new HttpError('Treasury yield data unavailable', { status: 502 });
    const latest = all.at(-1);
    const findBack = (daysBack) => {
      const target = new Date(Date.parse(latest.date) - daysBack * 86400e3).toISOString().slice(0, 10);
      for (let i = all.length - 1; i >= 0; i--) if (all[i].date <= target) return all[i];
      return all[0];
    };
    const tenors = Object.keys(TENOR_YEARS).filter((t) => latest.yields[t] != null);
    return {
      source: 'U.S. Department of the Treasury — Daily Par Yield Curve Rates',
      sourceUrl: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates',
      tenors: tenors.map((t) => ({ label: t, years: TENOR_YEARS[t] })),
      latest,
      previous: all.at(-2) || null,
      weekAgo: findBack(7),
      monthAgo: findBack(30),
      yearAgo: findBack(365),
      // Compact history of key tenors for charts.
      history: all.map((r) => ({ date: r.date, '3 Mo': r.yields['3 Mo'], '2 Yr': r.yields['2 Yr'], '10 Yr': r.yields['10 Yr'], '30 Yr': r.yields['30 Yr'] })),
    };
  });
}

// ---- FRED --------------------------------------------------------------------
export function parseFredCSV(text) {
  const rows = parseCSV(text);
  rows.shift(); // observation_date,SERIES  (or DATE,SERIES)
  return rows
    .map(([d, v]) => ({ date: d, value: num(v) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.value != null);
}

export async function fredSeries(id, start) {
  const startDate = start || new Date(Date.now() - 6 * 365 * 86400e3).toISOString().slice(0, 10);
  return cached(`fred:${id}:${startDate}`, 3 * 3600e3, async () => {
    let points;
    if (config.fredApiKey) {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id)}&api_key=${config.fredApiKey}&file_type=json&observation_start=${startDate}`;
      const json = await getJSON(url, { timeout: 20000 });
      points = (json.observations || []).map((o) => ({ date: o.date, value: num(o.value) })).filter((p) => p.value != null);
    } else {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${startDate}`;
      points = parseFredCSV(await getText(url, { headers: browserHeaders({ Accept: 'text/csv' }), timeout: 20000 }));
    }
    if (!points.length) throw new HttpError(`FRED series ${id} returned no data`, { status: 502 });
    return { id, points, source: 'FRED, Federal Reserve Bank of St. Louis', sourceUrl: `https://fred.stlouisfed.org/series/${id}` };
  });
}

// ---- CBOE delayed index quotes ---------------------------------------------
export async function cboeQuote(cboeSymbol) {
  const json = await getJSON(`https://cdn.cboe.com/api/global/delayed_quotes/quotes/${cboeSymbol}.json`, { timeout: 10000 });
  const d = json?.data;
  if (!d || d.current_price == null) throw new HttpError(`CBOE: no data for ${cboeSymbol}`, { status: 404 });
  return {
    price: Number(d.current_price),
    change: num(d.price_change),
    changePct: num(d.price_change_percent),
    prevClose: num(d.prev_day_close ?? d.close),
    open: num(d.open),
    high: num(d.high),
    low: num(d.low),
    time: d.last_trade_time ? new Date(parseETDateTime(d.last_trade_time)).toISOString() : null,
  };
}

// ---- Frankfurter (ECB reference rates) --------------------------------------
export async function ecbRates() {
  return cached('ecb:rates', 3600e3, async () => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 12 * 86400e3).toISOString().slice(0, 10);
    const json = await getJSON(`https://api.frankfurter.dev/v1/${start}..${end}?base=USD`, { timeout: 10000 });
    const dates = Object.keys(json.rates || {}).sort();
    if (!dates.length) throw new HttpError('ECB rates unavailable', { status: 502 });
    return { date: dates.at(-1), latest: json.rates[dates.at(-1)], previous: json.rates[dates.at(-2)] || null };
  });
}

// USD-based ECB rates -> quote for a pair like EUR/USD or USD/JPY.
export async function ecbPair(base, quote) {
  const r = await ecbRates();
  const rate = (rates, ccy) => (ccy === 'USD' ? 1 : rates?.[ccy]);
  const px = (rates) => {
    const b = rate(rates, base);
    const q = rate(rates, quote);
    return b && q ? q / b : null;
  };
  const price = px(r.latest);
  if (price == null) throw new HttpError(`ECB has no rate for ${base}/${quote}`, { status: 404 });
  const prev = px(r.previous);
  return { price, prevClose: prev, change: prev ? price - prev : null, changePct: prev ? ((price - prev) / prev) * 100 : null, time: `${r.date}T16:00:00.000Z` };
}

// ---- CoinGecko -----------------------------------------------------------------
export async function cryptoMarkets(perPage = 20) {
  return cached(`cg:markets:${perPage}`, 60e3, async () => {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d`;
    const rows = await getJSON(url, { timeout: 12000 });
    return rows.map((c) => ({
      id: c.id,
      symbol: `${c.symbol.toUpperCase()}-USD`,
      name: c.name,
      price: c.current_price,
      change: c.price_change_24h,
      changePct: c.price_change_percentage_24h,
      change1h: c.price_change_percentage_1h_in_currency,
      change7d: c.price_change_percentage_7d_in_currency,
      change30d: c.price_change_percentage_30d_in_currency,
      marketCap: c.market_cap,
      volume: c.total_volume,
      high: c.high_24h,
      low: c.low_24h,
      ath: c.ath,
      athChangePct: c.ath_change_percentage,
      rank: c.market_cap_rank,
      spark: (c.sparkline_in_7d?.price || []).filter((_, i) => i % 3 === 0),
      time: c.last_updated,
    }));
  });
}

export async function coingeckoSimple(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true`;
  return getJSON(url, { timeout: 10000 });
}
