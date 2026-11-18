// App shell: routing, command line, function keys, clocks, ticker tape, health.
import { api } from './api.js';
import { $, h, toast, setStatus, resetPanelCounter } from './dom.js';
import { esc, price, pct, cls, arrow, timeIn, displayTz, tzLabel, setDisplayTz } from './fmt.js';
import { loadState, state, update } from './state.js';
import { TAPE, shortSym } from './symbols.js';

import market from './screens/market.js';
import equity from './screens/equity.js';
import news from './screens/news.js';
import macro from './screens/macro.js';
import portfolio from './screens/portfolio.js';
import overlap from './screens/overlap.js';
import sim from './screens/sim.js';
import fire from './screens/fire.js';
import help from './screens/help.js';
import themeScreen from './screens/theme.js';
import { applyTheme } from './theme.js';

const SCREENS = [help, market, equity, news, macro, portfolio, overlap, sim, fire, themeScreen];
const byId = Object.fromEntries(SCREENS.map((s) => [s.id, s]));
let current = null;
let lastSymbol = 'AAPL';

// ---- routing ------------------------------------------------------------------------
export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'mkt';
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').map(decodeURIComponent);
  return { id: parts[0].toLowerCase(), args: parts.slice(1), query: new URLSearchParams(query) };
}

async function route() {
  const { id, args, query } = parseHash();
  const screen = byId[id] || market;
  if (screen.id === 'eq' && args[0]) lastSymbol = args[0].toUpperCase();
  current?.ctx.destroy();
  const root = $('#screen');
  root.innerHTML = '';
  resetPanelCounter();
  const ctx = makeCtx();
  current = { screen, ctx };
  document.querySelectorAll('#fkeys a').forEach((a) => a.classList.toggle('active', a.dataset.id === screen.id));
  document.title = `${screen.id === 'eq' && args[0] ? args[0].toUpperCase() + ' · ' : ''}${screen.title} · FinTerm`;
  try {
    await screen.mount(root, { args, query }, ctx);
  } catch (err) {
    console.error(err);
    root.append(h('div', { class: 'empty err' }, `Screen error: ${err.message}`));
  }
  root.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function makeCtx() {
  const timers = [];
  const cleanups = [];
  let alive = true;
  return {
    get alive() {
      return alive;
    },
    // Run fn now-ish and every ms while the tab is visible and this screen is mounted.
    every(ms, fn, { immediate = false } = {}) {
      const tick = () => {
        if (alive && document.visibilityState === 'visible') fn();
      };
      if (immediate) tick();
      timers.push(setInterval(tick, ms));
    },
    onDestroy(fn) {
      cleanups.push(fn);
    },
    navigate,
    destroy() {
      alive = false;
      timers.forEach(clearInterval);
      cleanups.forEach((f) => f());
    },
  };
}

// ---- function keys ---------------------------------------------------------------------
const KEYS = [
  ['F1', 'HELP', 'help', 'Help & commands'],
  ['F2', 'MKT', 'mkt', 'Market monitor'],
  ['F3', 'EQ', 'eq', 'Security detail'],
  ['F4', 'NEWS', 'news', 'News'],
  ['F5', 'ECO', 'eco', 'Macro & rates'],
  ['F6', 'PORT', 'port', 'My portfolio'],
  ['F7', 'OVLP', 'ovlp', 'ETF overlap'],
  ['F8', 'PSIM', 'psim', 'Portfolio simulator'],
  ['F9', 'FIRE', 'fire', 'FIRE & savings'],
  ['F10', 'THEME', 'cfg', 'Colors & display'],
];

function hashFor(id) {
  return id === 'eq' ? `#/eq/${encodeURIComponent(lastSymbol)}` : `#/${id}`;
}

function renderKeys() {
  const nav = $('#fkeys');
  nav.innerHTML = '';
  for (const [k, code, id, title] of KEYS) {
    const a = h('a', { href: hashFor(id), 'data-id': id, title: `${title} (${k})` }, h('span', { class: 'k' }, k), h('span', { class: 'c' }, code), h('span', {}, title));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(hashFor(id));
    });
    nav.append(a);
  }
}

document.addEventListener('keydown', (e) => {
  const inField = e.target.closest('input, textarea, select');
  const fk = /^F([1-9]|10)$/.exec(e.key);
  if (fk && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    navigate(hashFor(KEYS[Number(fk[1]) - 1][2]));
    return;
  }
  if (e.altKey && /^[0-9]$/.test(e.key)) {
    e.preventDefault();
    navigate(hashFor(KEYS[(Number(e.key) || 10) - 1][2]));
    return;
  }
  if (!inField && (e.key === '/' || (e.key.length === 1 && /[a-zA-Z]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey))) {
    // Start typing anywhere to use the command line, like a terminal.
    const cmd = $('#cmd');
    if (e.key === '/') e.preventDefault();
    cmd.focus();
  }
  if (e.key === 'Escape' && document.activeElement === $('#cmd')) {
    $('#cmd').value = '';
    hideSuggest();
    $('#cmd').blur();
  }
});

// ---- command line -------------------------------------------------------------------
const COMMANDS = {
  HELP: () => navigate('#/help'),
  MKT: () => navigate('#/mkt'),
  TOP: () => navigate('#/news'),
  NEWS: (a) => navigate(a[0] ? `#/news/${a[0].toLowerCase()}` : '#/news'),
  N: () => navigate('#/news'),
  ECO: () => navigate('#/eco'),
  INDO: () => navigate('#/news/indonesia'),
  IDX: () => navigate('#/eq/%5EJKSE'),
  IHSG: () => navigate('#/eq/%5EJKSE'),
  JCI: () => navigate('#/eq/%5EJKSE'),
  ECON: () => navigate('#/eco'),
  RATES: () => navigate('#/eco'),
  PORT: () => navigate('#/port'),
  PRTU: () => navigate('#/port'),
  OVLP: (a) => navigate(`#/ovlp${a.length ? '?f=' + a.join(',') : ''}`),
  PSIM: (a) => navigate(`#/psim${a.length ? '?s=' + a.join(',') : ''}`),
  FIRE: () => navigate('#/fire'),
  THEME: () => navigate('#/cfg'),
  COLORS: () => navigate('#/cfg'),
  CFG: () => navigate('#/cfg'),
  SAVE: () => navigate('#/fire'),
  WATCH: (a) => {
    if (!a.length) return navigate('#/port');
    update((d) => {
      for (const s of a) if (!d.watchlist.includes(s)) d.watchlist.push(s);
    });
    toast(`Added ${a.join(', ')} to watchlist`);
  },
};
const SUFFIX = { N: 'news', NEWS: 'news', FA: 'fundamentals', DES: 'profile', CF: 'filings', HDS: 'holdings', GP: 'chart' };

function runCommand(raw) {
  const parts = raw.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return;
  const [head, ...rest] = parts;
  if (COMMANDS[head]) return COMMANDS[head](rest);
  if (rest[0] && SUFFIX[rest[0]]) return navigate(`#/eq/${encodeURIComponent(head)}?focus=${SUFFIX[rest[0]]}`);
  if (rest[0] === 'OVLP') return navigate(`#/ovlp?f=${[head, ...rest.slice(1)].join(',')}`);
  if (/^[\^A-Z0-9][A-Z0-9.\-=^]{0,14}$/.test(head)) return navigate(`#/eq/${encodeURIComponent(head)}`);
  toast(`Unknown command: ${raw}`, true);
}

let suggestions = [];
let selIdx = -1;
let suggestTimer = null;
function hideSuggest() {
  $('#cmd-suggest').hidden = true;
  selIdx = -1;
}
function showSuggest(items) {
  suggestions = items;
  const ul = $('#cmd-suggest');
  if (!items.length) return hideSuggest();
  ul.innerHTML = items
    .map((s, i) => `<li role="option" data-i="${i}" aria-selected="${i === selIdx}"><span class="sym">${esc(s.symbol)}</span><span class="nm">${esc(s.name)}</span><span class="ex">${esc(s.exchange || s.type || '')}</span></li>`)
    .join('');
  ul.hidden = false;
}

function initCommandLine() {
  const input = $('#cmd');
  const form = $('#cmd-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const pick = selIdx >= 0 ? suggestions[selIdx] : null;
    const v = pick ? pick.cmd || pick.symbol : input.value;
    hideSuggest();
    input.value = '';
    input.blur();
    runCommand(v);
  });
  input.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = input.value.trim();
    selIdx = -1;
    if (!q || /\s/.test(q)) return hideSuggest();
    const cmdHits = Object.keys(COMMANDS)
      .filter((c) => c.startsWith(q.toUpperCase()) && c.length > 1)
      .slice(0, 3)
      .map((c) => ({ symbol: c, name: KEYS.find((k) => k[1] === c)?.[3] || 'Command', type: 'CMD', cmd: c }));
    showSuggest(cmdHits);
    suggestTimer = setTimeout(async () => {
      try {
        const { results } = await api.search(q);
        if (input.value.trim() === q) showSuggest([...cmdHits, ...results].slice(0, 12));
      } catch {
        /* ignore */
      }
    }, 160);
  });
  input.addEventListener('keydown', (e) => {
    if ($('#cmd-suggest').hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selIdx = (selIdx + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      showSuggest(suggestions);
    }
  });
  input.addEventListener('blur', () => setTimeout(hideSuggest, 150));
  $('#cmd-suggest').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    const s = suggestions[Number(li.dataset.i)];
    input.value = '';
    hideSuggest();
    runCommand(s.cmd || s.symbol);
  });
}

// ---- clocks, tape, health ----------------------------------------------------------------
function marketPhase(now = new Date()) {
  const wd = timeIn(now, 'America/New_York', { weekday: 'short' });
  const [hh, mm] = timeIn(now, 'America/New_York').split(':').map(Number);
  const mins = hh * 60 + mm;
  if (wd === 'Sat' || wd === 'Sun') return ['CLOSED', 'bad'];
  if (mins >= 570 && mins < 960) return ['OPEN', 'ok'];
  if (mins >= 240 && mins < 570) return ['PRE-MKT', 'warn'];
  if (mins >= 960 && mins < 1200) return ['AFTER-HRS', 'warn'];
  return ['CLOSED', 'bad'];
}

function tickClocks() {
  const now = new Date();
  const [phase, c] = marketPhase(now);
  $('#clocks').innerHTML = [
    ['NY', 'America/New_York'],
    ['LDN', 'Europe/London'],
    ['JKT', 'Asia/Jakarta'],
    ['TKY', 'Asia/Tokyo'],
  ]
    .map(([l, tz]) => `<span><b>${l}</b>${timeIn(now, tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>`)
    .join('') + `<span title="US equity session (holidays not shown)"><span class="dot ${c}"></span> ${phase}</span>`;
}

async function refreshTape() {
  const syms = [...TAPE, ...(state()?.watchlist || [])].slice(0, 40);
  try {
    const { quotes } = await api.quotes(syms);
    const items = syms
      .filter((s) => quotes[s])
      .map((s) => {
        const q = quotes[s];
        return `<span class="tape-item" data-s="${esc(s)}"><span class="s">${esc(shortSym(s))}</span>${price(q.price, /\.JK$|^IDR=X$/.test(s) ? 0 : undefined)} <span class="${cls(q.changePct)}">${arrow(q.changePct)}${pct(q.changePct)}</span></span>`;
      })
      .join('');
    // Duplicate the run so the CSS marquee loops seamlessly.
    $('#tape .tape-track').innerHTML = items + items;
    $('#status-updated').textContent = `Quotes ${timeIn(new Date(), displayTz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} ${tzLabel()}`;
  } catch (err) {
    setStatus(`Quote refresh failed: ${err.message}`);
  }
}

async function refreshHealth() {
  try {
    const hlt = await api.health();
    const y = hlt.providers.yahoo;
    $('#health').innerHTML = `<span class="dot ok"></span>SRV <span class="dot ${y.available ? 'ok' : 'warn'}" title="${y.available ? 'Yahoo Finance reachable' : 'Yahoo rate-limited — using fallbacks until ' + esc(y.cooldownUntil)}"></span>YHO`;
  } catch {
    $('#health').innerHTML = '<span class="dot bad"></span>SERVER OFFLINE';
  }
}

// ---- boot ----------------------------------------------------------------------------------
async function boot() {
  renderKeys();
  initCommandLine();
  tickClocks();
  setInterval(tickClocks, 1000);
  await loadState();
  applyTheme(state().settings.theme);
  setDisplayTz(state().settings.timeZone);
  $('#tape').addEventListener('click', (e) => {
    const it = e.target.closest('.tape-item');
    if (it) navigate(`#/eq/${encodeURIComponent(it.dataset.s)}`);
  });
  refreshTape();
  refreshHealth();
  setInterval(() => document.visibilityState === 'visible' && refreshTape(), 30000);
  setInterval(refreshHealth, 60000);
  window.addEventListener('hashchange', route);
  route();
}

boot();
