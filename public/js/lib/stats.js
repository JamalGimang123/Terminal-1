// Portfolio statistics, optimisation and Monte Carlo simulation.
// Pure functions, no DOM: used by the browser UI and by the node unit tests.

export const TRADING_DAYS = 252;

// ---- random numbers (seeded so results are reproducible) -------------------
export function mulberry32(seed = 42) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- basic statistics ------------------------------------------------------------
export const sum = (a) => a.reduce((s, x) => s + x, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);

export function variance(a, sample = true) {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) ** 2;
  return s / (sample ? n - 1 : n);
}

export const stdev = (a, sample = true) => Math.sqrt(variance(a, sample));

export function covariance(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

export function correlation(a, b) {
  const sa = stdev(a);
  const sb = stdev(b);
  return sa && sb ? covariance(a, b) / (sa * sb) : 0;
}

export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function histogram(values, bins = 30) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return [];
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }));
  for (const x of v) out[Math.min(bins - 1, Math.floor((x - lo) / w))].count++;
  return out;
}

// ---- price series ------------------------------------------------------------------
// series: { SYM: { dates: [...], close: [...] } } -> aligned on common dates.
export function alignSeries(series) {
  const syms = Object.keys(series);
  if (!syms.length) return { dates: [], prices: {} };
  const maps = syms.map((s) => {
    const m = new Map();
    series[s].dates.forEach((d, i) => {
      const c = series[s].close[i];
      if (Number.isFinite(c) && c > 0) m.set(d, c);
    });
    return m;
  });
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  const prices = {};
  syms.forEach((s, i) => (prices[s] = dates.map((d) => maps[i].get(d))));
  return { dates, prices };
}

export function toReturns(prices) {
  const r = [];
  for (let i = 1; i < prices.length; i++) r.push(prices[i] / prices[i - 1] - 1);
  return r;
}

// Compound daily returns into calendar-month returns (dates are YYYY-MM-DD, one per return).
export function monthlyReturns(dailyReturns, dates) {
  const out = [];
  let cur = null;
  let acc = 1;
  dailyReturns.forEach((r, i) => {
    const m = dates[i].slice(0, 7);
    if (cur !== null && m !== cur) {
      out.push(acc - 1);
      acc = 1;
    }
    cur = m;
    acc *= 1 + r;
  });
  if (cur !== null) out.push(acc - 1);
  return out;
}

export function growthSeries(returns, start = 1) {
  const out = [start];
  for (const r of returns) out.push(out[out.length - 1] * (1 + r));
  return out;
}

export function cagr(startValue, endValue, years) {
  if (!(startValue > 0) || !(years > 0)) return NaN;
  return (endValue / startValue) ** (1 / years) - 1;
}

export function drawdowns(values) {
  let peak = -Infinity;
  return values.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}

export function maxDrawdown(values) {
  let peak = values[0];
  let peakIdx = 0;
  let mdd = 0;
  let from = 0;
  let to = 0;
  values.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
    const dd = v / peak - 1;
    if (dd < mdd) {
      mdd = dd;
      from = peakIdx;
      to = i;
    }
  });
  return { maxDrawdown: mdd, peakIndex: from, troughIndex: to };
}

export function beta(asset, bench) {
  const v = variance(bench);
  return v ? covariance(asset, bench) / v : NaN;
}

// Historical VaR / CVaR as positive loss fractions at the given confidence.
export function historicalVaR(returns, level = 0.95) {
  const s = [...returns].sort((a, b) => a - b);
  const cut = percentile(s, 1 - level);
  const tail = s.filter((x) => x <= cut);
  return { var: -cut, cvar: -mean(tail.length ? tail : [cut]) };
}

// Inverse standard normal CDF (Acklam's approximation).
export function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function parametricVaR(muPeriod, sigmaPeriod, level = 0.95) {
  return -(muPeriod + normInv(1 - level) * sigmaPeriod);
}

// ---- matrices ------------------------------------------------------------------------
export function covMatrix(returnsBySymbol) {
  const n = returnsBySymbol.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) m[i][j] = m[j][i] = covariance(returnsBySymbol[i], returnsBySymbol[j]);
  return m;
}

export function corrMatrix(returnsBySymbol) {
  const n = returnsBySymbol.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) m[i][j] = m[j][i] = i === j ? 1 : correlation(returnsBySymbol[i], returnsBySymbol[j]);
  return m;
}

export function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(s, 1e-14));
      else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

export const portVariance = (w, cov) => {
  let v = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) v += w[i] * w[j] * cov[i][j];
  return v;
};
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// ---- portfolio analytics -------------------------------------------------------------
// Daily-rebalanced portfolio returns from aligned asset returns.
export function portfolioReturns(assetReturns, weights) {
  const n = assetReturns[0]?.length || 0;
  const out = new Array(n).fill(0);
  for (let a = 0; a < assetReturns.length; a++) for (let t = 0; t < n; t++) out[t] += weights[a] * assetReturns[a][t];
  return out;
}

// Summary statistics for a periodic return series.
export function returnStats(returns, { periodsPerYear = TRADING_DAYS, rf = 0, benchmark = null } = {}) {
  const m = mean(returns);
  const sd = stdev(returns);
  const annMean = m * periodsPerYear;
  const annVol = sd * Math.sqrt(periodsPerYear);
  const growth = growthSeries(returns);
  const years = returns.length / periodsPerYear;
  const geo = cagr(1, growth.at(-1), years);
  const rfPer = (1 + rf) ** (1 / periodsPerYear) - 1;
  const downside = returns.map((r) => Math.min(0, r - rfPer));
  const dd = Math.sqrt(sum(downside.map((x) => x * x)) / Math.max(1, returns.length)) * Math.sqrt(periodsPerYear);
  const { maxDrawdown: mdd } = maxDrawdown(growth);
  const hv = historicalVaR(returns, 0.95);
  const out = {
    periods: returns.length,
    years,
    expectedReturn: annMean, // annualised arithmetic mean
    cagr: geo, // realised compound annual growth
    volatility: annVol, // annualised standard deviation
    sharpe: annVol ? (annMean - rf) / annVol : NaN,
    sortino: dd ? (annMean - rf) / dd : NaN,
    maxDrawdown: mdd,
    calmar: mdd ? geo / Math.abs(mdd) : NaN,
    var95: hv.var, // one-period historical VaR
    cvar95: hv.cvar,
    paramVar95: parametricVaR(m, sd, 0.95),
    best: Math.max(...returns),
    worst: Math.min(...returns),
    positiveShare: returns.filter((r) => r > 0).length / Math.max(1, returns.length),
    totalReturn: growth.at(-1) - 1,
  };
  if (benchmark && benchmark.length === returns.length) {
    out.beta = beta(returns, benchmark);
    out.correlation = correlation(returns, benchmark);
    const bm = mean(benchmark) * periodsPerYear;
    out.alpha = annMean - (rf + out.beta * (bm - rf)); // Jensen's alpha (annualised)
    const active = returns.map((r, i) => r - benchmark[i]);
    const te = stdev(active) * Math.sqrt(periodsPerYear);
    out.trackingError = te;
    out.informationRatio = te ? (mean(active) * periodsPerYear) / te : NaN;
  }
  return out;
}

// ---- optimisation (long-only, fully invested) -------------------------------------
function randomWeights(n, rng) {
  // Uniform on the simplex via normalised exponentials.
  const e = Array.from({ length: n }, () => -Math.log(1 - rng()));
  const s = sum(e);
  return e.map((x) => x / s);
}

export function evaluate(w, mu, cov, rf) {
  const ret = dot(w, mu);
  const vol = Math.sqrt(Math.max(0, portVariance(w, cov)));
  return { w, ret, vol, sharpe: vol ? (ret - rf) / vol : 0 };
}

export function randomPortfolios(mu, cov, { count = 4000, rf = 0, seed = 7 } = {}) {
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(evaluate(randomWeights(mu.length, rng), mu, cov, rf));
  // Add corner portfolios (100% in each asset).
  mu.forEach((_, i) => out.push(evaluate(mu.map((__, j) => (i === j ? 1 : 0)), mu, cov, rf)));
  return out;
}

// Hill-climb on the simplex from the best random seeds: moves weight between pairs of assets.
export function optimise(mu, cov, objective, { rf = 0, seed = 11, maxWeight = 1, iterations = 3000, restarts = 30, start = null } = {}) {
  const n = mu.length;
  const rng = mulberry32(seed);
  const score = (w) => objective(evaluate(w, mu, cov, rf));
  const feasible = (w) => w.every((x) => x >= -1e-12 && x <= maxWeight + 1e-12);
  let best = null;
  const starts = [...(start ? [start] : []), new Array(n).fill(1 / n), ...Array.from({ length: restarts }, () => randomWeights(n, rng))].filter(feasible);
  if (!starts.length) starts.push(new Array(n).fill(1 / n));
  for (const start of starts) {
    let w = start.slice();
    let s = score(w);
    let step = 0.1;
    for (let it = 0; it < iterations && step > 1e-5; it++) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * (n - 1));
      if (j >= i) j++;
      const d = Math.min(step, w[i], maxWeight - w[j]);
      if (d <= 0) {
        step *= 0.97;
        continue;
      }
      const cand = w.slice();
      cand[i] -= d;
      cand[j] += d;
      const cs = score(cand);
      if (cs > s) {
        w = cand;
        s = cs;
      } else step *= 0.995;
    }
    if (!best || s > best.s) best = { w, s };
  }
  return evaluate(best.w, mu, cov, rf);
}

export const maxSharpe = (mu, cov, opts = {}) => optimise(mu, cov, (p) => p.sharpe, opts);
export const minVolatility = (mu, cov, opts = {}) => optimise(mu, cov, (p) => -p.vol, opts);

// Efficient frontier: minimum-variance portfolio for a ladder of target returns
// (penalised hill-climb), from the min-vol portfolio up to the best single asset.
export function efficientFrontier(mu, cov, { points = 24, rf = 0, maxWeight = 1 } = {}) {
  const mv = minVolatility(mu, cov, { rf, maxWeight });
  const hi = maxWeight >= 1 ? Math.max(...mu) : maxSharpe(mu, cov, { rf, maxWeight }).ret;
  const out = [mv];
  for (let k = 1; k <= points; k++) {
    const target = mv.ret + ((hi - mv.ret) * k) / points;
    const p = optimise(mu, cov, (e) => -e.vol - 50 * Math.max(0, target - e.ret), { rf, seed: 100 + k, maxWeight, iterations: 1500, restarts: 5, start: out.at(-1).w });
    if (p.ret >= target - 1e-3) out.push(p);
  }
  return out.sort((a, b) => a.vol - b.vol);
}

// ---- Monte Carlo --------------------------------------------------------------------
// Simulates monthly portfolio values with contributions.
//   method 'gbm'       : lognormal returns from annual mean & volatility
//   method 'bootstrap' : resamples historical monthly returns (blocks preserve autocorrelation)
export function monteCarlo({
  initial = 10000,
  monthlyContribution = 0,
  years = 20,
  annualReturn = 0.07,
  annualVol = 0.15,
  sims = 2000,
  seed = 2024,
  method = 'gbm',
  history = [],
  blockSize = 6,
  inflation = 0,
  contributionGrowth = 0,
  target = null,
} = {}) {
  const months = Math.round(years * 12);
  const rng = mulberry32(seed);
  const muM = Math.log(1 + annualReturn) / 12 - (annualVol * annualVol) / 24; // drift so E[growth]=(1+annualReturn)
  const sdM = annualVol / Math.sqrt(12);
  const infM = (1 + inflation) ** (1 / 12);
  const useBoot = method === 'bootstrap' && history.length >= 12;
  const finals = new Float64Array(sims);
  const finalsReal = new Float64Array(sims);
  const cols = Array.from({ length: months + 1 }, () => new Float64Array(sims));
  for (let s = 0; s < sims; s++) {
    let v = initial;
    let contrib = monthlyContribution;
    cols[0][s] = v;
    let b = 0;
    let bIdx = 0;
    for (let m = 1; m <= months; m++) {
      let r;
      if (useBoot) {
        if (b === 0) bIdx = Math.floor(rng() * history.length);
        r = history[(bIdx + b) % history.length];
        b = (b + 1) % blockSize;
      } else r = Math.exp(muM + sdM * gaussian(rng)) - 1;
      v = v * (1 + r) + contrib;
      if (v < 0) v = 0;
      if (m % 12 === 0) contrib *= 1 + contributionGrowth;
      cols[m][s] = v;
    }
    finals[s] = v;
    finalsReal[s] = v / infM ** months;
  }
  const qs = [0.05, 0.25, 0.5, 0.75, 0.95];
  const bands = cols.map((c, m) => {
    const sorted = Float64Array.from(c).sort();
    const row = { month: m };
    qs.forEach((q) => (row[`p${Math.round(q * 100)}`] = percentile(sorted, q)));
    row.mean = mean(Array.from(c));
    return row;
  });
  const sortedFinals = Float64Array.from(finals).sort();
  const sortedReal = Float64Array.from(finalsReal).sort();
  let totalContrib = initial;
  {
    let c = monthlyContribution;
    for (let m = 1; m <= months; m++) {
      totalContrib += c;
      if (m % 12 === 0) c *= 1 + contributionGrowth;
    }
  }
  const out = {
    months,
    bands,
    finals: Array.from(finals),
    summary: Object.fromEntries(qs.map((q) => [`p${Math.round(q * 100)}`, percentile(sortedFinals, q)])),
    summaryReal: Object.fromEntries(qs.map((q) => [`p${Math.round(q * 100)}`, percentile(sortedReal, q)])),
    mean: mean(Array.from(finals)),
    totalContributed: totalContrib,
    probLoss: Array.from(finals).filter((f) => f < totalContrib).length / sims,
    method: useBoot ? 'bootstrap' : 'gbm',
  };
  if (target) out.probTarget = Array.from(finals).filter((f) => f >= target).length / sims;
  return out;
}

// ---- technical indicators ---------------------------------------------------------
export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function rsi(values, n = 14) {
  if (values.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}
