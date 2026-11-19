// Local JSON persistence for your positions, watchlist and saved calculator inputs.
// Data never leaves your machine: it lives in data/user/portfolio.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { normalizeSymbol } from './lib/symbols.js';

const FILE = path.join(config.userDataDir, 'portfolio.json');

const EMPTY = () => ({
  version: 1,
  positions: [],
  cash: [],
  watchlist: ['AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ', 'BTC-USD'],
  settings: {},
  saved: {},
  updatedAt: null,
});

const ASSET_CLASSES = new Set(['Equity', 'ETF', 'Fund', 'Bond', 'Crypto', 'Cash', 'Commodity', 'Other']);
const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));
const numOr = (v, d = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function sanitizeBond(b) {
  const kind = b?.kind === 'floating' ? 'floating' : 'fixed';
  const out = {
    kind,
    coupon: numOr(b?.coupon, 0),
    spread: numOr(b?.spread, 0),
    floor: kind === 'floating' ? numOr(b?.floor, numOr(b?.coupon, 0)) : null,
    freq: [1, 2, 4, 12].includes(Number(b?.freq)) ? Number(b.freq) : 12,
    maturity: ISO.test(b?.maturity || '') ? b.maturity : '',
    taxRate: Math.min(100, Math.max(0, numOr(b?.taxRate, 0))),
    tradable: !!b?.tradable,
    currency: /^[A-Z]{3}$/.test(String(b?.currency || '')) ? b.currency : 'IDR',
    reference: kind === 'floating' ? 'BI-Rate' : null,
  };
  if (numOr(b?.price, 0) > 0) out.price = numOr(b.price);
  return out;
}

export function sanitize(doc) {
  const out = EMPTY();
  if (!doc || typeof doc !== 'object') return out;
  out.positions = (Array.isArray(doc.positions) ? doc.positions : [])
    .slice(0, 2000)
    .map((p) => ({
      id: str(p.id, 64) || crypto.randomUUID(),
      symbol: normalizeSymbol(p.symbol),
      shares: numOr(p.shares, 0),
      costBasis: numOr(p.costBasis, 0), // per share/unit
      purchaseDate: /^\d{4}-\d{2}-\d{2}$/.test(p.purchaseDate || '') ? p.purchaseDate : '',
      account: str(p.account, 60) || 'Taxable',
      assetClass: ASSET_CLASSES.has(p.assetClass) ? p.assetClass : 'Equity',
      notes: str(p.notes, 500),
      ...(numOr(p.fxRate, 0) > 0 ? { fxRate: numOr(p.fxRate) } : {}),
      ...(p.bond ? { bond: sanitizeBond(p.bond) } : {}),
    }))
    .filter((p) => p.symbol && p.shares !== 0);
  out.cash = (Array.isArray(doc.cash) ? doc.cash : []).slice(0, 100).map((c) => ({
    id: str(c.id, 64) || crypto.randomUUID(),
    account: str(c.account, 60) || 'Cash',
    amount: numOr(c.amount, 0),
    apy: numOr(c.apy, 0),
    currency: /^[A-Z]{3}$/.test(String(c.currency || '')) ? c.currency : 'USD',
  }));
  out.watchlist = [...new Set((Array.isArray(doc.watchlist) ? doc.watchlist : []).map(normalizeSymbol).filter(Boolean))].slice(0, 200);
  out.settings = doc.settings && typeof doc.settings === 'object' ? JSON.parse(JSON.stringify(doc.settings)) : {};
  out.saved = doc.saved && typeof doc.saved === 'object' ? JSON.parse(JSON.stringify(doc.saved)) : {};
  return out;
}

export async function load() {
  try {
    return sanitize(JSON.parse(await fs.readFile(FILE, 'utf8')));
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY();
    throw err;
  }
}

export async function save(doc) {
  const clean = sanitize(doc);
  clean.updatedAt = new Date().toISOString();
  const json = JSON.stringify(clean, null, 2);
  if (json.length > 5e6) throw new Error('Portfolio document too large');
  await fs.mkdir(config.userDataDir, { recursive: true });
  try {
    await fs.copyFile(FILE, FILE + '.bak');
  } catch {
    /* first save */
  }
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, json, { mode: 0o600 });
  await fs.rename(tmp, FILE);
  return clean;
}
