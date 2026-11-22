// Valuation models: CAPM / WACC, free-cash-flow-to-firm DCF, trading & transaction multiples,
// dividend discount models and the football-field summary. Pure functions; rates are decimals.

export const capm = ({ rf, beta, erp, crp = 0 }) => rf + beta * erp + crp;

export function wacc({ costEquity, costDebt, taxRate, equity, debt }) {
  const v = equity + debt;
  if (!(v > 0)) return costEquity;
  return (equity / v) * costEquity + (debt / v) * costDebt * (1 - taxRate);
}

// n values moving in a straight line from `start` (year 1) to `end` (year n).
export function linearPath(start, end, n) {
  if (n <= 1) return [end];
  return Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1));
}

/**
 * Unlevered (FCFF) discounted cash flow.
 * FCFF = EBIT × (1 − tax) + D&A − capex − Δ working capital.
 * inp: { revenue0, growth: [g per year], margin: [EBIT margin per year], taxRate, daPct, capexPct,
 *        nwcPct (of the revenue increase), wacc, terminal: 'gordon' | 'exit', g, exitMultiple (EV/EBITDA),
 *        netDebt, minority, shares, midYear, normalizeTerminal }
 * normalizeTerminal: in the perpetuity, capex is at least D&A (assets must be replaced forever).
 */
export function dcf(inp) {
  const n = inp.growth.length;
  const rows = [];
  let rev = inp.revenue0;
  let pvSum = 0;
  for (let t = 1; t <= n; t++) {
    const prev = rev;
    rev = prev * (1 + inp.growth[t - 1]);
    const ebit = rev * inp.margin[t - 1];
    const nopat = ebit * (1 - inp.taxRate);
    const da = rev * inp.daPct;
    const capex = rev * inp.capexPct;
    const dNwc = (rev - prev) * inp.nwcPct;
    const fcff = nopat + da - capex - dNwc;
    const period = inp.midYear ? t - 0.5 : t;
    const df = 1 / (1 + inp.wacc) ** period;
    pvSum += fcff * df;
    rows.push({ year: t, revenue: rev, growth: inp.growth[t - 1], ebit, margin: inp.margin[t - 1], nopat, da, capex, dNwc, fcff, ebitda: ebit + da, df, pv: fcff * df });
  }
  const lastRow = rows.at(-1);
  const tvFcff = inp.normalizeTerminal ? lastRow.nopat + lastRow.da - Math.max(lastRow.capex, lastRow.da) - lastRow.dNwc : lastRow.fcff;
  let tv;
  if (inp.terminal === 'exit') tv = lastRow.ebitda * inp.exitMultiple;
  else tv = inp.wacc > inp.g ? (tvFcff * (1 + inp.g)) / (inp.wacc - inp.g) : NaN;
  const dfN = 1 / (1 + inp.wacc) ** n;
  const pvTv = tv * dfN;
  const ev = pvSum + pvTv;
  const equity = ev - (inp.netDebt || 0) - (inp.minority || 0);
  return {
    rows,
    pvFcff: pvSum,
    terminalValue: tv,
    pvTerminal: pvTv,
    ev,
    equity,
    perShare: inp.shares > 0 ? equity / inp.shares : NaN,
    tvShare: ev ? pvTv / ev : NaN,
    // Cross-checks: what the other terminal method would have to assume.
    impliedExitMultiple: lastRow.ebitda ? tv / lastRow.ebitda : NaN,
    terminalFcff: tvFcff,
    impliedGrowth: (tv * inp.wacc - tvFcff) / (tv + tvFcff),
  };
}

// Grid of f(row, col) — e.g. value per share for WACC × terminal growth.
export const grid = (rows, cols, f) => rows.map((r) => cols.map((c) => f(r, c)));

// Distribution of a multiple across peers (positive, finite values only).
export function quartiles(values) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (p) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
  };
  return { n: v.length, min: v[0], q1: at(0.25), median: at(0.5), q3: at(0.75), max: v.at(-1), mean: v.reduce((s, x) => s + x, 0) / v.length };
}

// Price per share implied by a multiple. Equity multiples (P/E, P/B) apply to a per-share metric;
// enterprise multiples (EV/EBITDA, EV/Sales) apply to a total and bridge from EV to equity.
export const fromEquityMultiple = (multiple, perShare) => multiple * perShare;
export const fromEvMultiple = (multiple, total, { netDebt = 0, minority = 0, shares }) => (multiple * total - netDebt - minority) / shares;

// Gordon growth: next year's dividend ÷ (cost of equity − growth).
export const ddmGordon = ({ d0, g, r }) => (r > g ? (d0 * (1 + g)) / (r - g) : NaN);

// Two-stage: dividends grow at g1 for n years, then at g2 forever.
export function ddmTwoStage({ d0, g1, n, g2, r }) {
  if (!(r > g2)) return NaN;
  let pv = 0;
  let d = d0;
  for (let t = 1; t <= n; t++) {
    d *= 1 + g1;
    pv += d / (1 + r) ** t;
  }
  return pv + (d * (1 + g2)) / (r - g2) / (1 + r) ** n;
}

// Growth a company can fund from retained earnings: ROE × (1 − payout ratio).
export const sustainableGrowth = (roe, payout) => roe * (1 - payout);

export const upside = (value, price) => (price > 0 && Number.isFinite(value) ? value / price - 1 : NaN);

// Weighted blend of football-field rows: [{low, mid, high, weight}] -> {low, mid, high}.
export function blend(items) {
  const use = items.filter((x) => x.weight > 0 && [x.low, x.mid, x.high].every(Number.isFinite));
  const w = use.reduce((s, x) => s + x.weight, 0);
  if (!w) return null;
  const avg = (k) => use.reduce((s, x) => s + x[k] * x.weight, 0) / w;
  return { low: avg('low'), mid: avg('mid'), high: avg('high'), weight: w };
}
