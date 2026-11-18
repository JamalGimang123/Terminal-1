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

// Value all positions & cash in the base currency (used by PSIM, FIRE and OVLP loaders).
export async function valuePortfolio(st, base = baseOf(st)) {
  const syms = [...new Set(st.positions.map((p) => p.symbol))];
  const { quotes } = await api.quotes(syms);
  const ccys = new Set([...syms.map((s) => quotes[s]?.currency || 'USD'), ...st.cash.map((c) => c.currency || 'USD')]);
  const fx = fxSymbolsFor(ccys, base);
  const fxq = fx.length ? (await api.quotes(fx)).quotes : {};
  const conv = converter(ratesFromQuotes(fxq), base);
  const bySymbol = {};
  const missing = new Set();
  for (const p of st.positions) {
    const q = quotes[p.symbol];
    const v = conv((q?.price ?? p.costBasis) * p.shares, q?.currency || 'USD');
    if (v == null) missing.add(p.symbol);
    else bySymbol[p.symbol] = (bySymbol[p.symbol] || 0) + v;
  }
  const cash = st.cash.reduce((s, c) => s + (conv(c.amount, c.currency || 'USD') ?? 0), 0);
  const invested = Object.values(bySymbol).reduce((s, v) => s + v, 0);
  return { base, bySymbol, cash, invested, total: invested + cash, quotes, missing: [...missing] };
}
