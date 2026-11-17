// Personal data (positions, watchlist, saved calculator inputs).
// Persisted on the local server (data/user/portfolio.json) with a localStorage mirror.
import { api } from './api.js';
import { toast } from './dom.js';

const LS_KEY = 'finterm.portfolio.v1';
let doc = null;
const listeners = new Set();
let saveTimer = null;

function lsGet() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch {
    return null;
  }
}
function lsSet(v) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export async function loadState() {
  try {
    doc = await api.portfolio();
    const local = lsGet();
    // First run on the server but data exists in this browser: restore it.
    if (!doc.updatedAt && local && (local.positions?.length || local.cash?.length)) {
      doc = await api.savePortfolio(local);
      toast('Restored portfolio from browser backup');
    }
  } catch {
    doc = lsGet() || { positions: [], cash: [], watchlist: ['AAPL', 'MSFT', 'SPY'], settings: {}, saved: {} };
    toast('Server storage unavailable — using browser storage', true);
  }
  doc.saved ||= {};
  doc.settings ||= {};
  lsSet(doc);
  return doc;
}

export const state = () => doc;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(mutator, { immediate = false } = {}) {
  mutator(doc);
  lsSet(doc);
  listeners.forEach((fn) => fn(doc));
  clearTimeout(saveTimer);
  const doSave = async () => {
    try {
      const saved = await api.savePortfolio(doc);
      doc.updatedAt = saved.updatedAt;
      lsSet(doc);
    } catch (err) {
      toast(`Could not save to server: ${err.message} (kept in browser)`, true);
    }
  };
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 400);
}

export function saveInputs(key, values) {
  update((d) => {
    d.saved[key] = values;
  });
}
export const savedInputs = (key) => doc?.saved?.[key];

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

// Aggregate lots into holdings by symbol.
export function holdingsBySymbol(positions) {
  const m = new Map();
  for (const p of positions) {
    const e = m.get(p.symbol) || { symbol: p.symbol, shares: 0, cost: 0, lots: [], accounts: new Set(), assetClass: p.assetClass };
    e.shares += p.shares;
    e.cost += p.shares * p.costBasis;
    e.lots.push(p);
    e.accounts.add(p.account);
    m.set(p.symbol, e);
  }
  return [...m.values()].map((e) => ({ ...e, avgCost: e.shares ? e.cost / e.shares : 0, accounts: [...e.accounts] }));
}
