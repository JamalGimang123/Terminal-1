// Multi-currency valuation: convert holdings priced in their trading currency
// (e.g. BBCA.JK in rupiah) into your base currency using live FX quotes.
// FX convention: Yahoo "XXX=X" = units of XXX per 1 US dollar.
import { api } from './api.js';
import { big, DASH } from './fmt.js';

export const BASE_CURRENCIES = ['USD', 'IDR'];
const MINOR = { GBp: ['GBP', 100], ZAc: ['ZAR', 100] }; // quotes in pence / cents

export function normCcy(ccy) {
  return MINOR[ccy] || [ccy || 'USD', 1];
}

export const baseOf = (st) => (BASE_CURRENCIES.includes(st?.settings?.baseCurrency) ? st.settings.baseCurrency : 'USD');

// FX symbols needed to convert the given currencies into `base`.
export function fxSymbolsFor(currencies, base) {
  const out = new Set();
  for (const c of currencies) {
    const [n] = normCcy(c);
    if (n && n !== 'USD') out.add(`${n}=X`);
  }
  if (base !== 'USD') out.add(`${base}=X`);
  return [...out];
}

export function ratesFromQuotes(quotes) {
  const rates = { USD: 1 };
  for (const [sym, q] of Object.entries(quotes || {})) {
    const m = /^([A-Z]{3})=X$/.exec(sym);
    if (m && q?.price > 0) rates[m[1]] = q.price;
  }
  return rates;
}

// Returns convert(value, currency) -> value in base, or null if a rate is missing.
export function converter(rates, base) {
  return (value, ccy) => {
    if (value == null || !Number.isFinite(value)) return null;
    const [c, div] = normCcy(ccy);
    const usd = c === 'USD' ? value / div : rates[c] ? value / div / rates[c] : null;
    if (usd == null) return null;
    if (base === 'USD') return usd;
    return rates[base] ? usd * rates[base] : null;
  };
}

// Per-date conversion factor series (for value histories): factor_t such that base = native × factor_t.
export function factorSeries(ccy, base, fxPrices, length) {
  const [c, div] = normCcy(ccy);
  const toUsd = c === 'USD' ? null : fxPrices[`${c}=X`];
  const toBase = base === 'USD' ? null : fxPrices[`${base}=X`];
  if ((c !== 'USD' && !toUsd) || (base !== 'USD' && !toBase)) return null;
  return Array.from({ length }, (_, t) => (1 / div) * (toUsd ? 1 / toUsd[t] : 1) * (toBase ? toBase[t] : 1));
}

const PREFIX = { USD: '$', IDR: 'Rp ', EUR: '€', GBP: '£', JPY: '¥', SGD: 'S$', AUD: 'A$', HKD: 'HK$', CAD: 'C$' };
const decimalsOf = (ccy) => (['IDR', 'JPY', 'KRW'].includes(ccy) ? 0 : 2);

export function fmtMoney(v, ccy = 'USD', d) {
  if (v == null || !Number.isFinite(v)) return DASH;
  const dd = d ?? decimalsOf(ccy);
  const p = PREFIX[ccy] ?? `${ccy} `;
  return (v < 0 ? '−' : '') + p + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd });
}

export function fmtMoneySigned(v, ccy = 'USD', d) {
  if (v == null || !Number.isFinite(v)) return DASH;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtMoney(Math.abs(v), ccy, d);
}

export function fmtBig(v, ccy = 'USD', d = 1) {
  if (v == null || !Number.isFinite(v)) return DASH;
  return (v < 0 ? '−' : '') + (PREFIX[ccy] ?? `${ccy} `) + big(Math.abs(v), d);
}

export const currencyPrefix = (ccy) => (PREFIX[ccy] ?? `${ccy} `).trim();

/**
 * Cost of a lot in the base currency.
 * With `lot.fxRate` (rupiah per 1 US dollar on the purchase date) a USD lot keeps its historical
 * rupiah cost (and an IDR lot its historical dollar cost), so P&L includes currency moves.
 * Without it the cost is converted at today's rate (no FX effect can be measured).
 */
export function lotCostInBase(lot, ccy, base, conv) {
  const native = lot.shares * lot.costBasis;
  if (ccy === base) return { cost: native, historical: true };
  const r = Number(lot.fxRate);
  if (r > 0 && ccy === 'USD' && base === 'IDR') return { cost: native * r, historical: true };
  if (r > 0 && ccy === 'IDR' && base === 'USD') return { cost: native / r, historical: true };
  return { cost: conv(native, ccy), historical: false };
}

// Bonds are priced as a percentage of their nominal (face) value.
export const bondCurrency = (lot) => lot.bond?.currency || 'IDR';
export function bondPricePct(bond, pheiRow) {
  if (bond?.price > 0) return { price: bond.price, prev: bond.price, source: 'manual' };
  if (bond?.tradable && pheiRow?.price) return { price: pheiRow.price, prev: pheiRow.prevPrice ?? pheiRow.price, source: 'PHEI' };
  return { price: 100, prev: 100, source: bond?.tradable ? 'par (no market price found)' : 'nominal' };
}

// Value all positions & cash in the base currency (used by PSIM, FIRE and OVLP loaders).
export async function valuePortfolio(st, base = baseOf(st)) {
  const syms = [...new Set(st.positions.filter((p) => !p.bond).map((p) => p.symbol))];
  const { quotes } = syms.length ? await api.quotes(syms) : { quotes: {} };
  const ccys = new Set([...syms.map((s) => quotes[s]?.currency || 'USD'), ...st.positions.filter((p) => p.bond).map(bondCurrency), ...st.cash.map((c) => c.currency || 'USD')]);
  const fx = fxSymbolsFor(ccys, base);
  const fxq = fx.length ? (await api.quotes(fx)).quotes : {};
  const conv = converter(ratesFromQuotes(fxq), base);
  // Tradable bonds without a manual price: PHEI fair prices.
  let phei = {};
  if (st.positions.some((p) => p.bond?.tradable && !(p.bond.price > 0))) {
    try {
      phei = Object.fromEntries(((await api.phei()).series || []).map((r) => [r.series, r]));
    } catch {
      /* fall back to par */
    }
  }
  const bySymbol = {};
  const missing = new Set();
  for (const p of st.positions) {
    const q = quotes[p.symbol];
    const v = p.bond ? conv((p.shares * bondPricePct(p.bond, phei[p.symbol]).price) / 100, bondCurrency(p)) : conv((q?.price ?? p.costBasis) * p.shares, q?.currency || 'USD');
    if (v == null) missing.add(p.symbol);
    else bySymbol[p.symbol] = (bySymbol[p.symbol] || 0) + v;
  }
  const cash = st.cash.reduce((s, c) => s + (conv(c.amount, c.currency || 'USD') ?? 0), 0);
  const invested = Object.values(bySymbol).reduce((s, v) => s + v, 0);
  const bonds = new Set(st.positions.filter((p) => p.bond).map((p) => p.symbol));
  return { base, bySymbol, cash, invested, total: invested + cash, quotes, missing: [...missing], bonds };
}
