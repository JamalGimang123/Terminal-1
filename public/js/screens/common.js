// Shared renderers used by several screens.
import { esc, price, pct, signed, cls, arrow, hhmm, ago, safeUrl, decimalsFor } from '../fmt.js';
import { sparkline } from '../charts.js';
import { flashKey } from '../dom.js';
import { nameOf, shortSym } from '../symbols.js';

// Quote table rows for a symbol list. Missing quotes show the source error.
export function quoteTable(symbols, quotes, errors = {}, { names = {}, spark = true, showTime = false, nameW = 150 } = {}) {
  const rows = symbols
    .map((s) => {
      const q = quotes[s];
      const nm = names[s] || nameOf(s, q?.name);
      if (!q) {
        return `<tr class="click" data-sym="${esc(s)}"><td class="sym">${esc(shortSym(s))}</td><td class="nm" style="max-width:${nameW}px">${esc(nm)}</td><td class="r muted" colspan="${spark ? 4 : 3}" title="${esc(errors[s] || '')}">unavailable</td></tr>`;
      }
      const d = /=X$/.test(s) ? (q.price >= 20 ? 3 : 4) : decimalsFor(q.price);
      const fk = flashKey(`q:${s}`, q.price);
      const srcTag = q.delayed ? ' <span class="tag delayed" title="' + esc(q.source) + '">D</span>' : q.stale ? ' <span class="tag delayed" title="stale">S</span>' : '';
      return `<tr class="click" data-sym="${esc(s)}" title="${esc(nm)} · ${esc(q.source || '')}${q.time ? ' · ' + esc(hhmm(q.time)) + ' ET' : ''}">
        <td class="sym">${esc(shortSym(s))}</td>
        <td class="nm" style="max-width:${nameW}px">${esc(nm)}</td>
        <td class="r b ${fk}">${price(q.price, d)}${srcTag}</td>
        <td class="r ${cls(q.change)}">${signed(q.change, d)}</td>
        <td class="r ${cls(q.changePct)}">${arrow(q.changePct)} ${pct(q.changePct)}</td>
        ${spark ? `<td class="r">${sparkline(q.spark, { w: 70, h: 18, base: q.prevClose })}</td>` : ''}
        ${showTime ? `<td class="r muted">${esc(hhmm(q.time))}</td>` : ''}
      </tr>`;
    })
    .join('');
  return `<table class="t compact"><thead><tr><th>Ticker</th><th>Name</th><th class="r">Last</th><th class="r">Chg</th><th class="r">%Chg</th>${spark ? '<th class="r">Intraday</th>' : ''}${showTime ? '<th class="r">Time</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
}

// Click a [data-sym] row anywhere inside `el` to open the security screen.
export function linkRows(el, navigate) {
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-sym]');
    if (tr && !e.target.closest('a,button,input')) navigate(`#/eq/${encodeURIComponent(tr.dataset.sym)}`);
  });
}

export function newsList(items, { highlight = [], limit = 60, showSummary = true } = {}) {
  if (!items?.length) return '<div class="empty">No headlines</div>';
  const hl = highlight.filter((s) => /^[A-Z]{2,5}$/.test(s));
  const re = hl.length ? new RegExp(`\\b(${hl.join('|')})\\b`) : null;
  return `<ul class="news">${items
    .slice(0, limit)
    .map((i) => {
      const hits = re ? [...new Set((`${i.title} ${(i.symbols || []).join(' ')}`.match(new RegExp(re, 'g')) || []))].slice(0, 3) : [];
      return `<li><div class="tm">${esc(hhmm(i.published))}<small>${esc(ago(i.published))}</small></div><div>
        ${hits.map((s) => `<span class="hit">${esc(s)}</span>`).join('')}<a class="hl" href="${safeUrl(i.link)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><span class="src">${esc(i.source)}${i.feed ? ' · ' + esc(i.feed) : ''}</span>
        ${showSummary && i.summary && i.summary !== i.title ? `<div class="sm">${esc(i.summary)}</div>` : ''}</div></li>`;
    })
    .join('')}</ul>`;
}

export function rangeBar(lo, hi, v) {
  if (![lo, hi, v].every(Number.isFinite) || hi <= lo) return '';
  const p = Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return `<div class="rangebar" title="${price(lo)} – ${price(hi)}"><i style="left:calc(${p.toFixed(1)}% - 1px)"></i></div>`;
}
