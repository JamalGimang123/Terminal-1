// Dependency-free SVG charts tuned for the terminal theme.
// Every chart: thin marks, hairline grid, crosshair/hover tooltip, re-renders on resize.
import { esc } from './fmt.js';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
export const HEX = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
export const UP = '#2fd36b';
export const DOWN = '#ff5c5c';
export const AMBER = '#ffa028';

// ---- scales & ticks -----------------------------------------------------------
function linear(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  const f = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  f.invert = (p) => d0 + ((p - r0) / (r1 - r0)) * span;
  return f;
}

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const d = Math.abs(min) * 0.05 || 1;
    min -= d;
    max += d;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(min / step - 1e-9) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

function extent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export const compactNum = (v) => {
  const a = Math.abs(v);
  if (a < 1e-12) return '0';
  if (a >= 1e12) return (v / 1e12).toFixed(a >= 1e13 ? 0 : 1) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(0) + 'K';
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(a >= 10 ? 1 : 2).replace(/\.0$/, '');
  return v.toFixed(a >= 0.01 ? 3 : 4);
};

// Time tick labels for index-based x axes.
function timeLabel(t, spanMs) {
  const d = new Date(t);
  if (spanMs <= 1.6 * 86400e3) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  if (spanMs <= 8 * 86400e3) return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  if (spanMs <= 400 * 86400e3) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function timeTipLabel(t, spanMs) {
  const d = new Date(t);
  if (spanMs <= 8 * 86400e3) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---- mounting & tooltip ---------------------------------------------------------
const observers = new WeakMap();
function mount(el, draw) {
  el.classList.add('viz');
  const run = () => {
    const w = Math.max(160, Math.floor(el.clientWidth || el.getBoundingClientRect().width || 600));
    draw(w);
  };
  observers.get(el)?.disconnect();
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(el.clientWidth);
    if (w && Math.abs(w - lastW) > 4) {
      lastW = w;
      run();
    }
  });
  ro.observe(el);
  observers.set(el, ro);
  run();
}

function tipEl(el) {
  let tip = el.querySelector(':scope > .tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    el.append(tip);
  }
  return tip;
}

function placeTip(el, tip, x, y) {
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const W = el.clientWidth;
  let left = x + 14;
  if (left + w > W) left = x - w - 14;
  if (left < 0) left = 0;
  let top = y - h / 2;
  if (top < 0) top = 0;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function legend(items) {
  return `<div class="legend">${items.map((i) => `<span><span class="sw ${i.box ? 'box' : ''}" style="background:${i.color}"></span>${esc(i.name)}</span>`).join('')}</div>`;
}

// ---- line / area chart ---------------------------------------------------------------
/**
 * opts: {
 *   x: array of x values (timestamps for xType 'time', numbers, or labels for 'category'),
 *   xType: 'time' | 'category' | 'number',
 *   series: [{ name, values: number[], color, width, area, dash }],
 *   bands: [{ lo: number[], hi: number[], color, opacity }],
 *   height, yFmt, xFmt, tipXFmt, refY: {value, label}, yMin, yMax, legend: bool, zeroLine
 * }
 */
export function lineChart(el, opts) {
  mount(el, (W) => drawLine(el, W, opts));
}

function drawLine(el, W, o) {
  const H = o.height || 240;
  const n = o.x.length;
  const yFmt = o.yFmt || compactNum;
  const all = [];
  for (const s of o.series) all.push(...s.values);
  for (const b of o.bands || []) all.push(...b.lo, ...b.hi);
  if (o.refY) all.push(o.refY.value);
  let [lo, hi] = extent(all);
  if (o.yMin != null) lo = Math.min(lo, o.yMin);
  if (o.yMax != null) hi = Math.max(hi, o.yMax);
  if (o.yRange) [lo, hi] = o.yRange; // fixed axis; marks outside are clipped
  if (!Number.isFinite(lo)) {
    el.innerHTML = '<div class="empty">No data</div>';
    return;
  }
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.02 || 1;
  if (o.yMin == null && !o.yRange) lo -= pad;
  if (!o.yRange) hi += pad;
  const ticks = niceTicks(lo, hi, Math.max(3, Math.round(H / 55)));
  const tickW = Math.max(...ticks.map((t) => yFmt(t).length)) * 6.3 + 10;
  const m = { l: 6, r: Math.max(40, tickW), t: 8, b: 22 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const xVal = (i) => (o.xType === 'number' ? o.x[i] : i);
  const [x0, x1] = o.xType === 'number' ? extent(o.x) : [0, Math.max(1, n - 1)];
  const X = linear(x0, x1, m.l, m.l + pw);
  const Y = linear(lo, hi, m.t + ph, m.t);
  const path = (vals) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${X(xVal(i)).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const clipId = `clip${Math.random().toString(36).slice(2, 8)}`;
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || o.series.map((s) => s.name).join(', '))}"><defs><clipPath id="${clipId}"><rect x="${m.l}" y="${m.t - 2}" width="${pw}" height="${ph + 4}"/></clipPath></defs>`;
  for (const t of ticks) {
    const y = Y(t).toFixed(1);
    svg += `<line class="grid-line" x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}"/><text class="tick" x="${m.l + pw + 6}" y="${+y + 3}">${esc(yFmt(t))}</text>`;
  }
  if (o.zeroLine && lo < 0 && hi > 0) svg += `<line class="axis-line" x1="${m.l}" x2="${m.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  // x ticks
  const span = o.xType === 'time' && n > 1 ? o.x[n - 1] - o.x[0] : 0;
  const xLabel = o.xFmt || (o.xType === 'time' ? (v) => timeLabel(v, span) : (v) => String(v));
  const nT = Math.max(2, Math.floor(pw / 90));
  if (o.xType === 'number') {
    for (const t of niceTicks(x0, x1, nT)) svg += `<text class="tick" x="${X(t)}" y="${H - 6}" text-anchor="middle">${esc(xLabel(t))}</text>`;
  } else {
    const step = Math.max(1, Math.ceil(n / nT));
    for (let i = 0; i < n; i += step) svg += `<text class="tick" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(xLabel(o.x[i], i))}</text>`;
  }
  svg += `<line class="axis-line" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
  svg += `<g clip-path="url(#${clipId})">`;
  // bands
  for (const b of o.bands || []) {
    let d = '';
    b.hi.forEach((v, i) => (d += `${i ? 'L' : 'M'}${X(xVal(i)).toFixed(1)},${Y(v).toFixed(1)}`));
    for (let i = b.lo.length - 1; i >= 0; i--) d += `L${X(xVal(i)).toFixed(1)},${Y(b.lo[i]).toFixed(1)}`;
    svg += `<path d="${d}Z" fill="${b.color}" fill-opacity="${b.opacity ?? 0.18}" stroke="none"/>`;
  }
  if (o.refY) {
    const y = Y(o.refY.value).toFixed(1);
    svg += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/>`;
    if (o.refY.label) svg += `<text class="lbl" x="${m.l + 4}" y="${+y - 4}">${esc(o.refY.label)}</text>`;
  }
  o.series.forEach((s, si) => {
    const color = s.color || SERIES[si % 8];
    const d = path(s.values);
    if (!d) return;
    if (s.area) {
      const firstIdx = s.values.findIndex((v) => v != null);
      let lastIdx = s.values.length - 1;
      while (lastIdx > 0 && s.values[lastIdx] == null) lastIdx--;
      const base = Y(Math.max(lo, Math.min(hi, s.areaBase ?? lo)));
      svg += `<path d="${d}L${X(xVal(lastIdx))},${base}L${X(xVal(firstIdx))},${base}Z" fill="${color}" fill-opacity="${s.areaOpacity ?? 0.12}"/>`;
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${s.width || 1.6}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="4 3"' : ''}/>`;
  });
  svg += '</g>';
  // end labels (direct labelling) for <= 4 series
  if (o.endLabels && o.series.length <= 4) {
    const placed = [];
    o.series.forEach((s, si) => {
      let i = s.values.length - 1;
      while (i > 0 && s.values[i] == null) i--;
      let y = Y(s.values[i]);
      for (const p of placed) if (Math.abs(p - y) < 12) y = p + (y >= p ? 12 : -12);
      placed.push(y);
      svg += `<circle cx="${X(xVal(i))}" cy="${Y(s.values[i])}" r="3" fill="${s.color || SERIES[si]}" stroke="var(--panel)" stroke-width="2"/>`;
    });
  }
  svg += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/><g class="hover-dots"></g>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
  el.innerHTML = (o.legend ?? o.series.length > 1 ? legend(o.series.map((s, i) => ({ name: s.name, color: s.color || SERIES[i % 8] }))) : '') + svg;

  const svgEl = el.querySelector('svg');
  const hair = svgEl.querySelector('.xhair');
  const dots = svgEl.querySelector('.hover-dots');
  const tip = tipEl(el);
  const tipX = o.tipXFmt || (o.xType === 'time' ? (v) => timeTipLabel(v, span) : xLabel);
  const nearest = (px) => {
    if (o.xType === 'number') {
      const xv = X.invert(px);
      let best = 0;
      o.x.forEach((v, i) => {
        if (Math.abs(v - xv) < Math.abs(o.x[best] - xv)) best = i;
      });
      return best;
    }
    return Math.max(0, Math.min(n - 1, Math.round(X.invert(px))));
  };
  svgEl.querySelector('.hit').addEventListener('mousemove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const i = nearest(e.clientX - rect.left);
    const cx = X(xVal(i));
    hair.setAttribute('x1', cx);
    hair.setAttribute('x2', cx);
    hair.setAttribute('visibility', 'visible');
    let dh = '';
    let rows = '';
    o.series.forEach((s, si) => {
      const v = s.values[i];
      if (v == null || !Number.isFinite(v)) return;
      const c = s.color || SERIES[si % 8];
      dh += `<circle cx="${cx}" cy="${Y(v)}" r="4" fill="${c}" stroke="var(--panel)" stroke-width="2"/>`;
      rows += `<div><span class="sw" style="background:${c}"></span>${esc(s.name)} <b>${esc((s.fmt || o.tipFmt || yFmt)(v))}</b></div>`;
    });
    for (const b of o.bands || []) if (b.name) rows += `<div class="muted">${esc(b.name)}: ${esc((o.tipFmt || yFmt)(b.lo[i]))} – ${esc((o.tipFmt || yFmt)(b.hi[i]))}</div>`;
    dots.innerHTML = dh;
    tip.innerHTML = `<div class="tt">${esc(tipX(o.x[i], i))}</div>${rows}${o.tipExtra ? o.tipExtra(i) : ''}`;
    placeTip(el, tip, cx, e.clientY - rect.top);
  });
  svgEl.querySelector('.hit').addEventListener('mouseleave', () => {
    hair.setAttribute('visibility', 'hidden');
    dots.innerHTML = '';
    tip.hidden = true;
  });
}

// ---- price chart: line/area or candles, with a separate volume pane --------------------
/**
 * opts: { points: [{t,o,h,l,c,v}], mode: 'line'|'candle', overlays: [{name, values, color}],
 *         refY: {value,label}, height, showVolume, fmt }
 */
export function priceChart(el, opts) {
  mount(el, (W) => drawPrice(el, W, opts));
}

function drawPrice(el, W, o) {
  const pts = o.points;
  const n = pts.length;
  if (!n) {
    el.innerHTML = '<div class="empty">No price data</div>';
    return;
  }
  const H = o.height || 320;
  const fmt = o.fmt || ((v) => v.toFixed(2));
  const volH = o.showVolume !== false && pts.some((p) => p.v > 0) ? Math.round(H * 0.2) : 0;
  const vals = o.mode === 'candle' ? pts.flatMap((p) => [p.h, p.l]) : pts.map((p) => p.c);
  for (const ov of o.overlays || []) vals.push(...ov.values);
  if (o.refY) vals.push(o.refY.value);
  let [lo, hi] = extent(vals);
  const pad = (hi - lo) * 0.06 || hi * 0.01 || 1;
  lo -= pad;
  hi += pad;
  const ticks = niceTicks(lo, hi, 6);
  const m = { l: 6, r: Math.max(46, Math.max(...ticks.map((t) => fmt(t).length)) * 6.3 + 12), t: 8, b: 22 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b - (volH ? volH + 6 : 0);
  const X = linear(-0.5, n - 0.5, m.l, m.l + pw);
  const Y = linear(lo, hi, m.t + ph, m.t);
  const first = pts[0].c;
  const last = pts[n - 1].c;
  const base = o.refY?.value ?? first;
  const lineColor = last >= base ? UP : DOWN;
  let svg = `<svg width="${W}" height="${H}" role="img" aria-label="Price chart">`;
  for (const t of ticks) svg += `<line class="grid-line" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l + pw + 6}" y="${Y(t) + 3}">${esc(fmt(t))}</text>`;
  const span = pts[n - 1].t - pts[0].t;
  const nT = Math.max(2, Math.floor(pw / 95));
  const step = Math.max(1, Math.ceil(n / nT));
  for (let i = 0; i < n; i += step) svg += `<text class="tick" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(timeLabel(pts[i].t, span))}</text>`;
  if (o.refY) {
    svg += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(o.refY.value)}" y2="${Y(o.refY.value)}" stroke="var(--muted)" stroke-dasharray="2 3"/>`;
    svg += `<text class="lbl" x="${m.l + 4}" y="${Y(o.refY.value) - 4}">${esc(o.refY.label || '')}</text>`;
  }
  if (o.mode === 'candle') {
    const bw = Math.max(1, Math.min(9, (pw / n) * 0.7));
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const c = p.c >= p.o ? UP : DOWN;
      const x = X(i);
      svg += `<line x1="${x}" x2="${x}" y1="${Y(p.h)}" y2="${Y(p.l)}" stroke="${c}" stroke-width="1"/>`;
      const y1 = Y(Math.max(p.o, p.c));
      const hgt = Math.max(1, Math.abs(Y(p.o) - Y(p.c)));
      svg += `<rect x="${x - bw / 2}" y="${y1}" width="${bw}" height="${hgt}" fill="${p.c >= p.o ? 'var(--panel)' : c}" stroke="${c}" stroke-width="1"/>`;
    }
  } else {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.c).toFixed(1)}`).join('');
    svg += `<path d="${d}L${X(n - 1)},${m.t + ph}L${X(0)},${m.t + ph}Z" fill="${lineColor}" fill-opacity=".09"/>`;
    svg += `<path d="${d}" fill="none" stroke="${lineColor}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  (o.overlays || []).forEach((ov) => {
    let d = '';
    let pen = false;
    ov.values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    if (d) svg += `<path d="${d}" fill="none" stroke="${ov.color}" stroke-width="1.3"/>`;
  });
  // last price marker on the axis
  svg += `<rect x="${m.l + pw + 1}" y="${Y(last) - 8}" width="${m.r - 2}" height="16" fill="${lineColor}"/><text x="${m.l + pw + 5}" y="${Y(last) + 4}" font-size="10.5" font-weight="700" fill="#000" font-family="var(--font)">${esc(fmt(last))}</text>`;
  if (volH) {
    const vy0 = m.t + ph + 6;
    const vmax = Math.max(...pts.map((p) => p.v || 0)) || 1;
    const VY = linear(0, vmax, vy0 + volH, vy0);
    const bw = Math.max(1, (pw / n) * 0.7);
    svg += `<line class="grid-line" x1="${m.l}" x2="${m.l + pw}" y1="${vy0 + volH}" y2="${vy0 + volH}"/>`;
    svg += `<text class="tick" x="${m.l + pw + 6}" y="${vy0 + 9}">${esc(compactNum(vmax))}</text><text class="tick" x="${m.l + pw + 6}" y="${vy0 + volH}">VOL</text>`;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (!p.v) continue;
      const up = i === 0 ? p.c >= p.o : p.c >= pts[i - 1].c;
      svg += `<rect x="${X(i) - bw / 2}" y="${VY(p.v)}" width="${bw}" height="${vy0 + volH - VY(p.v)}" fill="${up ? UP : DOWN}" fill-opacity=".45"/>`;
    }
  }
  svg += `<line class="xhair" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/><line class="yhair xhair" x1="${m.l}" x2="${m.l + pw}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${H - m.t - m.b}" fill="transparent"/></svg>`;
  const ovLegend = (o.overlays || []).length ? legend([{ name: 'Price', color: lineColor }, ...o.overlays.map((v) => ({ name: v.name, color: v.color }))]) : '';
  el.innerHTML = ovLegend + svg;
  const svgEl = el.querySelector('svg');
  const [vh, hh] = svgEl.querySelectorAll('.xhair');
  const tip = tipEl(el);
  svgEl.querySelector('.hit').addEventListener('mousemove', (e) => {
    const r = svgEl.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const i = Math.max(0, Math.min(n - 1, Math.round(X.invert(px))));
    const p = pts[i];
    vh.setAttribute('x1', X(i));
    vh.setAttribute('x2', X(i));
    vh.setAttribute('visibility', 'visible');
    if (py < m.t + ph) {
      hh.setAttribute('y1', py);
      hh.setAttribute('y2', py);
      hh.setAttribute('visibility', 'visible');
    } else hh.setAttribute('visibility', 'hidden');
    const prev = i > 0 ? pts[i - 1].c : o.refY?.value;
    const ch = prev ? ((p.c - prev) / prev) * 100 : null;
    let rows = o.mode === 'candle' || p.o !== p.c ? `<div>O ${fmt(p.o)} H ${fmt(p.h)} L ${fmt(p.l)}</div>` : '';
    rows += `<div>Close <b>${fmt(p.c)}</b>${ch != null ? ` <span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span>` : ''}</div>`;
    if (p.v) rows += `<div class="muted">Vol ${compactNum(p.v)}</div>`;
    for (const ov of o.overlays || []) if (ov.values[i] != null) rows += `<div><span class="sw" style="background:${ov.color}"></span>${esc(ov.name)} ${fmt(ov.values[i])}</div>`;
    if (py < m.t + ph) rows += `<div class="muted">Cursor ${fmt(Y.invert(py))}</div>`;
    tip.innerHTML = `<div class="tt">${esc(timeTipLabel(p.t, span))}</div>${rows}`;
    placeTip(el, tip, X(i), py);
  });
  svgEl.querySelector('.hit').addEventListener('mouseleave', () => {
    vh.setAttribute('visibility', 'hidden');
    hh.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
}

// ---- column chart (vertical bars, optional grouping) --------------------------------------
/** opts: { labels: [], series: [{name, values, color}], height, yFmt, signedColors } */
export function columnChart(el, opts) {
  mount(el, (W) => drawColumns(el, W, opts));
}

function drawColumns(el, W, o) {
  const H = o.height || 200;
  const yFmt = o.yFmt || compactNum;
  const all = o.series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.length) {
    el.innerHTML = '<div class="empty">No data</div>';
    return;
  }
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.08 || 1;
  if (hi > 0) hi += pad;
  if (lo < 0) lo -= pad;
  const ticks = niceTicks(lo, hi, 4);
  const m = { l: 6, r: Math.max(40, Math.max(...ticks.map((t) => yFmt(t).length)) * 6.3 + 10), t: 8, b: 22 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = o.labels.length;
  const k = o.series.length;
  const slot = pw / n;
  const bw = Math.max(2, Math.min(36, (slot * 0.72) / k - 2));
  const Y = linear(lo, hi, m.t + ph, m.t);
  let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(o.title || 'Column chart')}">`;
  for (const t of ticks) svg += `<line class="grid-line" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l + pw + 6}" y="${Y(t) + 3}">${esc(yFmt(t))}</text>`;
  svg += `<line class="axis-line" x1="${m.l}" x2="${m.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 56))));
  o.labels.forEach((lab, i) => {
    if (i % every === 0) svg += `<text class="tick" x="${m.l + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(lab)}</text>`;
  });
  o.series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      if (v == null) return;
      const x = m.l + slot * i + slot / 2 - (k * (bw + 2)) / 2 + si * (bw + 2) + 1;
      const y = Y(Math.max(0, v));
      const h = Math.max(1, Math.abs(Y(v) - Y(0)));
      const color = o.signedColors ? (v >= 0 ? UP : DOWN) : s.color || SERIES[si];
      const r = Math.min(3, bw / 2);
      // rounded data-end, square baseline end
      const top = v >= 0;
      const p = top
        ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z`
        : `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + bw - r}Q${x + bw},${y + h} ${x + bw},${y + h - r}V${y}Z`;
      svg += `<path d="${p}" fill="${color}" data-i="${i}" data-s="${si}"/>`;
    });
  });
  for (let i = 0; i < n; i++) svg += `<rect class="hitcol" data-i="${i}" x="${m.l + slot * i}" y="${m.t}" width="${slot}" height="${ph}" fill="transparent"/>`;
  svg += '</svg>';
  el.innerHTML = (k > 1 ? legend(o.series.map((s, i) => ({ name: s.name, color: s.color || SERIES[i], box: true }))) : '') + svg;
  const svgEl = el.querySelector('svg');
  const tip = tipEl(el);
  svgEl.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.hitcol');
    if (!hit) {
      tip.hidden = true;
      return;
    }
    const i = Number(hit.dataset.i);
    const r = svgEl.getBoundingClientRect();
    tip.innerHTML = `<div class="tt">${esc(o.tipLabels?.[i] ?? o.labels[i])}</div>${o.series
      .map((s, si) => (s.values[i] == null ? '' : `<div><span class="sw" style="background:${o.signedColors ? (s.values[i] >= 0 ? UP : DOWN) : s.color || SERIES[si]}"></span>${esc(s.name)} <b>${esc((o.tipFmt || yFmt)(s.values[i]))}</b></div>`))
      .join('')}`;
    placeTip(el, tip, e.clientX - r.left, e.clientY - r.top);
  });
  svgEl.addEventListener('mouseleave', () => (tip.hidden = true));
}

// ---- scatter (risk/return) ------------------------------------------------------------------
/** opts: { cloud: [{x,y,c}], line: [{x,y}], marks: [{x,y,label,color}], xFmt, yFmt, height, cloudColor(c) } */
export function scatterChart(el, opts) {
  mount(el, (W) => drawScatter(el, W, opts));
}

function drawScatter(el, W, o) {
  const H = o.height || 320;
  const xs = [...o.cloud.map((p) => p.x), ...(o.line || []).map((p) => p.x), ...o.marks.map((p) => p.x)];
  const ys = [...o.cloud.map((p) => p.y), ...(o.line || []).map((p) => p.y), ...o.marks.map((p) => p.y)];
  let [x0, x1] = extent(xs);
  let [y0, y1] = extent(ys);
  const px = (x1 - x0) * 0.08 || 0.01;
  const py = (y1 - y0) * 0.1 || 0.01;
  x0 = Math.max(0, x0 - px);
  x1 += px;
  y0 -= py;
  y1 += py;
  const yt = niceTicks(y0, y1, 5);
  const m = { l: 6, r: 52, t: 10, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const X = linear(x0, x1, m.l, m.l + pw);
  const Y = linear(y0, y1, m.t + ph, m.t);
  let svg = `<svg width="${W}" height="${H}" role="img" aria-label="Risk vs return scatter">`;
  for (const t of yt) svg += `<line class="grid-line" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l + pw + 6}" y="${Y(t) + 3}">${esc(o.yFmt(t))}</text>`;
  for (const t of niceTicks(x0, x1, Math.floor(pw / 80))) svg += `<text class="tick" x="${X(t)}" y="${m.t + ph + 14}" text-anchor="middle">${esc(o.xFmt(t))}</text>`;
  svg += `<text class="tick" x="${m.l + pw / 2}" y="${H - 2}" text-anchor="middle">${esc(o.xLabel || 'Volatility')}</text>`;
  svg += `<line class="axis-line" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
  for (const p of o.cloud) svg += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="1.6" fill="${o.cloudColor ? o.cloudColor(p.c) : 'var(--q3)'}" fill-opacity=".55"/>`;
  if (o.line?.length) svg += `<path d="${o.line.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('')}" fill="none" stroke="var(--amber)" stroke-width="2"/>`;
  const boxes = [];
  o.marks.forEach((p, i) => {
    svg += `<circle class="mk" data-i="${i}" cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r || 5}" fill="${p.color}" stroke="var(--panel)" stroke-width="2"/>`;
  });
  // Labels after marks; nudge vertically (then flip side) until they don't collide.
  [...o.marks].sort((a, b) => (b.r || 5) - (a.r || 5)).forEach((p) => {
    if (!p.label) return;
    const w = p.label.length * 6.8 + 4;
    let right = X(p.x) < m.l + pw - 90;
    let y = Y(p.y) + 4;
    const hit = (x0, yy) => boxes.some((b) => x0 < b.x1 && x0 + w > b.x0 && yy - 10 < b.y1 && yy + 2 > b.y0);
    const x0For = (r) => (r ? X(p.x) + 9 : X(p.x) - 9 - w);
    for (let k = 0; k < 8 && hit(x0For(right), y); k++) {
      if (k === 3) right = !right;
      y = Y(p.y) + 4 + (k % 2 ? -1 : 1) * 12 * Math.ceil((k % 3 || 1) / 1);
    }
    const x0 = x0For(right);
    boxes.push({ x0, x1: x0 + w, y0: y - 10, y1: y + 2 });
    svg += `<text class="lbl-strong" x="${right ? X(p.x) + 9 : X(p.x) - 9}" y="${y}" text-anchor="${right ? 'start' : 'end'}">${esc(p.label)}</text>`;
  });
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
  el.innerHTML = (o.legendItems ? legend(o.legendItems) : '') + svg;
  const svgEl = el.querySelector('svg');
  const tip = tipEl(el);
  svgEl.querySelector('.hit').addEventListener('mousemove', (e) => {
    const r = svgEl.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    // nearest highlighted mark within 24px, else nearest cloud point
    let best = null;
    let bd = 24 * 24;
    for (const p of o.marks) {
      const d = (X(p.x) - mx) ** 2 + (Y(p.y) - my) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) {
      bd = 14 * 14;
      for (const p of o.cloud) {
        const d = (X(p.x) - mx) ** 2 + (Y(p.y) - my) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    if (!best) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = `<div class="tt">${esc(best.label || 'Portfolio')}</div><div>Return <b>${esc(o.yFmt(best.y))}</b></div><div>Volatility <b>${esc(o.xFmt(best.x))}</b></div>${o.tipExtra ? o.tipExtra(best) : ''}`;
    placeTip(el, tip, X(best.x), Y(best.y));
  });
  svgEl.querySelector('.hit').addEventListener('mouseleave', () => (tip.hidden = true));
}

// ---- small inline pieces ------------------------------------------------------------------------
export function sparkline(values, { w = 90, h = 22, color, base } = {}) {
  const v = (values || []).filter((x) => x != null && Number.isFinite(x));
  if (v.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const [lo, hi] = extent(base != null ? [...v, base] : v);
  const X = linear(0, v.length - 1, 1, w - 1);
  const Y = linear(lo, hi, h - 2, 2);
  const c = color || (v.at(-1) >= (base ?? v[0]) ? UP : DOWN);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join('');
  const ref = base != null ? `<line x1="0" x2="${w}" y1="${Y(base).toFixed(1)}" y2="${Y(base).toFixed(1)}" stroke="var(--line-2)" stroke-width="1" stroke-dasharray="2 2"/>` : '';
  return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true">${ref}<path d="${d}" fill="none" stroke="${c}" stroke-width="1.3"/></svg>`;
}

// Horizontal bar list: [{label, value, sub, color}] -> HTML table
export function hbars(items, { fmt = (v) => v.toFixed(1), max, labelW = 110, onClickAttr } = {}) {
  if (!items.length) return '<div class="empty">No data</div>';
  const mx = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  return `<table class="t compact">${items
    .map(
      (i) => `<tr ${onClickAttr ? onClickAttr(i) : ''} title="${esc(i.title || `${i.label}: ${fmt(i.value)}`)}">
      <td class="${i.labelCls || ''}" style="width:${labelW}px;max-width:${labelW}px;overflow:hidden;text-overflow:ellipsis">${esc(i.label)}</td>
      <td style="width:60%"><div class="wbar" style="width:${Math.max(0.5, (Math.abs(i.value) / mx) * 100).toFixed(2)}%;background:${i.color || 'var(--s1)'}"></div></td>
      <td class="r">${esc(fmt(i.value))}</td>${i.sub != null ? `<td class="r dim">${esc(i.sub)}</td>` : ''}</tr>`,
    )
    .join('')}</table>`;
}

// Diverging blue <-> gray <-> red for correlations / returns (v in [-1, 1]).
export function divergingColor(v) {
  const t = Math.max(-1, Math.min(1, v));
  const mid = [56, 56, 53];
  const pos = [57, 135, 229]; // blue
  const neg = [230, 103, 103]; // red
  const end = t >= 0 ? pos : neg;
  const a = Math.abs(t);
  const c = mid.map((m, i) => Math.round(m + (end[i] - m) * a));
  return `rgb(${c.join(',')})`;
}

// Sequential (single-hue blue) for magnitude t in [0,1].
export function sequentialColor(t) {
  const lo = [24, 32, 42];
  const hi = [57, 135, 229];
  const a = Math.max(0, Math.min(1, t));
  return `rgb(${lo.map((l, i) => Math.round(l + (hi[i] - l) * a)).join(',')})`;
}

// Performance heat for sector tiles: red <- gray -> green by % change (±3% saturates).
export function perfColor(pct) {
  const t = Math.max(-1, Math.min(1, (pct || 0) / 3));
  const mid = [40, 44, 50];
  const end = t >= 0 ? [20, 140, 70] : [190, 50, 50];
  const a = Math.abs(t) ** 0.8;
  return `rgb(${mid.map((m, i) => Math.round(m + (end[i] - m) * a)).join(',')})`;
}
