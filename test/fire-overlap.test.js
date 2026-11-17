import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../public/js/lib/fire.js';
import * as O from '../public/js/lib/overlap.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

test('FI number is spending / withdrawal rate', () => {
  close(F.fiNumber(40000, 0.04), 1_000_000);
});

test('real return uses the Fisher relation', () => {
  close(F.realReturn(0.07, 0.03), 1.07 / 1.03 - 1);
});

test('yearsToTarget is the inverse of futureValue', () => {
  const n = F.yearsToTarget(50_000, 20_000, 0.05, 1_000_000);
  close(F.futureValue(50_000, 20_000, 0.05, n), 1_000_000, 1e-4);
  assert.equal(F.yearsToTarget(2e6, 0, 0.05, 1e6), 0);
  assert.equal(F.yearsToTarget(0, 0, 0.05, 1e6), Infinity);
  close(F.yearsToTarget(0, 10_000, 0, 50_000), 5);
});

test('requiredMonthlySaving reaches the goal in compoundSchedule', () => {
  const pmt = F.requiredMonthlySaving(100_000, 5_000, 10, 0.06);
  const rows = F.compoundSchedule({ initial: 5_000, monthly: pmt, annualRate: 0.06, years: 10 });
  close(rows.at(-1).balance, 100_000, 1e-4);
  assert.equal(F.requiredMonthlySaving(100, 1000, 5, 0.05), 0);
});

test('coast FI discounts the FI number back to today', () => {
  close(F.coastFiNumber(1_000_000, 0.05, 10), 1_000_000 / 1.05 ** 10);
});

test('firePlan reaches FI when assets cover spending, then draws down', () => {
  const plan = F.firePlan({ age: 30, assets: 100_000, income: 100_000, spending: 40_000, nominalReturn: 0.07, inflation: 0.03, withdrawalRate: 0.04, endAge: 90 });
  close(plan.fiNumber, 1_000_000);
  close(plan.savingsRate, 0.6);
  assert.ok(plan.fiAge > 30 && plan.fiAge < 50, `fiAge ${plan.fiAge}`);
  const firstRetired = plan.rows.find((r) => r.phase === 'retired');
  assert.equal(firstRetired.age, plan.fiAge);
  assert.ok(firstRetired.start >= 1_000_000);
  assert.equal(plan.depletedAge, null);
});

test('other income (e.g. Social Security) lowers the required portfolio', () => {
  const base = { age: 50, assets: 500_000, income: 80_000, spending: 50_000, nominalReturn: 0.06, inflation: 0.03, withdrawalRate: 0.04, endAge: 95 };
  const without = F.firePlan(base);
  const withSS = F.firePlan({ ...base, otherIncome: 25_000, otherIncomeAge: 50 });
  assert.ok(withSS.fiAge <= without.fiAge);
});

test('fireMonteCarlo: zero volatility succeeds iff the deterministic plan does', () => {
  const p = { age: 40, assets: 1_500_000, income: 0, spending: 50_000, nominalReturn: 0.05, inflation: 0.02, withdrawalRate: 0.04, retireAge: 40, endAge: 90 };
  const mc = F.fireMonteCarlo(p, { sims: 50, volatility: 0 });
  assert.equal(mc.successRate, 1);
  const broke = F.fireMonteCarlo({ ...p, assets: 300_000 }, { sims: 50, volatility: 0 });
  assert.equal(broke.successRate, 0);
});

// ---- overlap -------------------------------------------------------------------
const fundA = {
  symbol: 'AAA',
  holdings: [
    { name: 'Apple', ticker: 'AAPL', cusip: '037833100', weight: 10 },
    { name: 'Microsoft', ticker: 'MSFT', cusip: '594918104', weight: 8 },
    { name: 'Exxon', ticker: 'XOM', cusip: '30231G102', weight: 2 },
  ],
};
const fundB = {
  symbol: 'BBB',
  holdings: [
    // Same securities identified differently (no ticker / ISIN only) must still match.
    { name: 'APPLE INC', ticker: '', cusip: '037833100', weight: 12 },
    { name: 'MICROSOFT CORP', ticker: '', cusip: '', isin: 'US5949181045', weight: 5 },
    { name: 'Tesla', ticker: 'TSLA', cusip: '88160R101', weight: 3 },
  ],
};

test('overlapPair: sum of minimum weights across matched securities', () => {
  const o = O.overlapPair(fundA, fundB);
  assert.equal(o.commonCount, 2);
  close(o.weightOverlap, 10 + 5);
  close(o.pctWeightA, 18);
  close(o.pctWeightB, 17);
  close(o.pctCountA, 2 / 3);
  assert.equal(o.common[0].ticker, 'AAPL');
  assert.deepEqual(o.onlyA.map((h) => h.ticker), ['XOM']);
  assert.deepEqual(o.onlyB.map((h) => h.ticker), ['TSLA']);
});

test('overlapMatrix is symmetric', () => {
  const m = O.overlapMatrix([fundA, fundB]);
  close(m[0][1].weightOverlap, m[1][0].weightOverlap);
  assert.equal(m[0][0].self, true);
});

test('lookThrough aggregates exposure by allocation', () => {
  const lt = O.lookThrough([fundA, fundB], [0.5, 0.5]);
  const apple = lt.rows.find((r) => r.ticker === 'AAPL');
  close(apple.weight, 0.5 * 10 + 0.5 * 12);
  close(apple.sources.AAA, 5);
  assert.equal(lt.uniqueCount, 4);
});
