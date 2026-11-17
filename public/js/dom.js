// Small DOM helpers: element builder, panels, tables, toasts, modals.
import { esc } from './fmt.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// A titled terminal panel. Returns { el, body, meta, foot }.
let panelCounter = 0;
export function panel({ title, n, cls = '', bodyCls = '', meta = '', foot = '' } = {}) {
  const num = n ?? ++panelCounter;
  const metaEl = h('div', { class: 'meta', html: meta });
  const body = h('div', { class: `bd ${bodyCls}` });
  const foot_ = h('div', { class: 'ft', html: foot });
  const el = h('section', { class: `panel ${cls}` }, h('div', { class: 'hd' }, num !== '' ? h('span', { class: 'n' }, String(num)) : null, h('h2', {}, title), metaEl), body);
  if (foot) el.append(foot_);
  return { el, body, meta: metaEl, foot: foot_, setFoot(html) { foot_.innerHTML = html; if (!foot_.isConnected) el.append(foot_); } };
}
export const resetPanelCounter = () => (panelCounter = 0);

export function loading(el, msg = 'Loading') {
  el.innerHTML = `<div class="loading">${esc(msg)}</div>`;
}
export function errorBox(el, err) {
  el.innerHTML = `<div class="empty err">${esc(err?.message || err || 'Error')}</div>`;
}
export function empty(el, msg) {
  el.innerHTML = `<div class="empty">${esc(msg)}</div>`;
}

// Segmented control. options: [{value,label}] ; returns element with .value
export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' });
  const draw = () => {
    el.innerHTML = '';
    for (const o of options) {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      el.append(
        h('button', {
          type: 'button',
          class: opt.value === value ? 'on' : '',
          'aria-pressed': String(opt.value === value),
          title: opt.title || null,
          onclick: () => {
            value = opt.value;
            draw();
            onChange(value);
          },
        }, opt.label),
      );
    }
  };
  draw();
  el.setValue = (v) => {
    value = v;
    draw();
  };
  return el;
}

// Sortable table from column definitions.
// cols: [{key, label, cls, fmt(row)->html, sort(row)->value, title}]
export function table(cols, rows, { onRow, sortKey, sortDir = -1, rowCls, foot, compact = false, id } = {}) {
  const wrap = h('div');
  let key = sortKey;
  let dir = sortDir;
  const draw = () => {
    const sorted = [...rows];
    const col = cols.find((c) => c.key === key);
    if (col) {
      const sv = col.sort || ((r) => r[col.key]);
      sorted.sort((a, b) => {
        const x = sv(a);
        const y = sv(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
      });
    }
    const thead = `<thead><tr>${cols
      .map((c) => `<th class="${c.cls || ''} ${c.nosort ? '' : 'sort'} ${c.key === key ? 'sorted' + (dir > 0 ? ' asc' : '') : ''}" data-k="${esc(c.key)}" ${c.title ? `title="${esc(c.title)}"` : ''}>${c.label}</th>`)
      .join('')}</tr></thead>`;
    const tbody = `<tbody>${sorted
      .map((r, i) => `<tr data-i="${rows.indexOf(r)}" class="${onRow ? 'click' : ''} ${rowCls ? rowCls(r) : ''}">${cols.map((c) => `<td class="${c.cls || ''}">${c.fmt ? c.fmt(r, i) : esc(r[c.key])}</td>`).join('')}</tr>`)
      .join('')}</tbody>`;
    const tfoot = foot ? `<tfoot><tr>${foot.map((f) => `<td class="${f.cls || ''}">${f.html ?? ''}</td>`).join('')}</tr></tfoot>` : '';
    wrap.innerHTML = `<table class="t ${compact ? 'compact' : ''}" ${id ? `id="${id}"` : ''}>${thead}${tbody}${tfoot}</table>`;
  };
  wrap.addEventListener('click', (e) => {
    const th = e.target.closest('th.sort');
    if (th) {
      const k = th.dataset.k;
      if (k === key) dir = -dir;
      else {
        key = k;
        dir = -1;
      }
      draw();
      return;
    }
    const tr = e.target.closest('tbody tr');
    if (tr && onRow && !e.target.closest('a,button,input,select')) onRow(rows[Number(tr.dataset.i)], e);
  });
  draw();
  wrap.update = (newRows) => {
    rows = newRows;
    draw();
  };
  return wrap;
}

export function toast(msg, isErr = false) {
  const el = h('div', { class: `msg ${isErr ? 'err' : ''}` }, msg);
  $('#toast').append(el);
  setTimeout(() => el.remove(), 4200);
}

export function modal(title, content, { onClose } = {}) {
  const root = $('#modal-root');
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const back = h('div', { class: 'modal-back', onclick: (e) => e.target === back && close() }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'hd' }, title, h('button', { class: 'btn sm', onclick: close, 'aria-label': 'Close' }, 'ESC ✕')), h('div', { class: 'bd' }, content)));
  root.append(back);
  document.addEventListener('keydown', onKey);
  setTimeout(() => back.querySelector('input,select,button')?.focus(), 0);
  return { close };
}

export function setStatus(msg) {
  const el = $('#status-msg');
  if (el) el.textContent = msg;
}

// Flash a cell when its numeric value changes between renders.
const lastValues = new Map();
export function flashKey(key, value) {
  const prev = lastValues.get(key);
  lastValues.set(key, value);
  if (prev == null || value == null || prev === value) return '';
  return value > prev ? 'flash-up' : 'flash-down';
}

export function downloadFile(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
