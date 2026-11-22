// PORT — your positions: live valuation, P&L, allocation, income, risk, lots, cash and watchlist.
import { api } from '../api.js';
import { h, panel, loading, errorBox, table, modal, toast, seg, downloadFile } from '../dom.js';
import { esc, price, pct, pctf, num, cls, arrow, date, signed, DASH } from '../fmt.js';
import { baseOf, BASE_CURRENCIES, fxSymbolsFor, ratesFromQuotes, converter, factorSeries, fmtMoney, fmtMoneySigned, fmtBig, lotCostInBase, bondPricePct } from '../valuation.js';
import { bondDialog } from '../positions.js';
import * as BL from '../lib/bonds.js';
import { NAMES } from '../symbols.js';
import { lineChart, hbars, HEX } from '../charts.js';
import { state, update, onChange, holdingsBySymbol, uid } from '../state.js';
import { addPositionDialog } from './equity.js';
import * as S from '../lib/stats.js';

const CLASS_COLORS = { Equity: HEX[0], ETF: HEX[2], Fund: HEX[6], Bond: HEX[3], Crypto: HEX[1], Cash: HEX[4], Commodity: HEX[5], Other: HEX[7] };

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Excel saves ";"-separated CSV in Indonesian/European locales.
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// Header names recognised on import (lower-case, letters only). Includes common Indonesian broker headers.
export const ALIASES = {
  symbol: ['symbol', 'ticker', 'security', 'instrument', 'stock', 'kode', 'kodesaham', 'saham', 'kodeefek'],
  shares: ['shares', 'quantity', 'qty', 'units', 'amount', 'sharesheld', 'position', 'jumlahlembar', 'lembar', 'jumlahsaham'],
  lots: ['lot', 'lots', 'jumlahlot'],
  costBasis: ['costbasis', 'cost', 'avgcost', 'averagecost', 'averagecostbasis', 'avgprice', 'averageprice', 'price', 'costpershare', 'costbasispershare', 'purchaseprice', 'unitcost', 'hargaratarata', 'hargarata', 'avg', 'hargabeli'],
  totalCost: ['totalcost', 'costbasistotal', 'totalcostbasis', 'basis', 'totalbeli', 'nilaibeli'],
  purchaseDate: ['purchasedate', 'date', 'acquired', 'dateacquired', 'acquireddate', 'acquisitiondate', 'opendate', 'tradedate', 'datepurchased', 'tanggal', 'tanggalbeli'],
  account: ['account', 'accountname', 'acct', 'akun', 'rekening'],
  exchange: ['exchange', 'market', 'bursa'],
  assetClass: ['assetclass', 'class', 'type', 'jenis'],
  notes: ['notes', 'note', 'comment', 'catatan'],
  // Rupiah per 1 US dollar on the purchase date (for USD holdings measured in IDR, or IDR holdings in USD).
  fxRate: ['fxrate', 'fx', 'kurs', 'usdidr', 'usdidrrate', 'exchangerate', 'kursbeli', 'fxatpurchase', 'rateatpurchase'],
  // Bonds (optional): nominal goes in "shares", purchase price as % of nominal in "costBasis" (100 = par).
  maturity: ['maturity', 'maturitydate', 'jatuhtempo', 'tanggaljatuhtempo'],
  coupon: ['coupon', 'couponrate', 'kupon', 'tingkatkupon'],
  couponType: ['coupontype', 'bondtype', 'jeniskupon'],
  spread: ['spread', 'spreadbps'],
  floor: ['floor', 'couponfloor', 'kuponminimal'],
  frequency: ['frequency', 'freq', 'couponfrequency', 'paymentsperyear'],
  taxRate: ['taxrate', 'tax', 'pajak', 'pajakkupon'],
  tradable: ['tradable', 'tradeable'],
  currency: ['currency', 'ccy', 'matauang'],
};

// "1,234.50", "$1,234.50", "Rp 9.250" (Indonesian thousands dots), "9.250,5" -> number
export function parseNumber(v) {
  let t = String(v ?? '').replace(/rp|idr|usd|\$|\s/gi, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 9.250 or 1.234.567,89
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.'); // 58,10
  else t = t.replace(/,/g, '');
  return t === '' ? NaN : Number(t);
}

// Percentages (coupon 7.125, price 98.125, spread 1,00): a single "." or "," is always the decimal mark.
export function parseRate(v) {
  const t = String(v ?? '').replace(/%|\s/g, '');
  if (/^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return parseNumber(t);
}

// YYYY-MM-DD preferred; also DD/MM/YYYY when unambiguous (day > 12) and MM/DD/YYYY.
export function parseDate(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [day, mon] = a > 12 ? [a, b] : [b, a];
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${m[3]}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = t ? new Date(t) : null;
  return d && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : '';
}

export function importRows(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one position');
  const header = rows[0].map((x) => x.toLowerCase().replace(/[^a-z]/g, ''));
  const idx = {};
  for (const [k, names] of Object.entries(ALIASES)) idx[k] = header.findIndex((x) => names.includes(x));
  if (idx.symbol < 0 || (idx.shares < 0 && idx.lots < 0)) throw new Error('CSV must have a "symbol" column and a "shares" (or "lots") column');
  const n = parseNumber;
  return rows.slice(1).map((r) => {
    // IDX shares trade in lots of 100.
    const shares = idx.shares >= 0 ? n(r[idx.shares]) : n(r[idx.lots]) * 100;
    let cost = idx.costBasis >= 0 ? n(r[idx.costBasis]) : NaN;
    if (!Number.isFinite(cost) && idx.totalCost >= 0 && shares) cost = n(r[idx.totalCost]) / shares;
    let symbol = String(r[idx.symbol] || '').trim().toUpperCase();
    if (idx.exchange >= 0 && /^(IDX|BEI|JK|JKT|JAKARTA)$/i.test(String(r[idx.exchange] || '').trim()) && !symbol.includes('.')) symbol += '.JK';
    const cell = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const cls = cell('assetClass');
    const si = BL.sbnInfo(symbol);
    if (si) symbol = si.series;
    const isBond = /^bond$/i.test(cls) && (si || cell('maturity')) ? true : !!si;
    const fx = n(cell('fxRate'));
    const lot = {
      id: uid(),
      symbol,
      shares,
      costBasis: Number.isFinite(cost) ? cost : 0,
      purchaseDate: idx.purchaseDate >= 0 ? parseDate(r[idx.purchaseDate]) : '',
      account: idx.account >= 0 ? r[idx.account] || 'Taxable' : 'Taxable',
      assetClass: isBond ? 'Bond' : cls || (/-USD$/.test(symbol) ? 'Crypto' : 'Equity'),
      notes: idx.notes >= 0 ? r[idx.notes] || '' : '',
      ...(fx > 0 ? { fxRate: fx } : {}),
    };
    if (isBond) {
      // Bond rows: "shares" = nominal, "costBasis" = purchase price as % of nominal (100 = par).
      const paidCell = parseRate(cell('costBasis'));
      const pctPaid = Number.isFinite(paidCell) && paidCell > 0 ? paidCell : 100;
      lot.costBasis = pctPaid > 2 ? pctPaid / 100 : pctPaid;
      const known = BL.knownSeries(symbol) || {};
      const typeCell = cell('couponType').toLowerCase();
      const kind = /float|variab|mengambang/.test(typeCell) ? 'floating' : /fix|tetap/.test(typeCell) ? 'fixed' : (known.kind || si?.kind) === 'floating' ? 'floating' : 'fixed';
      const coupon = Number.isFinite(parseRate(cell('coupon'))) ? parseRate(cell('coupon')) : known.coupon ?? NaN;
      const freq = n(cell('frequency'));
      const tax = parseRate(cell('taxRate'));
      const trad = cell('tradable').toLowerCase();
      lot.bond = {
        kind,
        coupon: Number.isFinite(coupon) ? coupon : 0,
        spread: Number.isFinite(parseRate(cell('spread'))) ? parseRate(cell('spread')) : known.spread ?? 0,
        floor: kind === 'floating' ? (Number.isFinite(parseRate(cell('floor'))) ? parseRate(cell('floor')) : known.floor ?? (Number.isFinite(coupon) ? coupon : 0)) : null,
        freq: [1, 2, 4, 12].includes(freq) ? freq : si?.freq && si.freq > 0 ? si.freq : 2,
        maturity: parseDate(cell('maturity')) || known.maturity || '',
        taxRate: Number.isFinite(tax) ? tax : si ? 10 : 0,
        tradable: trad ? /^(y|yes|true|1|ya)$/.test(trad) : si ? si.tradable : true,
        currency: /^[A-Z]{3}$/i.test(cell('currency')) ? cell('currency').toUpperCase() : 'IDR',
        reference: kind === 'floating' ? 'BI-Rate' : null,
      };
    }
    return lot;
  }).filter((p) => p.symbol && Number.isFinite(p.shares) && p.shares !== 0);
}

export function toCSV(positions) {
  const hasBonds = positions.some((p) => p.bond);
  const cols = ['symbol', 'shares', 'costBasis', 'purchaseDate', 'account', 'assetClass', 'notes', 'fxRate', ...(hasBonds ? ['maturity', 'coupon', 'couponType', 'spread', 'floor', 'frequency', 'taxRate', 'tradable', 'currency'] : [])];
  const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const row = (p) => {
    const b = p.bond;
    const o = { ...p, costBasis: b ? +(p.costBasis * 100).toFixed(4) : p.costBasis, fxRate: p.fxRate ?? '' };
    if (b) Object.assign(o, { maturity: b.maturity, coupon: b.coupon, couponType: b.kind, spread: b.kind === 'floating' ? b.spread : '', floor: b.kind === 'floating' ? b.floor : '', frequency: b.freq, taxRate: b.taxRate, tradable: b.tradable ? 'yes' : 'no', currency: b.currency });
    return cols.map((c) => q(o[c])).join(',');
  };
  return [cols.join(','), ...positions.map(row)].join('\n');
}

// Help dialog: what the CSV import expects, with a downloadable example.
function csvHelp() {
  const rows = [
    ['symbol', 'Yes', 'Ticker. US: AAPL, VTI. Indonesia: add .JK (BBCA.JK). Crypto: BTC-USD. Other markets use Yahoo suffixes (7203.T, VOD.L).'],
    ['shares', 'Yes*', 'Number of shares/units you own. Indonesian stocks: total shares, not lots (5 lots = 500). *Or use a "lots" column instead (× 100).'],
    ['costBasis', 'Recommended', 'Average price you paid per share, in the currency the security trades in (rupiah for .JK, dollars for US). Or give "totalCost" instead.'],
    ['purchaseDate', 'Optional', 'YYYY-MM-DD (e.g. 2024-03-15). Used for holding period, long/short-term and annualised return.'],
    ['account', 'Optional', 'Any label: Roth IRA, Taxable, IDX Broker, … Used for the account breakdown.'],
    ['assetClass', 'Optional', 'Equity, ETF, Fund, Bond, Crypto, Commodity or Other (defaults to Equity).'],
    ['notes', 'Optional', 'Free text.'],
    ['exchange', 'Optional', 'Put IDX (or BEI) to have ".JK" added automatically to plain codes like BBCA.'],
    ['fxRate', 'Optional', 'USD/IDR on the purchase date: rupiah per 1 US dollar (e.g. 15618). With it, a US stock shown in rupiah includes the gain or loss from the rupiah weakening/strengthening. Leave blank and use “Fill missing FX rates” to look it up.'],
    ['maturity', 'Bonds', 'Bond rows only: maturity date (YYYY-MM-DD). For bonds put the nominal in "shares" and the price you paid as % of nominal in "costBasis" (100 = par).'],
    ['coupon', 'Bonds', 'Coupon % per year. For floating SBR/ST: the initial coupon (it is also the floor unless you give "floor").'],
    ['couponType / spread / floor', 'Bonds', 'couponType = fixed or floating. Floating coupon = BI-Rate + spread, never below floor (both in %).'],
    ['frequency / taxRate / tradable / currency', 'Bonds', 'Payments per year (12 = monthly, 2 = semiannual); coupon tax % (10 for SBN); yes/no; IDR or USD. Indonesian series codes fill sensible defaults.'],
  ];
  const body = h('div', {
    html: `<p class="prose" style="margin-top:0">Save a spreadsheet as <b>CSV</b> with a header row, one row per purchase (lot). Column order doesn't matter and common broker headers are recognised (Ticker, Quantity, Avg Cost, Kode Saham, Jumlah Lembar, Harga Rata-rata, Lot…).</p>
      <table class="t compact"><thead><tr><th>Column</th><th>Needed?</th><th>What to put</th></tr></thead><tbody>${rows.map(([c, n, d]) => `<tr><td class="amber b">${c}</td><td class="${n === 'Yes' || n === 'Yes*' ? 'up' : 'dim'}">${n}</td><td class="wrap">${esc(d)}</td></tr>`).join('')}</tbody></table>
      <p class="note">Numbers: plain digits are safest (9250, 245.10). “Rp 9.250” and “$1,234.50” are understood too. Commas or semicolons as separators both work. Leave cells empty when a column doesn't apply (bond columns on stock rows, fxRate on rupiah stocks when your base is IDR).</p>
      <div class="note amber" style="margin-top:8px">EXAMPLE</div>
      <pre style="background:var(--input-bg);border:1px solid var(--line-2);padding:8px;overflow:auto;font-size:11px;margin:4px 0">symbol,shares,costBasis,purchaseDate,account,assetClass,notes,fxRate,maturity,coupon,couponType,spread
VTI,25,245.10,2024-03-15,Roth IRA,ETF,US total stock market,15618,,,,
AAPL,10,172.30,2023-11-20,Taxable,Equity,,15448,,,,
BBCA.JK,500,9250,2024-02-12,IDX Broker,Equity,5 lots,,,,,
BTC-USD,0.05,42000,2024-01-19,Crypto,Crypto,,15608,,,,
FR0106,50000000,97.5,2025-03-04,Bank (SBN),Bond,,,2040-08-15,7.125,fixed,
SBR015T2,10000000,100,2026-10-28,Bank (SBN),Bond,,,2028-10-10,6.75,floating,1.00</pre>`,
  });
  body.append(h('div', { class: 'row end' }, h('a', { class: 'btn primary', href: '/examples/portfolio-example.csv', download: 'portfolio-example.csv' }, 'Download example CSV')));
  modal('CSV import format', body);
}

function cashDialog(existing) {
  const f = h('form', { class: 'form' });
  const ccy = existing?.currency || baseOf(state());
  f.innerHTML = `<label>Account<input class="in" name="account" value="${esc(existing?.account || 'Savings')}"></label>
    <label>Currency<select class="in" name="currency">${['USD', 'IDR', 'EUR', 'SGD', 'GBP', 'JPY', 'AUD'].map((c) => `<option ${c === ccy ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label>Balance<input class="in num" name="amount" type="number" step="any" required value="${esc(existing?.amount ?? '')}"></label>
    <label>APY (%)<input class="in num" name="apy" type="number" step="any" value="${esc(existing?.apy ?? '')}"></label>
    <div class="row end" style="grid-column:1/-1"><button class="btn primary">Save</button></div>`;
  const m = modal(existing ? 'Edit cash' : 'Add cash / savings', f);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const row = { id: existing?.id || uid(), account: v.account, amount: Number(v.amount) || 0, apy: Number(v.apy) || 0, currency: v.currency || 'USD' };
    update((d) => {
      const i = d.cash.findIndex((c) => c.id === row.id);
      if (i >= 0) d.cash[i] = row;
      else d.cash.push(row);
    });
    m.close();
  });
}

export default {
  id: 'port',
  title: 'My Portfolio',
  async mount(root, _p, ctx) {
    const fileIn = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files[0];
      fileIn.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
          const doc = JSON.parse(text);
          if (!Array.isArray(doc.positions)) throw new Error('JSON must contain a "positions" array');
          if (!confirm(`Replace your portfolio with ${doc.positions.length} positions from ${file.name}?`)) return;
          update((d) => {
            d.positions = doc.positions;
            d.cash = doc.cash || d.cash;
            d.watchlist = doc.watchlist || d.watchlist;
          }, { immediate: true });
        } else {
          const lots = importRows(text);
          const replace = state().positions.length && confirm(`Import ${lots.length} positions.\nOK = replace existing positions, Cancel = append.`);
          update((d) => {
            d.positions = replace ? lots : [...d.positions, ...lots];
          }, { immediate: true });
        }
        toast(`Imported ${file.name}`);
      } catch (err) {
        toast(`Import failed: ${err.message}`, true);
      }
    });
    let base = baseOf(state());
    const baseSeg = seg(BASE_CURRENCIES.map((c) => ({ value: c, label: `Base ${c}`, title: `Show totals in ${c}` })), base, (v) => {
      base = v;
      update((d) => (d.settings.baseCurrency = v));
    });
    root.append(
      fileIn,
      h(
        'div',
        { class: 'screen-title' },
        h('h1', {}, 'PORT · MY PORTFOLIO'),
        h('span', { class: 'sub' }, 'Stored locally on this machine (data/user/portfolio.json)'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: () => addPositionDialog('') }, '+ Position'),
        h('button', { class: 'btn', onclick: () => bondDialog('') }, '+ Bond'),
        h('button', { class: 'btn', onclick: () => cashDialog() }, '+ Cash'),
        h('button', { class: 'btn', title: 'Show only some positions: hide holdings, accounts or asset classes', onclick: () => focusDialog() }, 'Focus…'),
        baseSeg,
        h('button', { class: 'btn', onclick: () => fileIn.click(), title: 'CSV columns: symbol, shares, costBasis, purchaseDate, account, assetClass, notes (common broker headers are recognised)' }, 'Import CSV/JSON'),
        h('button', { class: 'btn', onclick: csvHelp, title: 'Which columns the CSV needs, with an example file' }, 'CSV format ?'),
        h('button', { class: 'btn', onclick: () => downloadFile(`finterm-positions-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(state().positions), 'text/csv') }, 'Export CSV'),
        h('button', { class: 'btn', onclick: () => downloadFile(`finterm-portfolio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state(), null, 2), 'application/json') }, 'Backup JSON'),
      ),
    );
    const tiles = h('div', { class: 'tiles', style: { marginBottom: '6px' } });
    const focusBar = h('div', { class: 'focusbar', hidden: true });
    const grid = h('div', { class: 'grid' });
    root.append(tiles, focusBar, grid);
    const P = (title, c, opts) => {
      const p = panel({ title, ...opts });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const holdP = P('Holdings', 'c12', { bodyCls: 'flush scroll' });
    // "Hide" buttons sit inside clickable rows: handle them before the row opens the security.
    holdP.body.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('[data-hide]');
        if (!btn) return;
        e.stopPropagation();
        hideSymbol(btn.dataset.hide);
      },
      true,
    );
    const perfP = P('Current Holdings — 1Y Value vs S&P 500', 'c8');
    const riskP = P('Risk (1Y, current weights)', 'c4', { bodyCls: 'flush' });
    const allocHold = P('Allocation · Holdings', 'c3');
    const allocClass = P('Allocation · Asset Class', 'c3');
    const allocSector = P('Allocation · Sector', 'c3');
    const allocAcct = P('Allocation · Account', 'c3');
    const bondsP = P('Bonds & Fixed Income', 'c12', { bodyCls: 'flush scroll' });
    bondsP.el.hidden = true;
    const lotsP = P('Tax Lots', 'c8', { bodyCls: 'flush scroll h420' });
    lotsP.meta.append(h('button', { class: 'btn sm', title: 'Look up the USD/IDR rate on each purchase date (ECB reference rate) for lots that have a date but no rate', onclick: () => fillMissingFx() }, 'Fill missing FX rates'));
    const cashP = P('Cash & Savings', 'c4', { bodyCls: 'flush' });
    const watchP = P('Watchlist', 'c12', { bodyCls: 'flush' });

    let quotes = {};
    let hist = null;
    let profiles = {};
    let rf = 0.04;
    let rates = { USD: 1 };
    let fxWarned = '';
    const M = (v, d = 0) => fmtMoney(v, base, d);
    const MS = (v, d = 0) => fmtMoneySigned(v, base, d);
    const MB = (v) => fmtBig(v, base, 1);
    // Summary tiles: compact for large amounts (Rp 369.73M) so they fit; exact values stay in the tables.
    const MT = (v) => (Math.abs(v) >= (base === 'IDR' ? 1e6 : 1e7) ? fmtBig(v, base, 2) : M(v));
    const MTS = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + MT(Math.abs(v));
    // Focus: hidden holdings (by symbol) and cash accounts (by id) are left out of everything on this page.
    const hiddenOf = (st = state()) => ({ symbols: new Set(st.settings.hidden?.symbols || []), cash: new Set(st.settings.hidden?.cash || []) });
    const visPos = (st = state()) => {
      const hd = hiddenOf(st).symbols;
      return st.positions.filter((p) => !hd.has(p.symbol));
    };
    const visCash = (st = state()) => {
      const hd = hiddenOf(st).cash;
      return st.cash.filter((c) => !hd.has(c.id));
    };
    function setHidden(symbols, cash) {
      update((d) => {
        const all = new Set(d.positions.map((p) => p.symbol));
        const ids = new Set(d.cash.map((c) => c.id));
        d.settings.hidden = { symbols: [...new Set(symbols)].filter((x) => all.has(x)).sort(), cash: [...new Set(cash)].filter((x) => ids.has(x)) };
      });
    }
    const hideSymbol = (sym) => {
      const hd = hiddenOf();
      setHidden([...hd.symbols, sym], [...hd.cash]);
      toast(`${sym} hidden — click it in the focus bar to bring it back`);
    };
    function drawFocusBar() {
      const st = state();
      const hd = hiddenOf(st);
      const syms = [...hd.symbols].filter((x) => st.positions.some((p) => p.symbol === x));
      const cash = st.cash.filter((c) => hd.cash.has(c.id));
      focusBar.hidden = !syms.length && !cash.length;
      if (focusBar.hidden) return;
      focusBar.innerHTML = '';
      focusBar.append(
        h('span', { class: 'amber b' }, 'FOCUS'),
        h('span', { class: 'muted' }, `${syms.length + cash.length} hidden — totals, charts, allocation and lots below leave them out:`),
        ...syms.map((x) => h('button', { class: 'chip', title: `Show ${x} again`, onclick: () => setHidden(syms.filter((y) => y !== x), [...hd.cash]) }, x, h('span', { class: 'muted' }, '+'))),
        ...cash.map((c) => h('button', { class: 'chip', title: `Show ${c.account} again`, onclick: () => setHidden(syms, [...hd.cash].filter((y) => y !== c.id)) }, `Cash: ${c.account}`, h('span', { class: 'muted' }, '+'))),
        h('button', { class: 'btn sm', onclick: () => setHidden([], []) }, 'Show all'),
        h('button', { class: 'btn sm', onclick: () => focusDialog() }, 'Edit…'),
      );
    }
    // Checklist of everything, with quick "only this account / class" filters.
    function focusDialog() {
      const st = state();
      const hd = hiddenOf(st);
      const hs = holdingsBySymbol(st.positions);
      const f = h('div');
      const box = (key, label, on, sub) => h('label', { class: 'row', style: { gap: '6px', padding: '2px 0' } }, h('input', { type: 'checkbox', 'data-k': key, checked: on }), h('span', { class: 'sym' }, label), sub ? h('span', { class: 'muted' }, sub) : null);
      const accounts = [...new Set([...st.positions.map((p) => p.account), ...st.cash.map((c) => c.account)])].sort();
      const classes = [...new Set(st.positions.map((p) => p.assetClass))].sort();
      const set = (pred) => f.querySelectorAll('input[data-k]').forEach((i) => (i.checked = pred(i.dataset.k)));
      const accountOf = (k) => (k.startsWith('cash:') ? [st.cash.find((c) => `cash:${c.id}` === k)?.account] : st.positions.filter((p) => p.symbol === k).map((p) => p.account));
      const classOf = (k) => (k.startsWith('cash:') ? ['Cash'] : st.positions.filter((p) => p.symbol === k).map((p) => p.assetClass));
      f.append(
        h('p', { class: 'note', style: { marginTop: 0 } }, 'Ticked items are shown. Hidden ones stay saved — they are just left out of this page (FIRE, PSIM and OVLP still use everything).'),
        h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '4px' } }, h('span', { class: 'muted' }, 'Only account:'), ...accounts.map((a) => h('button', { class: 'btn sm', onclick: () => set((k) => accountOf(k).includes(a)) }, a))),
        h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '4px', marginTop: '4px' } }, h('span', { class: 'muted' }, 'Only class:'), ...[...classes, ...(st.cash.length ? ['Cash'] : [])].map((c) => h('button', { class: 'btn sm', onclick: () => set((k) => classOf(k).includes(c)) }, c)), h('button', { class: 'btn sm', onclick: () => set(() => true) }, 'All'), h('button', { class: 'btn sm', onclick: () => set(() => false) }, 'None')),
        h('div', { style: { columns: '2 160px', marginTop: '8px' } },
          ...hs.map((x) => box(x.symbol, x.symbol, !hd.symbols.has(x.symbol), x.accounts.join(', '))),
          ...st.cash.map((c) => box(`cash:${c.id}`, `Cash: ${c.account}`, !hd.cash.has(c.id), c.currency)),
        ),
      );
      const m = modal('Focus — choose what to show', f);
      f.append(h('div', { class: 'row end', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: () => {
        const off = [...f.querySelectorAll('input[data-k]')].filter((i) => !i.checked).map((i) => i.dataset.k);
        setHidden(off.filter((k) => !k.startsWith('cash:')), off.filter((k) => k.startsWith('cash:')).map((k) => k.slice(5)));
        m.close();
      } }, 'Apply')));
    }

    let pheiRows = {}; // series -> PHEI fair price row
    let biHistory = []; // [{date, rate}] Bank Indonesia decisions
    const bondOf = (sym) => state().positions.find((p) => p.symbol === sym && p.bond)?.bond || null;
    const ccyOf = (sym) => bondOf(sym)?.currency || quotes[sym]?.currency || (/\.JK$/.test(sym) ? 'IDR' : 'USD');
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const nativeTag = (sym) => (ccyOf(sym) !== base ? ` <span class="muted">${esc(ccyOf(sym))}</span>` : '');

    function compute() {
      const st = state();
      const conv = converter(rates, base);
      const missingFx = new Set();
      const hs = holdingsBySymbol(visPos(st)).map((x) => {
        const ccy = ccyOf(x.symbol);
        const bond = x.lots.find((l) => l.bond)?.bond || null;
        // Cost in the base currency: historical when the purchase-date exchange rate is known.
        let cost = 0;
        let costHistorical = true;
        for (const lot of x.lots) {
          const lc = lotCostInBase(lot, ccy, base, conv);
          cost += lc.cost ?? 0;
          costHistorical &&= lc.historical;
        }
        let px;
        let prevPx;
        let name;
        let income;
        let sector;
        let bondInfo = null;
        if (bond) {
          // Bonds: price is % of nominal; income is the coupon after tax.
          const bp = bondPricePct(bond, pheiRows[x.symbol]);
          px = bp.price / 100;
          prevPx = bp.prev / 100;
          const si = BL.sbnInfo(x.symbol);
          bondInfo = { ...BL.bondSnapshot(bond, { face: x.shares, asOf: todayISO(), refHistory: biHistory, cleanPrice: bond.tradable && bp.source !== 'nominal' ? bp.price : null }), priceSource: bp.source };
          name = si ? `${si.name}${si.sharia ? ' (sukuk)' : ''}` : 'Bond';
          income = conv(bondInfo.annualIncomeNet, ccy) ?? 0;
          sector = si ? 'Government bonds (Indonesia)' : 'Bonds';
        } else {
          const q = quotes[x.symbol];
          px = q?.price ?? null;
          prevPx = q?.prevClose ?? (q?.change != null && px != null ? px - q.change : null);
          const ttmDiv = hist?.series?.[x.symbol]?.ttmDividends;
          const annDivPerShare = parseFloat(String(profiles[x.symbol]?.summary?.fields?.AnnualizedDividend?.value || '').replace(/[$,]/g, '')) || ttmDiv || 0;
          // For funds the SEC registrant is the trust (e.g. "Vanguard Index Funds"): prefer the listing name.
          name = (profiles[x.symbol]?.isFund ? q?.name : profiles[x.symbol]?.sec?.name) || NAMES[x.symbol] || (q?.name && q.name !== x.symbol ? q.name : '') || '';
          income = conv(annDivPerShare * x.shares, ccy) ?? 0;
          sector = profiles[x.symbol]?.summary?.fields?.Sector?.value || (profiles[x.symbol]?.isFund ? 'Funds / ETFs' : x.assetClass === 'Crypto' ? 'Crypto' : /\.JK$/.test(x.symbol) ? 'Indonesia (IDX)' : 'Other / n.a.');
        }
        const mvNative = px != null ? px * x.shares : null;
        const mv = conv(mvNative, ccy);
        if (mvNative != null && mv == null) missingFx.add(ccy);
        const upl = mv != null ? mv - cost : null;
        // Split P&L: price move valued at today's FX, the rest is the currency effect.
        const pricePL = mvNative != null ? conv(mvNative - x.cost, ccy) : null;
        const fxPL = upl != null && pricePL != null && ccy !== base && costHistorical ? upl - pricePL : null;
        return {
          ...x,
          ccy,
          bond,
          bondInfo,
          name,
          price: px,
          changePct: px != null && prevPx ? (px / prevPx - 1) * 100 : null,
          dayPL: px != null && prevPx != null ? conv((px - prevPx) * x.shares, ccy) : null,
          mv,
          cost,
          costHistorical,
          upl,
          pricePL,
          fxPL,
          uplPct: upl != null && cost ? (upl / cost) * 100 : null,
          income,
          sector,
        };
      });
      const cash = visCash(st).reduce((s, c) => s + (conv(c.amount, c.currency || 'USD') ?? 0), 0);
      const cashIncome = visCash(st).reduce((s, c) => s + (conv((c.amount * (c.apy || 0)) / 100, c.currency || 'USD') ?? 0), 0);
      const fxKey = [...missingFx].join(',');
      if (fxKey && fxKey !== fxWarned) toast(`No exchange rate yet for ${fxKey} — those holdings are left out of totals`, true);
      fxWarned = fxKey;
      const invested = hs.reduce((s, x) => s + (x.mv ?? 0), 0);
      const total = invested + cash;
      hs.forEach((x) => (x.weight = total && x.mv != null ? (x.mv / total) * 100 : null));
      const cost = hs.reduce((s, x) => s + x.cost, 0);
      const dayPL = hs.reduce((s, x) => s + (x.dayPL ?? 0), 0);
      const income = hs.reduce((s, x) => s + x.income, 0) + cashIncome;
      return { hs, cash, invested, total, cost, dayPL, income, cashIncome, conv };
    }

    function drawTiles(c) {
      const prevInvested = c.invested - c.dayPL;
      const upl = c.invested - c.cost;
      const tile = (l, v, s, hero) => `<div class="tile ${hero ? 'hero' : ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
      tiles.innerHTML = [
        tile(`Total value (${base})${focusBar.hidden ? '' : ' · focus'}`, `<span title="${M(c.total)}">${MT(c.total)}</span>`, `${MT(c.invested)} invested + ${MT(c.cash)} cash`, true),
        tile("Today's P&L", `<span class="${cls(c.dayPL)}" title="${MS(c.dayPL)}">${MTS(c.dayPL)}</span>`, `<span class="${cls(c.dayPL)}">${arrow(c.dayPL)} ${pct(prevInvested ? (c.dayPL / prevInvested) * 100 : null)}</span>`),
        tile('Unrealized P&L', `<span class="${cls(upl)}" title="${MS(upl)}">${MTS(upl)}</span>`, (() => {
          const fx = c.hs.reduce((s, x) => s + (x.fxPL ?? 0), 0);
          return fx
            ? `<span class="${cls(upl)}" title="on ${MT(c.cost)} cost">${pct(c.cost ? (upl / c.cost) * 100 : null)}</span> · <span class="${cls(fx)}" title="Part of the P&L from exchange-rate moves since purchase">FX ${MTS(fx)}</span>`
            : `<span class="${cls(upl)}">${pct(c.cost ? (upl / c.cost) * 100 : null)}</span> on ${MT(c.cost)}`;
        })()),
        tile('Est. annual income', `<span title="${M(c.income)}">${MT(c.income)}</span>`, `yield ${pctf(c.total ? c.income / c.total : null, 2)} · ${MT(c.income / 12)}/mo`),
        tile('Positions', String(c.hs.length), `${visPos().length} lots · ${new Set(visPos().map((p) => p.account)).size} accounts${focusBar.hidden ? '' : ` · ${hiddenOf().symbols.size} hidden`}`),
        tile('Largest position', c.hs.length ? esc([...c.hs].sort((a, b) => (b.mv || 0) - (a.mv || 0))[0].symbol) : DASH, c.hs.length ? `${num(Math.max(...c.hs.map((x) => x.weight || 0)), 1)}% of portfolio` : ''),
      ].join('');
    }

    let holdTable = null;
    function drawHoldings(c) {
      if (!c.hs.length) {
        holdP.body.innerHTML = state().positions.length ? '<div class="empty">Every holding is hidden — use <b>Show all</b> in the focus bar.</div>' : '<div class="empty">No positions yet. Click <b>+ Position</b>, type <kbd>AAPL</kbd> and use “+ Position” on its page, or import a CSV from your broker.</div>';
        holdTable = null;
        return;
      }
      const showFx = c.hs.some((x) => x.ccy !== base);
      const cols = [
        { key: 'symbol', label: 'Ticker', cls: 'sym', fmt: (r) => esc(r.symbol) },
        { key: 'name', label: 'Name', cls: 'nm', fmt: (r) => esc(r.name) },
        { key: 'shares', label: 'Qty / nominal', cls: 'r', fmt: (r) => (r.bond ? fmtMoney(r.shares, r.ccy, 0) : num(r.shares, r.shares % 1 ? 4 : 0)) },
        { key: 'avgCost', label: 'Avg cost', cls: 'r', fmt: (r) => (r.bond ? num(r.avgCost * 100, 2) + '%' : price(r.avgCost, r.ccy === 'IDR' ? 0 : undefined) + nativeTag(r.symbol)), title: 'In the currency the security trades in (bonds: % of nominal)' },
        { key: 'price', label: 'Last', cls: 'r b', fmt: (r) => (r.bond ? `${num((r.price ?? 1) * 100, 2)}%` : price(r.price, r.ccy === 'IDR' ? 0 : undefined) + nativeTag(r.symbol)) },
        { key: 'changePct', label: 'Day %', cls: 'r', fmt: (r) => `<span class="${cls(r.changePct)}">${pct(r.changePct)}</span>` },
        { key: 'dayPL', label: 'Day P&L', cls: 'r', fmt: (r) => `<span class="${cls(r.dayPL)}">${MS(r.dayPL)}</span>` },
        { key: 'mv', label: `Value ${base}`, cls: 'r b', fmt: (r) => M(r.mv) },
        { key: 'weight', label: 'Weight', cls: 'r', fmt: (r) => (r.weight == null ? DASH : num(r.weight, 1) + '%') },
        { key: 'cost', label: `Cost ${base}`, cls: 'r', fmt: (r) => M(r.cost) + (r.ccy !== base && !r.costHistorical ? ' <span class="warn" title="No purchase-date exchange rate on some lots: converted at today\'s rate, so currency gains/losses are not counted. Use “Fill missing FX rates” in Tax Lots.">*</span>' : ''), title: 'Uses the exchange rate on each purchase date when recorded' },
        { key: 'upl', label: 'Unrlzd P&L', cls: 'r', fmt: (r) => `<span class="${cls(r.upl)}">${MS(r.upl)}</span>` },
        { key: 'uplPct', label: 'Unrlzd %', cls: 'r', fmt: (r) => `<span class="${cls(r.uplPct)}">${pct(r.uplPct)}</span>`, title: `Total return in ${base}, including currency moves` },
        ...(showFx ? [
          { key: 'pricePL', label: 'Price P&L', cls: 'r', fmt: (r) => `<span class="${cls(r.pricePL)}">${MS(r.pricePL)}</span>`, title: "Gain from the security's price, at today's exchange rate" },
          { key: 'fxPL', label: 'FX P&L', cls: 'r', fmt: (r) => (r.fxPL == null ? `<span class="muted">${r.ccy === base ? '—' : 'n/a'}</span>` : `<span class="${cls(r.fxPL)}">${MS(r.fxPL)}</span>`), title: 'Gain or loss from the exchange rate since purchase (needs the purchase-date rate)' },
        ] : []),
        { key: 'income', label: 'Est. income', cls: 'r', fmt: (r) => (r.income ? M(r.income) : DASH) },
        { key: 'accounts', label: 'Accounts', cls: 'dim', fmt: (r) => esc(r.accounts.join(', ')), sort: (r) => r.accounts.join() },
        { key: 'hide', label: '', nosort: true, cls: 'r', fmt: (r) => `<button class="btn sm" data-hide="${esc(r.symbol)}" title="Hide ${esc(r.symbol)} from this page (focus on the rest)">Hide</button>` },
      ];
      const upl = c.invested - c.cost;
      const sumPrice = c.hs.reduce((s, x) => s + (x.pricePL ?? 0), 0);
      const sumFx = c.hs.reduce((s, x) => s + (x.fxPL ?? 0), 0);
      const foot = [{ html: 'TOTAL' }, {}, {}, {}, {}, {}, { cls: 'r ' + cls(c.dayPL), html: MS(c.dayPL) }, { cls: 'r', html: M(c.invested) }, { cls: 'r', html: c.total ? num((c.invested / c.total) * 100, 1) + '%' : '' }, { cls: 'r', html: M(c.cost) }, { cls: 'r ' + cls(upl), html: MS(upl) }, { cls: 'r ' + cls(upl), html: pct(c.cost ? (upl / c.cost) * 100 : null) }, ...(showFx ? [{ cls: 'r ' + cls(sumPrice), html: MS(sumPrice) }, { cls: 'r ' + cls(sumFx), html: MS(sumFx) }] : []), { cls: 'r', html: M(c.income - c.cashIncome) }, {}, {}];
      holdP.body.innerHTML = '';
      holdTable = table(cols, c.hs, { sortKey: 'mv', onRow: (r) => ctx.navigate(r.bond ? `#/bond?q=${encodeURIComponent(r.symbol)}` : `#/eq/${encodeURIComponent(r.symbol)}`), foot });
      holdP.body.append(holdTable);
      const src = new Set(Object.values(quotes).map((q) => q.source));
      const fxNote = Object.keys(rates).filter((k) => k !== 'USD').map((k) => `USD/${k} ${num(rates[k], k === 'IDR' ? 0 : 4)}`).join(' · ');
      holdP.meta.textContent = `Live quotes: ${[...src].join(', ') || DASH}${fxNote ? ` · FX ${fxNote}` : ''}`;
    }

    function drawAlloc(c) {
      const top = [...c.hs].filter((x) => x.mv).sort((a, b) => b.mv - a.mv);
      const holdingItems = top.slice(0, 11).map((x) => ({ label: x.symbol, value: x.weight, color: CLASS_COLORS[x.assetClass] || HEX[0] }));
      const rest = top.slice(11).reduce((s, x) => s + (x.weight || 0), 0);
      if (rest > 0) holdingItems.push({ label: `Other (${top.length - 11})`, value: rest, color: 'var(--muted)' });
      if (c.cash > 0) holdingItems.push({ label: 'Cash', value: (c.cash / c.total) * 100, color: CLASS_COLORS.Cash });
      allocHold.body.innerHTML = hbars(holdingItems, { fmt: (v) => num(v, 1) + '%', labelW: 80 });
      const group = (key) => {
        const m = new Map();
        for (const x of c.hs) if (x.mv) m.set(x[key], (m.get(x[key]) || 0) + x.mv);
        if (c.cash > 0) m.set(key === 'accounts' ? 'Cash accounts' : 'Cash', (m.get('Cash') || 0) + c.cash);
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
      };
      allocClass.body.innerHTML = hbars(group('assetClass').map(([k, v]) => ({ label: k, value: (v / c.total) * 100, color: CLASS_COLORS[k] || HEX[7], sub: MB(v) })), { fmt: (v) => num(v, 1) + '%', labelW: 80 });
      allocSector.body.innerHTML = hbars(group('sector').map(([k, v]) => ({ label: k, value: (v / c.total) * 100, color: HEX[0], sub: MB(v) })), { fmt: (v) => num(v, 1) + '%', labelW: 120 });
      // accounts: split each holding's value across its lots' accounts
      const acct = new Map();
      for (const p of visPos()) {
        const q = quotes[p.symbol];
        const unit = p.bond ? bondPricePct(p.bond, pheiRows[p.symbol]).price / 100 : q?.price;
        const v = unit != null ? c.conv(unit * p.shares, ccyOf(p.symbol)) : null;
        if (v != null) acct.set(p.account, (acct.get(p.account) || 0) + v);
      }
      for (const cr of visCash()) acct.set(cr.account, (acct.get(cr.account) || 0) + (c.conv(cr.amount, cr.currency || 'USD') ?? 0));
      allocAcct.body.innerHTML = hbars([...acct.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v / c.total) * 100, color: HEX[0], sub: MB(v) })), { fmt: (v) => num(v, 1) + '%', labelW: 110 });
      allocSector.setFoot('Sector: Nasdaq company summary; funds grouped together — see OVLP look-through for ETF contents');
    }

    function drawLots(c) {
      const lots = visPos();
      if (!lots.length) {
        lotsP.body.innerHTML = '<div class="empty">No lots</div>';
        return;
      }
      const today = Date.now();
      lotsP.body.innerHTML = `<table class="t compact"><thead><tr><th>Ticker</th><th class="r">Qty</th><th class="r">Cost/sh</th><th>Acquired</th><th class="r" title="Rupiah per 1 US dollar on the purchase date">USD/IDR @ buy</th><th>Term</th><th class="r">Gain ${base}</th><th class="r">Ann. return</th><th>Account</th><th>Class</th><th>Notes</th><th></th></tr></thead><tbody>${lots
        .map((p) => {
          const q = quotes[p.symbol];
          const ccy = ccyOf(p.symbol);
          const unit = p.bond ? bondPricePct(p.bond, pheiRows[p.symbol]).price / 100 : q?.price;
          const lc = lotCostInBase(p, ccy, base, c.conv);
          const valueBase = unit != null ? c.conv(unit * p.shares, ccy) : null;
          const gain = valueBase != null && lc.cost != null ? valueBase - lc.cost : null;
          const yrs = p.purchaseDate ? (today - Date.parse(p.purchaseDate)) / (365.25 * 86400e3) : null;
          const ann = yrs && yrs > 0.08 && unit && p.costBasis > 0 && !p.bond ? (unit / p.costBasis) ** (1 / yrs) - 1 : null;
          const term = yrs == null ? DASH : yrs > 1 ? '<span class="tag live" title="Held more than one year">LONG</span>' : `<span class="tag delayed" title="Long-term in ${Math.ceil((1 - yrs) * 365)} days">SHORT</span>`;
          const fxCell = ccy === 'USD' || ccy === 'IDR' ? (p.fxRate ? num(p.fxRate, 0) : `<span class="muted" title="Not recorded — Edit the lot or use “Fill missing FX rates”">—</span>`) : '<span class="muted">n/a</span>';
          const costCell = p.bond ? `${num(p.costBasis * 100, 2)}%` : `${price(p.costBasis, ccy === 'IDR' ? 0 : undefined)}${nativeTag(p.symbol)}`;
          const qty = p.bond ? fmtMoney(p.shares, ccy, 0) : num(p.shares, p.shares % 1 ? 4 : 0);
          return `<tr data-id="${esc(p.id)}"><td class="sym">${esc(p.symbol)}</td><td class="r">${qty}</td><td class="r">${costCell}</td><td>${p.purchaseDate ? esc(date(p.purchaseDate)) : DASH}</td><td class="r">${fxCell}</td><td>${term}</td><td class="r ${cls(gain)}">${MS(gain)}</td><td class="r ${cls(ann)}">${ann == null ? DASH : pctf(ann, 1, { sign: true })}</td><td class="dim">${esc(p.account)}</td><td class="dim">${esc(p.assetClass)}</td><td class="dim nm" style="max-width:130px" title="${esc(p.notes)}">${esc(p.notes)}</td>
            <td class="r"><button class="btn sm" data-act="edit">Edit</button> <button class="btn sm danger" data-act="del">✕</button></td></tr>`;
        })
        .join('')}</tbody></table>`;
      lotsP.setFoot('Cost per share is in the currency the security trades in (bonds: % of nominal). USD/IDR @ buy = the rate when you bought; with it, gains in rupiah include the currency move. Term: US long-term capital-gains treatment after 1 year.');
    }
    lotsP.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      const lot = state().positions.find((p) => p.id === id);
      if (!lot) return;
      if (btn.dataset.act === 'edit') addPositionDialog(lot.symbol, lot);
      else if (confirm(`Delete lot: ${lot.shares} ${lot.symbol}?`)) update((d) => (d.positions = d.positions.filter((p) => p.id !== id)));
    });

    function drawCash(c) {
      const rows = visCash();
      cashP.body.innerHTML = rows.length
        ? `<table class="t compact"><thead><tr><th>Account</th><th class="r">Balance</th><th class="r">APY</th><th class="r">Interest/yr</th><th></th></tr></thead><tbody>${rows
            .map((r) => `<tr data-id="${esc(r.id)}"><td>${esc(r.account)}</td><td class="r b">${fmtMoney(r.amount, r.currency || 'USD', 0)}</td><td class="r">${num(r.apy, 2)}%</td><td class="r">${fmtMoney((r.amount * r.apy) / 100, r.currency || 'USD', 0)}</td><td class="r"><button class="btn sm" data-act="hide" title="Hide from this page">Hide</button> <button class="btn sm" data-act="edit">Edit</button> <button class="btn sm danger" data-act="del">✕</button></td></tr>`)
            .join('')}</tbody><tfoot><tr><td>Total (${base})</td><td class="r">${M(c.cash)}</td><td></td><td class="r">${M(c.cashIncome)}</td><td></td></tr></tfoot></table>`
        : state().cash.length ? '<div class="empty">All cash accounts are hidden (see the focus bar).</div>' : '<div class="empty">No cash accounts — use “+ Cash” to track savings, money market or checking balances.</div>';
    }
    cashP.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      const row = state().cash.find((x) => x.id === id);
      if (btn.dataset.act === 'hide') {
        const hd = hiddenOf();
        return setHidden([...hd.symbols], [...hd.cash, id]);
      }
      if (btn.dataset.act === 'edit') cashDialog(row);
      else if (confirm(`Delete ${row.account}?`)) update((d) => (d.cash = d.cash.filter((x) => x.id !== id)));
    });

    function drawWatch() {
      const wl = state().watchlist;
      const input = h('input', { class: 'in', placeholder: 'add symbols, e.g. TSLA, VTI', style: { width: '220px' } });
      const add = () => {
        const syms = input.value.toUpperCase().split(/[\s,]+/).filter(Boolean);
        if (!syms.length) return;
        update((d) => (d.watchlist = [...new Set([...d.watchlist, ...syms])]));
        refreshQuotes();
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
      watchP.meta.innerHTML = '';
      watchP.meta.append(input, h('button', { class: 'btn sm', onclick: add }, 'Add'));
      watchP.body.innerHTML = wl.length
        ? `<table class="t compact"><thead><tr><th>Ticker</th><th>Name</th><th class="r">Last</th><th class="r">Chg</th><th class="r">%Chg</th><th class="r">Source</th><th></th></tr></thead><tbody>${wl
            .map((s) => {
              const q = quotes[s];
              return `<tr class="click" data-sym="${esc(s)}"><td class="sym">${esc(s)}</td><td class="nm">${esc(q?.name || '')}</td><td class="r b">${price(q?.price)}</td><td class="r ${cls(q?.change)}">${q ? signed(q.change, q.price >= 1 ? 2 : 4) : DASH}</td><td class="r ${cls(q?.changePct)}">${arrow(q?.changePct)} ${pct(q?.changePct)}</td><td class="r muted">${esc(q?.source || '')}</td><td class="r"><button class="btn sm danger" data-rm="${esc(s)}">✕</button></td></tr>`;
            })
            .join('')}</tbody></table>`
        : '<div class="empty">Watchlist is empty</div>';
    }
    watchP.body.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        update((d) => (d.watchlist = d.watchlist.filter((s) => s !== rm.dataset.rm)));
        return;
      }
      const tr = e.target.closest('[data-sym]');
      if (tr) ctx.navigate(`#/eq/${encodeURIComponent(tr.dataset.sym)}`);
    });

    // Bond prices (PHEI) and BI-Rate history, loaded once per visit alongside the quotes.
    let bondData = null;
    function loadBondData() {
      if (bondData || !state().positions.some((p) => p.bond)) return;
      bondData = Promise.allSettled([api.phei(), api.indonesiaMacro()]).then(([ph, im]) => {
        if (ph.status === 'fulfilled') pheiRows = Object.fromEntries(ph.value.series.map((r) => [r.series, r]));
        if (im.status === 'fulfilled' && im.value.biRate) biHistory = im.value.biRate.decisions;
        drawAll();
      });
    }

    async function fillMissingFx() {
      const todo = state().positions.filter((p) => p.purchaseDate && !p.fxRate && ['USD', 'IDR'].includes(ccyOf(p.symbol)));
      if (!todo.length) return toast('Every USD/IDR lot with a purchase date already has a rate');
      const got = {};
      for (const d of [...new Set(todo.map((p) => p.purchaseDate))]) {
        try {
          got[d] = (await api.fxOn(d, 'USD', 'IDR')).rate;
        } catch {
          /* skip dates without a rate */
        }
      }
      const n = todo.filter((p) => got[p.purchaseDate]).length;
      update((d) => {
        for (const p of d.positions) if (!p.fxRate && got[p.purchaseDate] && todo.some((t) => t.id === p.id)) p.fxRate = got[p.purchaseDate];
      });
      toast(`Added purchase-date USD/IDR rates to ${n} lot${n === 1 ? '' : 's'} (ECB reference rates — edit a lot to use your bank's exact rate)`);
    }

    function drawBonds(c) {
      const bonds = c.hs.filter((x) => x.bond);
      bondsP.el.hidden = !bonds.length;
      if (!bonds.length) return;
      const asOf = todayISO();
      bondsP.body.innerHTML = `<table class="t compact"><thead><tr><th>Series</th><th>Type</th><th class="r">Nominal</th><th class="r">Price</th><th class="r">Value ${base}</th><th class="r">Coupon now</th><th class="r">Net income / yr</th><th>Next payment</th><th>Maturity</th><th class="r">Years left</th><th class="r" title="Estimated from the coupon schedule since your purchase date, after tax">Coupons received</th><th class="r">YTM</th><th class="r" title="Modified duration">Dur.</th><th></th></tr></thead><tbody>${bonds
        .map((x) => {
          const b = x.bond;
          const bi = x.bondInfo;
          const from = x.lots.map((l) => l.purchaseDate).filter(Boolean).sort()[0];
          const rec = from ? BL.couponsReceived(b, { face: x.shares, from, asOf, refHistory: biHistory }) : null;
          const cpnDetail = b.kind === 'floating' ? `BI-Rate ${num(BL.rateOn(biHistory, asOf), 2)}% + ${num(b.spread, 2)}%, floor ${num(b.floor ?? b.coupon, 2)}%` : 'fixed';
          const si = BL.sbnInfo(x.symbol);
          return `<tr data-sym="${esc(x.symbol)}"><td class="sym">${esc(x.symbol)}</td><td class="dim">${esc(si?.type || 'Bond')} · ${b.tradable ? 'tradable' : 'non-tradable'}</td><td class="r">${fmtMoney(x.shares, x.ccy, 0)}</td>
            <td class="r" title="${esc(bi.priceSource)}">${num(bi.price, 2)}%</td><td class="r b">${M(x.mv)}</td>
            <td class="r" title="${esc(cpnDetail)}"><b class="amber">${num(bi.coupon, 2)}%</b> <span class="muted">${b.kind === 'floating' ? 'float' : ''}</span></td>
            <td class="r">${fmtMoney(bi.annualIncomeNet, x.ccy, 0)}</td>
            <td>${bi.nextCoupon ? `${esc(date(bi.nextCoupon))} <span class="muted">${fmtMoney(bi.perPaymentNet, x.ccy, 0)}</span>` : 'matured'}</td>
            <td>${esc(date(b.maturity))}</td><td class="r">${num(bi.yearsToMaturity, 2)}</td>
            <td class="r">${rec ? `${fmtMoney(rec.net, x.ccy, 0)} <span class="muted">(${rec.count})</span>` : '<span class="muted" title="Add a purchase date">—</span>'}</td>
            <td class="r">${bi.ytm != null ? num(bi.ytm, 2) + '%' : DASH}</td><td class="r">${bi.duration != null ? num(bi.duration, 2) : DASH}</td>
            <td class="r"><button class="btn sm" data-edit="${esc(x.lots[0].id)}">Edit</button></td></tr>`;
        })
        .join('')}</tbody></table>`;
      bondsP.setFoot(`Floating coupons (SBR/ST) = BI-Rate + spread, never below the floor, using Bank Indonesia's decisions${biHistory.length ? ` (latest ${num(biHistory[0].rate, 2)}% on ${esc(date(biHistory[0].date))})` : ''}. Non-tradable bonds are valued at nominal; tradable series at PHEI's fair price when listed. Income and coupons received are after the coupon tax and are estimates.`);
    }
    bondsP.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-edit]');
      if (btn) {
        const lot = state().positions.find((p) => p.id === btn.dataset.edit);
        if (lot) bondDialog(lot.symbol, lot);
        return;
      }
      const tr = e.target.closest('[data-sym]');
      if (tr) ctx.navigate(`#/bond?q=${encodeURIComponent(tr.dataset.sym)}`);
    });

    function drawAll() {
      drawFocusBar();
      const c = compute();
      drawBonds(c);
      drawTiles(c);
      drawHoldings(c);
      drawAlloc(c);
      drawLots(c);
      drawCash(c);
      drawWatch();
      return c;
    }

    // ---- performance & risk (hypothetical: current holdings held over the last year) ----
    let perfMode = 'value';
    const perfSeg = seg([{ value: 'value', label: 'Value' }, { value: 'pct', label: '% Return' }], perfMode, (v) => {
      perfMode = v;
      drawPerf();
    });
    perfP.meta.append(perfSeg);
    function drawPerf() {
      const hs = holdingsBySymbol(visPos());
      if (!hs.length || !hist) {
        perfP.body.innerHTML = '<div class="empty">Add positions to see how your current holdings performed over the past year.</div>';
        riskP.body.innerHTML = '<div class="empty">—</div>';
        return;
      }
      const bondHs = hs.filter((x) => x.lots.some((l) => l.bond));
      const syms = hs.filter((x) => !bondHs.includes(x)).map((x) => x.symbol).filter((s) => hist.series[s]);
      const missing = hs.filter((x) => !bondHs.includes(x)).map((x) => x.symbol).filter((s) => !hist.series[s]);
      const fxSyms = Object.keys(hist.series).filter((k) => /^[A-Z]{3}=X$/.test(k));
      const series = Object.fromEntries([...syms, 'SPY', ...fxSyms].filter((s) => hist.series[s]).map((s) => [s, hist.series[s]]));
      // crypto trades 7 days a week, IDX and US holidays differ: align on shared dates
      const al = S.alignSeries(series);
      if (al.dates.length < 20) {
        perfP.body.innerHTML = '<div class="empty">Not enough overlapping price history.</div>';
        return;
      }
      const n = al.dates.length;
      const fxPrices = Object.fromEntries(fxSyms.map((k) => [k, al.prices[k]]));
      const factor = {};
      for (const sym of [...syms, 'SPY']) factor[sym] = factorSeries(ccyOf(sym), base, fxPrices, n);
      const usable = syms.filter((sym) => factor[sym]);
      const shares = Object.fromEntries(hs.map((x) => [x.symbol, x.shares]));
      // Portfolio value in the base currency, including exchange-rate moves.
      // Bonds have no daily price history here: held at today's value (in their currency), so only FX moves them.
      const bondConst = bondHs.map((x) => ({ v: (x.shares * bondPricePct(bondOf(x.symbol), pheiRows[x.symbol]).price) / 100, f: factorSeries(ccyOf(x.symbol), base, fxPrices, n) })).filter((b) => b.f);
      const value = al.dates.map((_, t) => usable.reduce((s, sym) => s + shares[sym] * al.prices[sym][t] * factor[sym][t], 0) + bondConst.reduce((s, b) => s + b.v * b.f[t], 0));
      const spy = al.prices.SPY.map((p, t) => p * (factor.SPY ? factor.SPY[t] : 1));
      missing.push(...syms.filter((sym) => !factor[sym]));
      const box = h('div');
      perfP.body.innerHTML = '';
      perfP.body.append(box);
      const x = al.dates.map((d) => Date.parse(d + 'T12:00:00Z'));
      if (perfMode === 'value') {
        lineChart(box, { x, xType: 'time', series: [{ name: 'Your holdings', values: value, color: HEX[0], area: true }, { name: 'SPY (same start value)', values: spy.map((p) => (p / spy[0]) * value[0]), color: HEX[1] }], height: 260, yFmt: (v) => fmtBig(v, base, 2), tipFmt: (v) => M(v), endLabels: true });
      } else {
        lineChart(box, { x, xType: 'time', series: [{ name: 'Your holdings', values: value.map((v) => (v / value[0] - 1) * 100), color: HEX[0] }, { name: 'SPY', values: spy.map((p) => (p / spy[0] - 1) * 100), color: HEX[1] }], height: 260, yFmt: (v) => v.toFixed(0) + '%', tipFmt: (v) => pct(v), zeroLine: true, endLabels: true });
      }
      perfP.setFoot(`Hypothetical: today's share counts held for the whole period (not your actual trade history) · in ${base}${fxSyms.length ? ' incl. currency moves' : ''} · total-return prices where available${bondHs.length ? ' · bonds at constant value (coupons not included)' : ''}${missing.length ? ` · not included: ${esc(missing.join(', '))}` : ''}`);
      const pr = S.toReturns(value);
      const br = S.toReturns(spy);
      const st_ = S.returnStats(pr, { rf, benchmark: br });
      const total = value.at(-1);
      const rows = [
        ['1Y return', pctf(st_.totalReturn, 2, { sign: true }), cls(st_.totalReturn)],
        ['SPY 1Y return', pctf(spy.at(-1) / spy[0] - 1, 2, { sign: true }), cls(spy.at(-1) / spy[0] - 1)],
        ['Volatility (ann.)', pctf(st_.volatility, 1)],
        ['Sharpe ratio', num(st_.sharpe, 2)],
        ['Sortino ratio', num(st_.sortino, 2)],
        ['Beta vs SPY', num(st_.beta, 2)],
        ['Correlation vs SPY', num(st_.correlation, 2)],
        ["Jensen's alpha (ann.)", pctf(st_.alpha, 2, { sign: true }), cls(st_.alpha)],
        ['Max drawdown', pctf(st_.maxDrawdown, 1), 'down'],
        ['1-day VaR 95% (hist.)', `${pctf(st_.var95, 2)} · ${M(st_.var95 * total)}`],
        ['1-day CVaR 95%', `${pctf(st_.cvar95, 2)} · ${M(st_.cvar95 * total)}`],
        ['Concentration (eff. # holdings)', num(1 / (usable.reduce((s, sym) => s + ((shares[sym] * al.prices[sym].at(-1) * factor[sym][n - 1]) / total) ** 2, 0) + bondConst.reduce((s, b) => s + ((b.v * b.f[n - 1]) / total) ** 2, 0)), 1)],
      ];
      riskP.body.innerHTML = `<table class="t compact">${rows.map(([k, v, c]) => `<tr><td class="muted">${k}</td><td class="r b ${c || ''}">${v}</td></tr>`).join('')}</table>`;
      riskP.setFoot(`Daily returns in ${base} · risk-free ${pctf(rf, 2)} (US 3M T-bill) · <a href="#/psim">full simulation ›</a>`);
    }

    async function refreshQuotes() {
      const st = state();
      const syms = [...new Set([...st.positions.filter((p) => !p.bond).map((p) => p.symbol), ...st.watchlist])];
      loadBondData();
      try {
        quotes = (await api.quotes(syms)).quotes;
        const fx = fxSymbolsFor([...st.positions.map((p) => ccyOf(p.symbol)), ...st.cash.map((c) => c.currency || 'USD')], base);
        rates = fx.length ? ratesFromQuotes((await api.quotes(fx)).quotes) : { USD: 1 };
        if (ctx.alive) drawAll();
      } catch (err) {
        errorBox(holdP.body, err);
      }
    }
    async function refreshSlow() {
      const st = state();
      const syms = [...new Set(st.positions.filter((p) => !p.bond).map((p) => p.symbol))];
      if (!syms.length && !st.positions.length) {
        hist = null;
        drawPerf();
        return;
      }
      loading(perfP.body);
      const fx = fxSymbolsFor([...syms.map(ccyOf), ...st.positions.filter((p) => p.bond).map((p) => ccyOf(p.symbol))], base);
      const [hRes, yRes, ...pRes] = await Promise.allSettled([api.history([...syms, 'SPY', ...fx], '1y'), api.yields(), ...syms.map((s) => (/[=^]|-USD$|\.[A-Z]{1,4}$/.test(s) ? Promise.reject(new Error('n/a')) : api.profile(s)))]);
      hist = hRes.status === 'fulfilled' ? hRes.value : null;
      if (yRes.status === 'fulfilled') rf = (yRes.value.latest.yields['3 Mo'] ?? 4) / 100;
      pRes.forEach((r, i) => {
        if (r.status === 'fulfilled') profiles[syms[i]] = r.value;
      });
      if (!ctx.alive) return;
      drawAll();
      if (hist) drawPerf();
      else errorBox(perfP.body, hRes.reason);
    }

    loading(holdP.body);
    drawAll();
    await refreshQuotes();
    refreshSlow();
    let slowTimer = null;
    const off = onChange((d) => {
      base = baseOf(d);
      drawAll();
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => {
        refreshQuotes();
        refreshSlow();
      }, 600);
    });
    ctx.onDestroy(off);
    ctx.every(15000, refreshQuotes);
  },
};
