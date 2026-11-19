import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../public/js/lib/bonds.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

test('addMonths clamps to month end', () => {
  assert.equal(B.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(B.addMonths('2026-03-15', -6), '2025-09-15');
  assert.equal(B.addMonths('2026-12-10', 1), '2027-01-10');
});

test('coupon schedule around a settlement date', () => {
  const { prev, next, remaining } = B.prevNextCoupon('2026-11-19', '2031-05-15', 2);
  assert.equal(prev, '2026-11-15');
  assert.equal(next, '2027-05-15');
  assert.equal(remaining, 9); // May/Nov 2027 ... May 2031
  assert.deepEqual(B.couponDates('2026-01-01', '2026-12-31', '2028-03-10', 12).length, 12);
});

test('a bond priced at its coupon rate on a coupon date is at par', () => {
  const p = B.priceFromYield({ settle: '2026-05-15', maturity: '2036-05-15', coupon: 7, freq: 2, ytm: 7 });
  close(p.clean, 100, 1e-9);
  close(p.accrued, 0, 1e-12);
});

test('textbook price: 5% 10-year semiannual bond at 6% yield', () => {
  // 100 * [0.025 * (1 - 1.03^-20)/0.03 + 1.03^-20] = 92.5613
  const p = B.priceFromYield({ settle: '2026-01-01', maturity: '2036-01-01', coupon: 5, freq: 2, ytm: 6 });
  close(p.clean, 92.56126, 1e-4);
});

test('yieldFromPrice inverts priceFromYield (mid-period, with accrued)', () => {
  const args = { settle: '2026-11-19', maturity: '2035-04-15', coupon: 6.5, freq: 2 };
  const { clean, accrued } = B.priceFromYield({ ...args, ytm: 7.7245 });
  assert.ok(accrued > 0);
  close(B.yieldFromPrice({ ...args, clean }), 7.7245, 1e-6);
});

test('duration: zero-like short bond ~ its maturity; modified < Macaulay', () => {
  const r = B.riskMeasures({ settle: '2026-01-01', maturity: '2036-01-01', coupon: 5, freq: 2, ytm: 6 });
  assert.ok(r.macaulay > 7.5 && r.macaulay < 8.2, `macaulay ${r.macaulay}`);
  close(r.modified, r.macaulay / 1.03, 1e-12);
  // price change predicted by duration for +1bp ≈ -DV01
  const p0 = B.priceFromYield({ settle: '2026-01-01', maturity: '2036-01-01', coupon: 5, freq: 2, ytm: 6 }).dirty;
  const p1 = B.priceFromYield({ settle: '2026-01-01', maturity: '2036-01-01', coupon: 5, freq: 2, ytm: 6.01 }).dirty;
  close(p0 - p1, r.dv01, 1e-3);
});

test('floating coupon follows the reference rate with a floor', () => {
  assert.equal(B.floatingCoupon({ reference: 6.0, spread: 0.15, floor: 6.1 }), 6.15);
  assert.equal(B.floatingCoupon({ reference: 5.0, spread: 0.15, floor: 6.1 }), 6.1);
  const hist = [{ date: '2026-04-22', rate: 4.75 }, { date: '2026-06-18', rate: 5.75 }, { date: '2026-11-18', rate: 6.0 }];
  assert.equal(B.rateOn(hist, '2026-07-01'), 5.75);
  assert.equal(B.rateOn(hist, '2026-01-01'), null);
  const sbr = { kind: 'floating', coupon: 6.1, floor: 6.1, spread: 0.25, freq: 12, maturity: '2028-11-10', taxRate: 10 };
  assert.equal(B.couponOn(sbr, '2026-05-01', hist), 6.1); // 4.75 + 0.25 < floor
  // Quarterly resets on the 10th (Feb/May/Aug/Nov): the Nov 18 hike only applies from the Feb reset.
  assert.equal(B.resetDate('2026-12-01', sbr.maturity), '2026-11-10');
  assert.equal(B.couponOn(sbr, '2026-12-01', hist), 6.1); // 5.75 + 0.25 = 6.00, below the floor
  assert.equal(B.couponOn(sbr, '2027-02-15', hist), 6.25); // 6.00 + 0.25
  assert.equal(B.couponOn({ ...sbr, resetMonths: 0 }, '2026-12-01', hist), 6.25); // immediate reset
  // SBR015T2: BI-Rate 5.75% + 1.00% spread, floor 6.75%, matures 2028-10-10.
  const sbr15 = { kind: 'floating', coupon: 6.75, floor: 6.75, spread: 1.0, freq: 12, maturity: '2028-10-10', taxRate: 10 };
  assert.equal(B.couponOn(sbr15, '2026-11-19', [{ date: '2026-09-17', rate: 5.75 }]), 6.75);
  assert.equal(B.couponOn(sbr15, '2027-03-01', [{ date: '2026-09-17', rate: 5.75 }, { date: '2026-12-17', rate: 6.25 }]), 7.25);
});

test('coupons received are summed net of tax', () => {
  const ori = { kind: 'fixed', coupon: 6, freq: 12, maturity: '2029-10-15', taxRate: 10 };
  const r = B.couponsReceived(ori, { face: 12_000_000, from: '2026-01-01', asOf: '2026-07-01' });
  assert.equal(r.count, 6); // Jan..Jun 15th
  close(r.gross, 6 * 60_000, 1e-6);
  close(r.net, 6 * 54_000, 1e-6);
  const s = B.bondSnapshot(ori, { face: 12_000_000, asOf: '2026-07-01' });
  close(s.annualIncomeNet, 648_000, 1e-6);
  assert.equal(s.nextCoupon, '2026-07-15');
});

test('SBN series names are recognised', () => {
  assert.equal(B.sbnInfo('SBR015T2').type, 'SBR');
  assert.equal(B.sbnInfo('SBR015T2').tenorYears, 2);
  assert.equal(B.sbnInfo('sbr015t2').tradable, false);
  assert.equal(B.sbnInfo('FR0100').freq, 2);
  assert.equal(B.sbnInfo('fr100').series, 'FR0100');
  assert.equal(B.sbnInfo('SBR15T2').series, 'SBR015T2');
  assert.equal(B.sbnInfo('ORI025T3').kind, 'fixed');
  assert.equal(B.sbnInfo('AAPL'), null);
});
