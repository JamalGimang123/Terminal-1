// Fixed-income math: coupon schedules, accrued interest, price <-> yield, duration,
// floating coupons with a floor (Indonesian retail SBR/ST), and coupon income.
// Dates are 'YYYY-MM-DD' strings; all arithmetic is in UTC. Rates are in percent.

const DAY = 86400e3;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);

export function addMonths(iso, months) {
  const d = new Date(toMs(iso));
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return toISO(target.getTime());
}

export const addYears = (iso, years) => toISO(toMs(iso) + years * 365.25 * DAY);

// Coupon dates counted back from maturity in steps of 12/freq months.
export function prevNextCoupon(settle, maturity, freq) {
  const step = 12 / freq;
  let next = maturity;
  let k = 0;
  while (true) {
    const prev = addMonths(maturity, -step * (k + 1));
    if (prev <= settle) return { prev, next, remaining: k + 1 };
    next = prev;
    k++;
    if (k > 2000) throw new Error('coupon schedule too long');
  }
}

// Coupon payment dates in (from, to].
export function couponDates(from, to, maturity, freq) {
  const step = 12 / freq;
  const out = [];
  for (let k = 0; k < 2000; k++) {
    const d = addMonths(maturity, -step * k);
    if (d <= from) break;
    if (d <= to) out.push(d);
  }
  return out.reverse();
}

// Accrued interest per `face` (Act/Act ICMA: fraction of the current coupon period).
export function accruedInterest({ settle, maturity, coupon, freq, face = 100 }) {
  if (settle >= maturity) return 0;
  const { prev, next } = prevNextCoupon(settle, maturity, freq);
  return ((face * coupon) / 100 / freq) * (daysBetween(prev, settle) / daysBetween(prev, next));
}

// Clean & dirty price per 100 from a yield to maturity (street convention, compounding at coupon frequency).
export function priceFromYield({ settle, maturity, coupon, freq, ytm }) {
  if (settle >= maturity) return { clean: 100, dirty: 100, accrued: 0 };
  const { prev, next, remaining } = prevNextCoupon(settle, maturity, freq);
  const w = daysBetween(settle, next) / daysBetween(prev, next); // fraction of a period until the next coupon
  const c = coupon / freq;
  const r = ytm / 100 / freq;
  let dirty = 0;
  for (let k = 0; k < remaining; k++) dirty += c / (1 + r) ** (k + w);
  dirty += 100 / (1 + r) ** (remaining - 1 + w);
  const accrued = c * (1 - w);
  return { dirty, clean: dirty - accrued, accrued };
}

// Yield to maturity (%) from a clean price per 100 (bisection: robust for any sane input).
export function yieldFromPrice({ settle, maturity, coupon, freq, clean }) {
  let lo = -5;
  let hi = 60;
  const f = (y) => priceFromYield({ settle, maturity, coupon, freq, ytm: y }).clean - clean;
  if (f(lo) < 0 || f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

// Macaulay & modified duration (years), convexity, and DV01 per 100 face.
export function riskMeasures({ settle, maturity, coupon, freq, ytm }) {
  if (settle >= maturity) return { macaulay: 0, modified: 0, convexity: 0, dv01: 0 };
  const { prev, next, remaining } = prevNextCoupon(settle, maturity, freq);
  const w = daysBetween(settle, next) / daysBetween(prev, next);
  const c = coupon / freq;
  const r = ytm / 100 / freq;
  let pv = 0;
  let tpv = 0;
  let cx = 0;
  for (let k = 0; k < remaining; k++) {
    const t = k + w; // periods
    const cf = c + (k === remaining - 1 ? 100 : 0);
    const df = (1 + r) ** -t;
    pv += cf * df;
    tpv += t * cf * df;
    cx += t * (t + 1) * cf * df;
  }
  const macaulay = tpv / pv / freq;
  const modified = macaulay / (1 + r);
  const convexity = cx / (pv * (1 + r) ** 2 * freq * freq);
  return { macaulay, modified, convexity, dv01: (modified * pv) / 10000 };
}

// Floating coupon with a floor (and optional cap): e.g. SBR = BI-Rate + spread, never below the floor.
export function floatingCoupon({ reference, spread = 0, floor = null, cap = null }) {
  let r = reference + spread;
  if (floor != null) r = Math.max(r, floor);
  if (cap != null) r = Math.min(r, cap);
  return r;
}

// Reference-rate history as [{date, rate}] (any order) -> rate in force on `date` (null if before first).
export function rateOn(history, date) {
  let best = null;
  for (const h of history) if (h.date <= date && (!best || h.date > best.date)) best = h;
  return best ? best.rate : null;
}

// Start of the floating-rate reset period containing `date`: resets every `months` months,
// on the coupon day, counted back from maturity (SBR/ST reset every 3 months).
export function resetDate(date, maturity, months = 3) {
  if (!months || !maturity) return date;
  for (let k = 0; k < 2000; k++) {
    const d = addMonths(maturity, -months * k);
    if (d <= date) return d;
  }
  return date;
}

/**
 * Coupon rate in force on a given date.
 * bond: { kind: 'fixed'|'floating', coupon (fixed rate or floor), spread, floor, cap, resetMonths (default 3) }
 * refHistory: [{date, rate}] for floating bonds. The reference rate is the one in force shortly
 * (3 days) before the start of the reset period, so a BI-Rate change shows up at the next reset.
 */
export function couponOn(bond, date, refHistory = []) {
  if (bond.kind !== 'floating') return bond.coupon;
  const fix = resetDate(date, bond.maturity, bond.resetMonths ?? 3);
  const ref = rateOn(refHistory, toISO(toMs(fix) - 3 * DAY));
  if (ref == null) return bond.floor ?? bond.coupon;
  return floatingCoupon({ reference: ref, spread: bond.spread || 0, floor: bond.floor ?? bond.coupon, cap: bond.cap ?? null });
}

// Coupons paid between purchase and `asOf` (net of withholding tax), using the rate in force on each date.
export function couponsReceived(bond, { face, from, asOf, refHistory = [] }) {
  const end = asOf < bond.maturity ? asOf : bond.maturity;
  const dates = couponDates(from, end, bond.maturity, bond.freq);
  const tax = (bond.taxRate ?? 0) / 100;
  let gross = 0;
  // Each payment uses the rate in force at the start of the period it pays for.
  for (const d of dates) gross += (face * couponOn(bond, addMonths(d, -12 / bond.freq), refHistory)) / 100 / bond.freq;
  return { count: dates.length, gross, net: gross * (1 - tax), dates };
}

// Snapshot used by the portfolio: current coupon, next payment, annual income, years to maturity.
export function bondSnapshot(bond, { face, asOf, refHistory = [], cleanPrice = null }) {
  const coupon = couponOn(bond, asOf, refHistory);
  const tax = (bond.taxRate ?? 0) / 100;
  const matured = asOf >= bond.maturity;
  const next = matured ? null : prevNextCoupon(asOf, bond.maturity, bond.freq).next;
  const price = cleanPrice ?? 100;
  const ytm = !matured && cleanPrice != null ? yieldFromPrice({ settle: asOf, maturity: bond.maturity, coupon, freq: bond.freq, clean: cleanPrice }) : matured ? null : coupon;
  const risk = !matured && ytm != null ? riskMeasures({ settle: asOf, maturity: bond.maturity, coupon, freq: bond.freq, ytm }) : null;
  return {
    coupon,
    netCoupon: coupon * (1 - tax),
    annualIncomeNet: (face * coupon * (1 - tax)) / 100,
    perPaymentNet: (face * coupon * (1 - tax)) / 100 / bond.freq,
    nextCoupon: next,
    yearsToMaturity: Math.max(0, daysBetween(asOf, bond.maturity) / 365.25),
    matured,
    price,
    ytm,
    duration: risk?.modified ?? null,
    accrued: matured ? 0 : (face * accruedInterest({ settle: asOf, maturity: bond.maturity, coupon, freq: bond.freq, face: 100 })) / 100,
  };
}

// Published terms of retail series (checked against the offering announcements). Anything not listed
// is entered by hand from the purchase confirmation / memorandum.
const KNOWN = {
  // Offered 28 Sep–22 Oct 2026: BI-Rate 5.75% + 1.00% fixed spread, 6.75% floor, coupon paid on the 10th.
  SBR015T2: { kind: 'floating', spread: 1.0, floor: 6.75, coupon: 6.75, maturity: '2028-10-10', freq: 12, tradable: false, taxRate: 10 },
  // Offered Jun–Jul 2024: BI-Rate 6.25% + 0.20% spread, 6.45% floor (matured 10 Jul 2026).
  SBR013T2: { kind: 'floating', spread: 0.2, floor: 6.45, coupon: 6.45, maturity: '2026-07-10', freq: 12, tradable: false, taxRate: 10 },
};
export const knownSeries = (code) => {
  const k = KNOWN[sbnInfo(code)?.series];
  return k ? { ...k, currency: 'IDR', reference: 'BI-Rate' } : null;
};

// Indonesian government securities naming: series prefix -> structure.
export function sbnInfo(series) {
  const s = String(series || '').toUpperCase();
  const m = /^(FR|PBS|ORI|SR|SBR|ST|SPN|SPNS|VR)(\d+)(?:T(\d+))?$/.exec(s);
  if (!m) return null;
  const type = m[1];
  const table = {
    FR: { name: 'Fixed Rate government bond', tradable: true, freq: 2, kind: 'fixed', sharia: false },
    PBS: { name: 'Project-based sukuk (SBSN)', tradable: true, freq: 2, kind: 'fixed', sharia: true },
    VR: { name: 'Variable Rate government bond', tradable: true, freq: 4, kind: 'floating', sharia: false },
    ORI: { name: 'Retail bond (Obligasi Negara Ritel)', tradable: true, freq: 12, kind: 'fixed', sharia: false },
    SR: { name: 'Retail sukuk (Sukuk Ritel)', tradable: true, freq: 12, kind: 'fixed', sharia: true },
    SBR: { name: 'Savings Bond Ritel', tradable: false, freq: 12, kind: 'floating', sharia: false },
    ST: { name: 'Sukuk Tabungan', tradable: false, freq: 12, kind: 'floating', sharia: true },
    SPN: { name: 'Treasury bill (SPN)', tradable: true, freq: 1, kind: 'zero', sharia: false },
    SPNS: { name: 'Sharia treasury bill (SPNS)', tradable: true, freq: 1, kind: 'zero', sharia: true },
  }[type];
  // Canonical code: FR series use 4 digits (FR0100), the others 3 (ORI025T3, SBR015T2).
  const code = `${type}${m[2].padStart(type === 'FR' ? 4 : 3, '0')}${m[3] ? `T${m[3]}` : ''}`;
  return { series: code, type, number: Number(m[2]), tenorYears: m[3] ? Number(m[3]) : null, ...table, taxRate: 10 };
}
