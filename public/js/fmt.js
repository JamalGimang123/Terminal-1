// Number, date and text formatting for terminal display.
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const DASH = '—';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || '')) ? esc(u) : '#';
}

export function decimalsFor(v) {
  const a = Math.abs(v);
  if (a >= 1000) return 2;
  if (a >= 1) return 2;
  if (a >= 0.1) return 4;
  if (a === 0) return 2;
  return 6;
}

export function price(v, d) {
  if (!isNum(v)) return DASH;
  return v.toLocaleString('en-US', { minimumFractionDigits: d ?? decimalsFor(v), maximumFractionDigits: d ?? decimalsFor(v) });
}

export function num(v, d = 2) {
  if (!isNum(v)) return DASH;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function int(v) {
  if (!isNum(v)) return DASH;
  return Math.round(v).toLocaleString('en-US');
}

export function signed(v, d = 2) {
  if (!isNum(v)) return DASH;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
}

export function pct(v, d = 2, { sign = true } = {}) {
  if (!isNum(v)) return DASH;
  return (sign ? signed(v, d) : num(v, d)) + '%';
}

// Fraction (0.071) -> "7.10%"
export function pctf(v, d = 2, opts) {
  return isNum(v) ? pct(v * 100, d, opts ?? { sign: false }) : DASH;
}

export function money(v, d = 2) {
  if (!isNum(v)) return DASH;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v < 0 ? '−$' : '$') + s;
}

export function moneySigned(v, d = 2) {
  if (!isNum(v)) return DASH;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function big(v, d = 2) {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const sgn = v < 0 ? '−' : '';
  if (a >= 1e12) return sgn + (a / 1e12).toFixed(d) + 'T';
  if (a >= 1e9) return sgn + (a / 1e9).toFixed(d) + 'B';
  if (a >= 1e6) return sgn + (a / 1e6).toFixed(d) + 'M';
  if (a >= 1e3) return sgn + (a / 1e3).toFixed(d) + 'K';
  return sgn + a.toFixed(d > 2 ? d : 0);
}

export function bigMoney(v, d = 2) {
  if (!isNum(v)) return DASH;
  return (v < 0 ? '−$' : '$') + big(Math.abs(v), d);
}

export function bp(v) {
  if (!isNum(v)) return DASH;
  return signed(v, 0) + 'bp';
}

export function cls(v) {
  if (!isNum(v) || Math.abs(v) < 1e-12) return 'flat';
  return v > 0 ? 'up' : 'down';
}

export function arrow(v) {
  if (!isNum(v) || v === 0) return '';
  return v > 0 ? '▲' : '▼';
}

// "▲ +1.23 (+0.45%)"
export function changeHtml(change, changePct, d) {
  const c = cls(changePct ?? change);
  return `<span class="${c}">${arrow(changePct ?? change)} ${signed(change, d ?? (isNum(change) ? decimalsFor(change) : 2))} (${pct(changePct)})</span>`;
}

const tzFmt = {};
export function timeIn(date, tz, opts = { hour: '2-digit', minute: '2-digit', hour12: false }) {
  const k = tz + JSON.stringify(opts);
  tzFmt[k] ||= new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
  return tzFmt[k].format(date);
}

export function hhmm(iso) {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(+d) ? DASH : timeIn(d, 'America/New_York');
}

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function date(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!iso) return DASH;
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  return Number.isNaN(+d) ? DASH : d.toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

export function shortDate(iso) {
  return date(iso, { month: 'short', day: 'numeric' });
}

export function years(v) {
  if (!isNum(v)) return DASH;
  if (!Number.isFinite(v)) return 'never';
  return v < 1 ? `${Math.round(v * 12)} mo` : `${v.toFixed(1)} yrs`;
}
