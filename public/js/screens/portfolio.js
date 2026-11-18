// PORT — your positions: live valuation, P&L, allocation, income, risk, lots, cash and watchlist.
import { api } from '../api.js';
import { h, panel, loading, errorBox, table, modal, toast, seg, downloadFile } from '../dom.js';
import { esc, price, pct, pctf, num, cls, arrow, date, signed, DASH } from '../fmt.js';
import { baseOf, BASE_CURRENCIES, fxSymbolsFor, ratesFromQuotes, converter, factorSeries, fmtMoney, fmtMoneySigned, fmtBig } from '../valuation.js';
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
};

// "1,234.50", "$1,234.50", "Rp 9.250" (Indonesian thousands dots), "9.250,5" -> number
export function parseNumber(v) {
  let t = String(v ?? '').replace(/rp|idr|usd|\$|\s/gi, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 9.250 or 1.234.567,89
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.'); // 58,10
  else t = t.replace(/,/g, '');
  return t === '' ? NaN : Number(t);
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
    return {
      id: uid(),
      symbol,
      shares,
      costBasis: Number.isFinite(cost) ? cost : 0,
      purchaseDate: idx.purchaseDate >= 0 ? parseDate(r[idx.purchaseDate]) : '',
      account: idx.account >= 0 ? r[idx.account] || 'Taxable' : 'Taxable',
      assetClass: idx.assetClass >= 0 && r[idx.assetClass] ? r[idx.assetClass].trim() : /-USD$/.test(symbol) ? 'Crypto' : 'Equity',
      notes: idx.notes >= 0 ? r[idx.notes] || '' : '',
    };
  }).filter((p) => p.symbol && Number.isFinite(p.shares) && p.shares !== 0);
}

function toCSV(positions) {
  const cols = ['symbol', 'shares', 'costBasis', 'purchaseDate', 'account', 'assetClass', 'notes'];
  const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [cols.join(','), ...positions.map((p) => cols.map((c) => q(p[c])).join(','))].join('\n');
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
  ];
  const body = h('div', {
    html: `<p class="prose" style="margin-top:0">Save a spreadsheet as <b>CSV</b> with a header row, one row per purchase (lot). Column order doesn't matter and common broker headers are recognised (Ticker, Quantity, Avg Cost, Kode Saham, Jumlah Lembar, Harga Rata-rata, Lot…).</p>
      <table class="t compact"><thead><tr><th>Column</th><th>Needed?</th><th>What to put</th></tr></thead><tbody>${rows.map(([c, n, d]) => `<tr><td class="amber b">${c}</td><td class="${n === 'Yes' || n === 'Yes*' ? 'up' : 'dim'}">${n}</td><td class="wrap">${esc(d)}</td></tr>`).join('')}</tbody></table>
      <p class="note">Numbers: plain digits are safest (9250, 245.10). “Rp 9.250” and “$1,234.50” are understood too. Commas or semicolons as separators both work.</p>
      <div class="note amber" style="margin-top:8px">EXAMPLE</div>
      <pre style="background:var(--input-bg);border:1px solid var(--line-2);padding:8px;overflow:auto;font-size:11px;margin:4px 0">symbol,shares,costBasis,purchaseDate,account,assetClass,notes
VTI,25,245.10,2024-03-15,Roth IRA,ETF,US total stock market fund
AAPL,10,172.30,2023-11-20,Taxable,Equity,
BBCA.JK,500,9250,2024-02-12,IDX Broker,Equity,Bank Central Asia (5 lots)
TLKM.JK,1000,3900,2023-09-01,IDX Broker,Equity,
BTC-USD,0.05,42000,2024-01-20,Crypto,Crypto,</pre>`,
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
        h('button', { class: 'btn', onclick: () => cashDialog() }, '+ Cash'),
        baseSeg,
        h('button', { class: 'btn', onclick: () => fileIn.click(), title: 'CSV columns: symbol, shares, costBasis, purchaseDate, account, assetClass, notes (common broker headers are recognised)' }, 'Import CSV/JSON'),
        h('button', { class: 'btn', onclick: csvHelp, title: 'Which columns the CSV needs, with an example file' }, 'CSV format ?'),
        h('button', { class: 'btn', onclick: () => downloadFile(`finterm-positions-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(state().positions), 'text/csv') }, 'Export CSV'),
        h('button', { class: 'btn', onclick: () => downloadFile(`finterm-portfolio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state(), null, 2), 'application/json') }, 'Backup JSON'),
      ),
    );
    const tiles = h('div', { class: 'tiles', style: { marginBottom: '6px' } });
    const grid = h('div', { class: 'grid' });
    root.append(tiles, grid);
    const P = (title, c, opts) => {
      const p = panel({ title, ...opts });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const holdP = P('Holdings', 'c12', { bodyCls: 'flush scroll' });
    const perfP = P('Current Holdings — 1Y Value vs S&P 500', 'c8');
    const riskP = P('Risk (1Y, current weights)', 'c4', { bodyCls: 'flush' });
    const allocHold = P('Allocation · Holdings', 'c3');
    const allocClass = P('Allocation · Asset Class', 'c3');
    const allocSector = P('Allocation · Sector', 'c3');
    const allocAcct = P('Allocation · Account', 'c3');
    const lotsP = P('Tax Lots', 'c8', { bodyCls: 'flush scroll h420' });
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
    const MT = (v) => (Math.abs(v) >= 1e7 ? fmtBig(v, base, 2) : M(v));
    const MTS = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + MT(Math.abs(v));
    const ccyOf = (sym) => quotes[sym]?.currency || (/\.JK$/.test(sym) ? 'IDR' : 'USD');
    const nativeTag = (sym) => (ccyOf(sym) !== base ? ` <span class="muted">${esc(ccyOf(sym))}</span>` : '');

    function compute() {
      const st = state();
      const conv = converter(rates, base);
      const missingFx = new Set();
      const hs = holdingsBySymbol(st.positions).map((x) => {
        const q = quotes[x.symbol];
        const ccy = ccyOf(x.symbol);
        const px = q?.price ?? null;
        const mvNative = px != null ? px * x.shares : null;
        const mv = conv(mvNative, ccy);
        if (mvNative != null && mv == null) missingFx.add(ccy);
        const cost = conv(x.cost, ccy);
        const ttmDiv = hist?.series?.[x.symbol]?.ttmDividends;
        const annDivPerShare = parseFloat(String(profiles[x.symbol]?.summary?.fields?.AnnualizedDividend?.value || '').replace(/[$,]/g, '')) || ttmDiv || 0;
        return {
          ...x,
          ccy,
          // For funds the SEC registrant is the trust (e.g. "Vanguard Index Funds"): prefer the listing name.
          name: (profiles[x.symbol]?.isFund ? q?.name : profiles[x.symbol]?.sec?.name) || NAMES[x.symbol] || (q?.name && q.name !== x.symbol ? q.name : '') || '',
          price: px,
          changePct: q?.changePct ?? null,
          dayPL: q?.change != null ? conv(q.change * x.shares, ccy) : null,
          mv,
          cost: cost ?? 0,
          upl: mv != null && cost != null ? mv - cost : null,
          uplPct: mvNative != null && x.cost ? (mvNative / x.cost - 1) * 100 : null,
          income: conv(annDivPerShare * x.shares, ccy) ?? 0,
          sector: profiles[x.symbol]?.summary?.fields?.Sector?.value || (profiles[x.symbol]?.isFund ? 'Funds / ETFs' : x.assetClass === 'Crypto' ? 'Crypto' : /\.JK$/.test(x.symbol) ? 'Indonesia (IDX)' : 'Other / n.a.'),
        };
      });
      const cash = st.cash.reduce((s, c) => s + (conv(c.amount, c.currency || 'USD') ?? 0), 0);
      const cashIncome = st.cash.reduce((s, c) => s + (conv((c.amount * (c.apy || 0)) / 100, c.currency || 'USD') ?? 0), 0);
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
        tile(`Total value (${base})`, `<span title="${M(c.total)}">${MT(c.total)}</span>`, `${MT(c.invested)} invested + ${MT(c.cash)} cash`, true),
        tile("Today's P&L", `<span class="${cls(c.dayPL)}" title="${MS(c.dayPL)}">${MTS(c.dayPL)}</span>`, `<span class="${cls(c.dayPL)}">${arrow(c.dayPL)} ${pct(prevInvested ? (c.dayPL / prevInvested) * 100 : null)}</span>`),
        tile('Unrealized P&L', `<span class="${cls(upl)}" title="${MS(upl)}">${MTS(upl)}</span>`, `<span class="${cls(upl)}">${pct(c.cost ? (upl / c.cost) * 100 : null)}</span> on ${MT(c.cost)} cost`),
        tile('Est. annual income', `<span title="${M(c.income)}">${MT(c.income)}</span>`, `yield ${pctf(c.total ? c.income / c.total : null, 2)} · ${MT(c.income / 12)}/mo`),
        tile('Positions', String(c.hs.length), `${state().positions.length} lots · ${new Set(state().positions.map((p) => p.account)).size} accounts`),
        tile('Largest position', c.hs.length ? esc([...c.hs].sort((a, b) => (b.mv || 0) - (a.mv || 0))[0].symbol) : DASH, c.hs.length ? `${num(Math.max(...c.hs.map((x) => x.weight || 0)), 1)}% of portfolio` : ''),
      ].join('');
    }

    let holdTable = null;
    function drawHoldings(c) {
      if (!c.hs.length) {
        holdP.body.innerHTML = '<div class="empty">No positions yet. Click <b>+ Position</b>, type <kbd>AAPL</kbd> and use “+ Position” on its page, or import a CSV from your broker.</div>';
        holdTable = null;
        return;
      }
      const cols = [
        { key: 'symbol', label: 'Ticker', cls: 'sym', fmt: (r) => esc(r.symbol) },
        { key: 'name', label: 'Name', cls: 'nm', fmt: (r) => esc(r.name) },
        { key: 'shares', label: 'Qty', cls: 'r', fmt: (r) => num(r.shares, r.shares % 1 ? 4 : 0) },
        { key: 'avgCost', label: 'Avg cost', cls: 'r', fmt: (r) => price(r.avgCost, r.ccy === 'IDR' ? 0 : undefined) + nativeTag(r.symbol), title: 'In the currency the security trades in' },
        { key: 'price', label: 'Last', cls: 'r b', fmt: (r) => price(r.price, r.ccy === 'IDR' ? 0 : undefined) + nativeTag(r.symbol) },
        { key: 'changePct', label: 'Day %', cls: 'r', fmt: (r) => `<span class="${cls(r.changePct)}">${pct(r.changePct)}</span>` },
        { key: 'dayPL', label: 'Day P&L', cls: 'r', fmt: (r) => `<span class="${cls(r.dayPL)}">${MS(r.dayPL)}</span>` },
        { key: 'mv', label: `Value ${base}`, cls: 'r b', fmt: (r) => M(r.mv) },
        { key: 'weight', label: 'Weight', cls: 'r', fmt: (r) => (r.weight == null ? DASH : num(r.weight, 1) + '%') },
        { key: 'cost', label: `Cost ${base}`, cls: 'r', fmt: (r) => M(r.cost), title: "Cost converted at today's exchange rate" },
        { key: 'upl', label: 'Unrlzd P&L', cls: 'r', fmt: (r) => `<span class="${cls(r.upl)}">${MS(r.upl)}</span>` },
        { key: 'uplPct', label: 'Unrlzd %', cls: 'r', fmt: (r) => `<span class="${cls(r.uplPct)}">${pct(r.uplPct)}</span>`, title: 'Price return in the trading currency' },
        { key: 'income', label: 'Est. income', cls: 'r', fmt: (r) => (r.income ? M(r.income) : DASH) },
        { key: 'accounts', label: 'Accounts', cls: 'dim', fmt: (r) => esc(r.accounts.join(', ')), sort: (r) => r.accounts.join() },
      ];
      const upl = c.invested - c.cost;
      const foot = [{ html: 'TOTAL' }, {}, {}, {}, {}, {}, { cls: 'r ' + cls(c.dayPL), html: MS(c.dayPL) }, { cls: 'r', html: M(c.invested) }, { cls: 'r', html: c.total ? num((c.invested / c.total) * 100, 1) + '%' : '' }, { cls: 'r', html: M(c.cost) }, { cls: 'r ' + cls(upl), html: MS(upl) }, { cls: 'r ' + cls(upl), html: pct(c.cost ? (upl / c.cost) * 100 : null) }, { cls: 'r', html: M(c.income - c.cashIncome) }, {}];
      holdP.body.innerHTML = '';
      holdTable = table(cols, c.hs, { sortKey: 'mv', onRow: (r) => ctx.navigate(`#/eq/${encodeURIComponent(r.symbol)}`), foot });
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
      for (const p of state().positions) {
        const q = quotes[p.symbol];
        const v = q?.price != null ? c.conv(q.price * p.shares, ccyOf(p.symbol)) : null;
        if (v != null) acct.set(p.account, (acct.get(p.account) || 0) + v);
      }
      for (const cr of state().cash) acct.set(cr.account, (acct.get(cr.account) || 0) + (c.conv(cr.amount, cr.currency || 'USD') ?? 0));
      allocAcct.body.innerHTML = hbars([...acct.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v / c.total) * 100, color: HEX[0], sub: MB(v) })), { fmt: (v) => num(v, 1) + '%', labelW: 110 });
      allocSector.setFoot('Sector: Nasdaq company summary; funds grouped together — see OVLP look-through for ETF contents');
    }

    function drawLots(c) {
      const lots = state().positions;
      if (!lots.length) {
        lotsP.body.innerHTML = '<div class="empty">No lots</div>';
        return;
      }
      const today = Date.now();
      lotsP.body.innerHTML = `<table class="t compact"><thead><tr><th>Ticker</th><th class="r">Qty</th><th class="r">Cost/sh</th><th>Acquired</th><th>Term</th><th class="r">Gain ${base}</th><th class="r">Ann. return</th><th>Account</th><th>Class</th><th>Notes</th><th></th></tr></thead><tbody>${lots
        .map((p) => {
          const q = quotes[p.symbol];
          const gain = q?.price != null ? c.conv((q.price - p.costBasis) * p.shares, ccyOf(p.symbol)) : null;
          const yrs = p.purchaseDate ? (today - Date.parse(p.purchaseDate)) / (365.25 * 86400e3) : null;
          const ann = yrs && yrs > 0.08 && q?.price && p.costBasis > 0 ? (q.price / p.costBasis) ** (1 / yrs) - 1 : null;
          const term = yrs == null ? DASH : yrs > 1 ? '<span class="tag live" title="Held more than one year">LONG</span>' : `<span class="tag delayed" title="Long-term in ${Math.ceil((1 - yrs) * 365)} days">SHORT</span>`;
          return `<tr data-id="${esc(p.id)}"><td class="sym">${esc(p.symbol)}</td><td class="r">${num(p.shares, p.shares % 1 ? 4 : 0)}</td><td class="r">${price(p.costBasis, ccyOf(p.symbol) === 'IDR' ? 0 : undefined)}${nativeTag(p.symbol)}</td><td>${p.purchaseDate ? esc(date(p.purchaseDate)) : DASH}</td><td>${term}</td><td class="r ${cls(gain)}">${MS(gain)}</td><td class="r ${cls(ann)}">${ann == null ? DASH : pctf(ann, 1, { sign: true })}</td><td class="dim">${esc(p.account)}</td><td class="dim">${esc(p.assetClass)}</td><td class="dim nm">${esc(p.notes)}</td>
            <td class="r"><button class="btn sm" data-act="edit">Edit</button> <button class="btn sm danger" data-act="del">✕</button></td></tr>`;
        })
        .join('')}</tbody></table>`;
      lotsP.setFoot('Cost per share is in the currency the security trades in (rupiah for .JK). Term: US long-term capital-gains treatment after 1 year. Ann. return is price-only from your cost basis.');
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
      const rows = state().cash;
      cashP.body.innerHTML = rows.length
        ? `<table class="t compact"><thead><tr><th>Account</th><th class="r">Balance</th><th class="r">APY</th><th class="r">Interest/yr</th><th></th></tr></thead><tbody>${rows
            .map((r) => `<tr data-id="${esc(r.id)}"><td>${esc(r.account)}</td><td class="r b">${fmtMoney(r.amount, r.currency || 'USD', 0)}</td><td class="r">${num(r.apy, 2)}%</td><td class="r">${fmtMoney((r.amount * r.apy) / 100, r.currency || 'USD', 0)}</td><td class="r"><button class="btn sm" data-act="edit">Edit</button> <button class="btn sm danger" data-act="del">✕</button></td></tr>`)
            .join('')}</tbody><tfoot><tr><td>Total (${base})</td><td class="r">${M(c.cash)}</td><td></td><td class="r">${M(c.cashIncome)}</td><td></td></tr></tfoot></table>`
        : '<div class="empty">No cash accounts — use “+ Cash” to track savings, money market or checking balances.</div>';
    }
    cashP.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      const row = state().cash.find((x) => x.id === id);
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

    function drawAll() {
      const c = compute();
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
      const st = state();
      const hs = holdingsBySymbol(st.positions);
      if (!hs.length || !hist) {
        perfP.body.innerHTML = '<div class="empty">Add positions to see how your current holdings performed over the past year.</div>';
        riskP.body.innerHTML = '<div class="empty">—</div>';
        return;
      }
      const syms = hs.map((x) => x.symbol).filter((s) => hist.series[s]);
      const missing = hs.map((x) => x.symbol).filter((s) => !hist.series[s]);
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
      const value = al.dates.map((_, t) => usable.reduce((s, sym) => s + shares[sym] * al.prices[sym][t] * factor[sym][t], 0));
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
      perfP.setFoot(`Hypothetical: today's share counts held for the whole period (not your actual trade history) · in ${base}${fxSyms.length ? ' incl. currency moves' : ''} · total-return prices where available${missing.length ? ` · not included: ${esc(missing.join(', '))}` : ''}`);
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
        ['Concentration (eff. # holdings)', num(1 / usable.reduce((s, sym) => s + ((shares[sym] * al.prices[sym].at(-1) * factor[sym][n - 1]) / total) ** 2, 0), 1)],
      ];
      riskP.body.innerHTML = `<table class="t compact">${rows.map(([k, v, c]) => `<tr><td class="muted">${k}</td><td class="r b ${c || ''}">${v}</td></tr>`).join('')}</table>`;
      riskP.setFoot(`Daily returns in ${base} · risk-free ${pctf(rf, 2)} (US 3M T-bill) · <a href="#/psim">full simulation ›</a>`);
    }

    async function refreshQuotes() {
      const st = state();
      const syms = [...new Set([...st.positions.map((p) => p.symbol), ...st.watchlist])];
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
      const syms = [...new Set(st.positions.map((p) => p.symbol))];
      if (!syms.length) {
        hist = null;
        drawPerf();
        return;
      }
      loading(perfP.body);
      const fx = fxSymbolsFor(syms.map(ccyOf), base);
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
