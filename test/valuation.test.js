import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../public/js/lib/valmodels.js';
import { normalizeFinancials, weeklyBeta, dividendHistory, benchmarkFor } from '../server/services/valuation.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('CAPM and WACC', () => {
  close(V.capm({ rf: 0.045, beta: 1.2, erp: 0.05 }), 0.105);
  close(V.capm({ rf: 0.07, beta: 1, erp: 0.06, crp: 0.01 }), 0.14);
  close(V.wacc({ costEquity: 0.1, costDebt: 0.05, taxRate: 0.25, equity: 60, debt: 40 }), 0.075);
  close(V.wacc({ costEquity: 0.1, costDebt: 0.05, taxRate: 0.25, equity: 0, debt: 0 }), 0.1);
});

test('DCF: steady state equals a perpetuity', () => {
  // FCFF = 100 × 20% × (1 − 25%) = 15 a year, no growth, WACC 10% -> EV 150.
  const base = { revenue0: 100, growth: [0, 0, 0, 0, 0], margin: Array(5).fill(0.2), taxRate: 0.25, daPct: 0.05, capexPct: 0.05, nwcPct: 0.1, wacc: 0.1, netDebt: 50, shares: 10 };
  const g = V.dcf({ ...base, terminal: 'gordon', g: 0 });
  close(g.ev, 150);
  close(g.perShare, 10);
  close(g.impliedExitMultiple, 6); // TV 150 ÷ EBITDA 25
  // Exit at 6× EBITDA gives the same answer and implies 0% perpetual growth.
  const e = V.dcf({ ...base, terminal: 'exit', exitMultiple: 6 });
  close(e.ev, 150);
  close(e.impliedGrowth, 0);
  // Mid-year discounting pulls cash flows half a year closer: worth more.
  assert.ok(V.dcf({ ...base, terminal: 'gordon', g: 0, midYear: true }).ev > 150);
  // Growth costs working capital: 10% of each revenue increase.
  const grow = V.dcf({ ...base, growth: [0.1, 0, 0, 0, 0], terminal: 'gordon', g: 0 });
  close(grow.rows[0].dNwc, 1);
  close(grow.rows[0].fcff, 110 * 0.2 * 0.75 - 1);
  assert.ok(Number.isNaN(V.dcf({ ...base, terminal: 'gordon', g: 0.12 }).terminalValue)); // g ≥ WACC
  // D&A above capex: the perpetuity can assume capex catches up with D&A.
  const heavy = { ...base, daPct: 0.08, capexPct: 0.05, terminal: 'gordon', g: 0 };
  close(V.dcf(heavy).terminalFcff, 18); // 15 + 8 − 5
  close(V.dcf({ ...heavy, normalizeTerminal: true }).terminalFcff, 15);
  assert.ok(V.dcf({ ...heavy, normalizeTerminal: true }).ev < V.dcf(heavy).ev);
});

test('paths, grids and multiples', () => {
  assert.deepEqual(V.linearPath(0.1, 0.04, 4).map((x) => +x.toFixed(4)), [0.1, 0.08, 0.06, 0.04]);
  assert.deepEqual(V.grid([1, 2], [10, 20], (r, c) => r * c), [[10, 20], [20, 40]]);
  const q = V.quartiles([5, 1, 4, 2, 3, -1, NaN, null]);
  assert.deepEqual([q.n, q.min, q.q1, q.median, q.q3, q.max, q.mean], [5, 1, 2, 3, 4, 5, 3]);
  assert.equal(V.quartiles([NaN, -2]), null);
  close(V.fromEquityMultiple(15, 4), 60);
  close(V.fromEvMultiple(10, 50, { netDebt: 100, minority: 0, shares: 20 }), 20);
});

test('dividend discount models', () => {
  close(V.ddmGordon({ d0: 2, g: 0.03, r: 0.08 }), 41.2);
  assert.ok(Number.isNaN(V.ddmGordon({ d0: 2, g: 0.09, r: 0.08 })));
  close(V.ddmTwoStage({ d0: 1, g1: 0.1, n: 3, g2: 0.04, r: 0.09 }), 24.43314, 1e-4);
  // With equal growth in both stages it collapses to Gordon.
  close(V.ddmTwoStage({ d0: 2, g1: 0.03, n: 5, g2: 0.03, r: 0.08 }), 41.2, 1e-9);
  close(V.sustainableGrowth(0.2, 0.6), 0.08);
  close(V.upside(120, 100), 0.2);
});

test('football field blend', () => {
  const b = V.blend([{ low: 80, mid: 100, high: 120, weight: 1 }, { low: 100, mid: 130, high: 160, weight: 3 }, { low: 1, mid: 2, high: 3, weight: 0 }]);
  assert.deepEqual([b.low, b.mid, b.high], [95, 122.5, 150]);
  assert.equal(V.blend([{ low: 1, mid: 2, high: 3, weight: 0 }]), null);
});

test('financial statements are normalised from Yahoo time series', () => {
  const r = (date, value) => ({ date, value });
  const f = normalizeFinancials({
    currency: 'IDR',
    annual: { TotalRevenue: [r('2024-12-31', 100), r('2025-12-31', 120)], EBIT: [r('2025-12-31', 30)], CapitalExpenditure: [r('2025-12-31', -8)], TaxRateForCalcs: [r('2025-12-31', 0.22)], TotalDebt: [r('2025-12-31', 40)], OrdinarySharesNumber: [r('2025-12-31', 10)] },
    trailing: { TotalRevenue: [r('2026-09-30', 130)] },
    quarterly: { TotalDebt: [r('2026-09-30', 45)], CashAndCashEquivalents: [r('2026-09-30', 12)] },
  });
  assert.equal(f.annual.length, 2);
  assert.deepEqual([f.annual[1].revenue, f.annual[1].ebit, f.annual[1].capex, f.annual[1].taxRate], [120, 30, 8, 0.22]);
  assert.deepEqual([f.ttm.revenue, f.ttm.ebit, f.ttm.capex], [130, 30, 8]); // falls back to the last annual
  assert.deepEqual([f.balance.date, f.balance.totalDebt, f.balance.cash], ['2026-09-30', 45, 12]);
});

test('beta, dividends and benchmarks', () => {
  const dates = Array.from({ length: 600 }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400e3).toISOString().slice(0, 10));
  let b = 100;
  let s = 50;
  const bc = [];
  const sc = [];
  for (let i = 0; i < dates.length; i++) {
    const rb = Math.sin(i * 1.7) * 0.01;
    b *= 1 + rb;
    s *= 1 + 1.5 * rb;
    bc.push(b);
    sc.push(s);
  }
  const beta = weeklyBeta({ dates, close: sc }, { dates, close: bc });
  assert.ok(Math.abs(beta.raw - 1.5) < 0.05, `beta ${beta.raw}`);
  close(beta.adjusted, 0.67 * beta.raw + 0.33);
  const t = (y, m) => Date.UTC(y, m, 15);
  const d = dividendHistory([{ t: t(2021, 5), amount: 1 }, { t: t(2022, 5), amount: 1.1 }, { t: t(2023, 5), amount: 1.21 }, { t: t(2024, 5), amount: 1.331 }, { t: t(2026, 2), amount: 0.7 }, { t: t(2026, 8), amount: 0.7 }], new Date(Date.UTC(2026, 10, 22)));
  assert.deepEqual(d.years.map((x) => x.year), [2021, 2022, 2023, 2024]);
  close(d.cagr3, 0.1);
  close(d.ttm, 1.4);
  assert.equal(benchmarkFor('BBCA.JK'), '^JKSE');
  assert.equal(benchmarkFor('AAPL'), 'SPY');
});
