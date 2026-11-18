import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/js/lib/stats.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

test('mean, variance, stdev (sample)', () => {
  const x = [2, 4, 4, 4, 5, 5, 7, 9];
  close(S.mean(x), 5);
  close(S.variance(x, false), 4);
  close(S.stdev(x, false), 2);
  close(S.variance(x), 32 / 7);
});

test('correlation of perfectly linear series is 1 and beta is the slope', () => {
  const b = [0.01, -0.02, 0.015, 0.003, -0.007];
  const a = b.map((x) => 2 * x + 0.001);
  close(S.correlation(a, b), 1, 1e-12);
  close(S.beta(a, b), 2, 1e-12);
});

test('alignSeries keeps only common dates and positive prices', () => {
  const r = S.alignSeries({
    A: { dates: ['2024-01-01', '2024-01-02', '2024-01-03'], close: [1, 2, 3] },
    B: { dates: ['2024-01-02', '2024-01-03', '2024-01-04'], close: [10, 0, 30] },
  });
  assert.deepEqual(r.dates, ['2024-01-02']);
  assert.deepEqual(r.prices, { A: [2], B: [10] });
});

test('returns, growth and CAGR round-trip', () => {
  const p = [100, 110, 99, 120];
  const r = S.toReturns(p);
  const g = S.growthSeries(r, 100);
  g.forEach((v, i) => close(v, p[i], 1e-9));
  close(S.cagr(100, 121, 2), 0.1, 1e-12);
});

test('maxDrawdown finds the deepest peak-to-trough decline', () => {
  const { maxDrawdown, peakIndex, troughIndex } = S.maxDrawdown([100, 120, 90, 130, 65, 140]);
  close(maxDrawdown, -0.5);
  assert.equal(peakIndex, 3);
  assert.equal(troughIndex, 4);
});

test('monthlyReturns compounds daily returns within calendar months', () => {
  const dates = ['2024-01-30', '2024-01-31', '2024-02-01', '2024-02-02'];
  const m = S.monthlyReturns([0.1, 0.1, -0.5, 0.2], dates);
  close(m[0], 0.21, 1e-12);
  close(m[1], -0.4, 1e-12);
});

test('historical VaR/CVaR on a known distribution', () => {
  const r = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000); // -0.05 .. 0.049
  const { var: v, cvar } = S.historicalVaR(r, 0.95);
  assert.ok(v > 0.04 && v < 0.046, `VaR ${v}`);
  assert.ok(cvar >= v, 'CVaR must be at least VaR');
});

test('normInv matches standard quantiles', () => {
  close(S.normInv(0.5), 0, 1e-9);
  close(S.normInv(0.975), 1.959964, 1e-5);
  close(S.normInv(0.05), -1.644854, 1e-5);
});

test('cholesky reconstructs the matrix', () => {
  const A = [
    [4, 12, -16],
    [12, 37, -43],
    [-16, -43, 98],
  ];
  const L = S.cholesky(A);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += L[i][k] * L[j][k];
      close(s, A[i][j], 1e-9);
    }
});

test('returnStats: Sharpe uses annualised arithmetic mean and volatility', () => {
  const rng = S.mulberry32(1);
  const r = Array.from({ length: 2520 }, () => 0.0004 + 0.01 * S.gaussian(rng));
  const st = S.returnStats(r, { rf: 0.02 });
  close(st.expectedReturn, S.mean(r) * 252, 1e-12);
  close(st.volatility, S.stdev(r) * Math.sqrt(252), 1e-12);
  close(st.sharpe, (st.expectedReturn - 0.02) / st.volatility, 1e-12);
  assert.ok(st.volatility > 0.14 && st.volatility < 0.18);
  assert.ok(st.maxDrawdown < 0 && st.sortino > st.sharpe);
});

test('returnStats against a benchmark: beta/alpha of a 1.5x levered copy', () => {
  const rng = S.mulberry32(5);
  const b = Array.from({ length: 1000 }, () => 0.0003 + 0.01 * S.gaussian(rng));
  const a = b.map((x) => 1.5 * x);
  const st = S.returnStats(a, { benchmark: b, rf: 0 });
  close(st.beta, 1.5, 1e-9);
  close(st.correlation, 1, 1e-9);
  close(st.alpha, 0, 1e-9);
});

test('min-volatility optimiser matches the two-asset analytic solution', () => {
  const s1 = 0.2;
  const s2 = 0.1;
  const rho = 0.3;
  const c = rho * s1 * s2;
  const cov = [
    [s1 * s1, c],
    [c, s2 * s2],
  ];
  const w1 = (s2 * s2 - c) / (s1 * s1 + s2 * s2 - 2 * c);
  const p = S.minVolatility([0.08, 0.05], cov);
  close(p.w[0], w1, 2e-3);
  close(p.w[0] + p.w[1], 1, 1e-9);
});

test('max-Sharpe optimiser beats every random portfolio', () => {
  const mu = [0.1, 0.07, 0.04];
  const vol = [0.2, 0.15, 0.05];
  const corr = [
    [1, 0.6, -0.1],
    [0.6, 1, 0.0],
    [-0.1, 0.0, 1],
  ];
  const cov = corr.map((row, i) => row.map((r, j) => r * vol[i] * vol[j]));
  const best = S.maxSharpe(mu, cov, { rf: 0.02 });
  const cloud = S.randomPortfolios(mu, cov, { count: 3000, rf: 0.02 });
  for (const p of cloud) assert.ok(p.sharpe <= best.sharpe + 1e-6);
  assert.ok(best.w.every((w) => w >= -1e-12));
  const frontier = S.efficientFrontier(mu, cov, { rf: 0.02, points: 8 });
  assert.ok(frontier.length >= 5);
});

test('Monte Carlo with zero volatility equals the deterministic future value', () => {
  const mc = S.monteCarlo({ initial: 1000, monthlyContribution: 100, years: 10, annualReturn: 0.06, annualVol: 0, sims: 20 });
  const r = 1.06 ** (1 / 12) - 1;
  let v = 1000;
  for (let m = 0; m < 120; m++) v = v * (1 + r) + 100;
  close(mc.summary.p50, v, 1e-6);
  close(mc.summary.p5, v, 1e-6);
  close(mc.totalContributed, 1000 + 120 * 100, 1e-9);
});

test('Monte Carlo GBM mean growth matches the expected annual return', () => {
  const mc = S.monteCarlo({ initial: 100, years: 1, annualReturn: 0.08, annualVol: 0.2, sims: 20000, seed: 3 });
  close(mc.mean / 100, 1.08, 0.006);
  assert.ok(mc.summary.p5 < mc.summary.p50 && mc.summary.p50 < mc.summary.p95);
});

test('sma and rsi', () => {
  assert.deepEqual(S.sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.equal(S.rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14), 100);
});

test('FX despike removes isolated bad ticks but keeps real moves', async () => {
  const { despike } = await import('../server/services/history.js');
  const base = Array.from({ length: 30 }, (_, i) => ({ t: i, c: 16000 + i * 10 }));
  const bad = base.map((p, i) => (i === 15 ? { ...p, c: 17500 } : p));
  assert.equal(despike(bad).length, 29);
  // a genuine 6% level shift that persists is kept
  const shift = base.map((p, i) => (i >= 15 ? { ...p, c: p.c * 1.06 } : p));
  assert.equal(despike(shift).length, 30);
});
