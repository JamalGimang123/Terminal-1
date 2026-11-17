// PORT — your positions: live valuation, P&L, allocation, income, risk, lots, cash and watchlist.
import { api } from '../api.js';
import { h, panel, loading, errorBox, table, modal, toast, seg, downloadFile } from '../dom.js';
import { esc, price, pct, pctf, num, money, moneySigned, bigMoney, cls, arrow, date, signed, DASH } from '../fmt.js';
import { lineChart, hbars, HEX } from '../charts.js';
import { state, update, onChange, holdingsBySymbol, uid } from '../state.js';
import { addPositionDialog } from './equity.js';
import * as S from '../lib/stats.js';

const CLASS_COLORS = { Equity: HEX[0], ETF: HEX[2], Fund: HEX[6], Bond: HEX[3], Crypto: HEX[1], Cash: HEX[4], Commodity: HEX[5], Other: HEX[7] };

function parseCSV(text) {
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
    else if (c === ',') {
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

const ALIASES = {
  symbol: ['symbol', 'ticker', 'security', 'instrument'],
  shares: ['shares', 'quantity', 'qty', 'units', 'amount', 'sharesheld', 'position'],
  costBasis: ['costbasis', 'cost', 'avgcost', 'averagecost', 'averagecostbasis', 'avgprice', 'averageprice', 'price', 'costpershare', 'costbasispershare', 'purchaseprice', 'unitcost'],
  totalCost: ['totalcost', 'costbasistotal', 'totalcostbasis', 'basis'],
  purchaseDate: ['purchasedate', 'date', 'acquired', 'dateacquired', 'acquireddate', 'acquisitiondate', 'opendate', 'tradedate', 'datepurchased'],
  account: ['account', 'accountname', 'acct'],
  assetClass: ['assetclass', 'class', 'type'],
  notes: ['notes', 'note', 'comment'],
};

export function importRows(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one position');
  const header = rows[0].map((x) => x.toLowerCase().replace(/[^a-z]/g, ''));
  const idx = {};
  for (const [k, names] of Object.entries(ALIASES)) idx[k] = header.findIndex((x) => names.includes(x));
  if (idx.symbol < 0 || idx.shares < 0) throw new Error('CSV must have "symbol" and "shares" columns');
  const n = (v) => Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return rows.slice(1).map((r) => {
    const shares = n(r[idx.shares]);
    let cost = idx.costBasis >= 0 ? n(r[idx.costBasis]) : NaN;
    if (!Number.isFinite(cost) && idx.totalCost >= 0 && shares) cost = n(r[idx.totalCost]) / shares;
    const d = idx.purchaseDate >= 0 ? new Date(r[idx.purchaseDate]) : null;
    return {
      id: uid(),
      symbol: String(r[idx.symbol] || '').trim().toUpperCase(),
      shares,
      costBasis: Number.isFinite(cost) ? cost : 0,
      purchaseDate: d && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : '',
      account: idx.account >= 0 ? r[idx.account] || 'Taxable' : 'Taxable',
      assetClass: idx.assetClass >= 0 && r[idx.assetClass] ? r[idx.assetClass] : /-USD$/.test(String(r[idx.symbol])) ? 'Crypto' : 'Equity',
      notes: idx.notes >= 0 ? r[idx.notes] || '' : '',
    };
  }).filter((p) => p.symbol && Number.isFinite(p.shares) && p.shares !== 0);
}

function toCSV(positions) {
  const cols = ['symbol', 'shares', 'costBasis', 'purchaseDate', 'account', 'assetClass', 'notes'];
  const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [cols.join(','), ...positions.map((p) => cols.map((c) => q(p[c])).join(','))].join('\n');
}

function cashDialog(existing) {
  const f = h('form', { class: 'form' });
  f.innerHTML = `<label>Account<input class="in" name="account" value="${esc(existing?.account || 'High-yield savings')}"></label>
    <label>Balance ($)<input class="in num" name="amount" type="number" step="any" required value="${esc(existing?.amount ?? '')}"></label>
    <label>APY (%)<input class="in num" name="apy" type="number" step="any" value="${esc(existing?.apy ?? '')}"></label>
    <div class="row end" style="grid-column:1/-1"><button class="btn primary">Save</button></div>`;
  const m = modal(existing ? 'Edit cash' : 'Add cash / savings', f);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const row = { id: existing?.id || uid(), account: v.account, amount: Number(v.amount) || 0, apy: Number(v.apy) || 0 };
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
        h('button', { class: 'btn', onclick: () => fileIn.click(), title: 'CSV columns: symbol, shares, costBasis, purchaseDate, account, assetClass, notes (common broker headers are recognised)' }, 'Import CSV/JSON'),
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

    function compute() {
      const st = state();
      const hs = holdingsBySymbol(st.positions).map((x) => {
        const q = quotes[x.symbol];
        const px = q?.price ?? null;
        const mv = px != null ? px * x.shares : null;
        const ttmDiv = hist?.series?.[x.symbol]?.ttmDividends;
        const annDivPerShare = parseFloat(String(profiles[x.symbol]?.summary?.fields?.AnnualizedDividend?.value || '').replace(/[$,]/g, '')) || ttmDiv || 0;
        return {
          ...x,
          // For funds the SEC registrant is the trust (e.g. "Vanguard Index Funds"): prefer the listing name.
          name: (profiles[x.symbol]?.isFund ? q?.name : profiles[x.symbol]?.sec?.name) || q?.name || '',
          price: px,
          changePct: q?.changePct ?? null,
          dayPL: q?.change != null ? q.change * x.shares : null,
          mv,
          upl: mv != null ? mv - x.cost : null,
          uplPct: mv != null && x.cost ? (mv / x.cost - 1) * 100 : null,
          income: annDivPerShare * x.shares,
          sector: profiles[x.symbol]?.summary?.fields?.Sector?.value || (profiles[x.symbol]?.isFund ? 'Funds / ETFs' : x.assetClass === 'Crypto' ? 'Crypto' : 'Other / n.a.'),
        };
      });
      const cash = st.cash.reduce((s, c) => s + c.amount, 0);
      const cashIncome = st.cash.reduce((s, c) => s + (c.amount * (c.apy || 0)) / 100, 0);
      const invested = hs.reduce((s, x) => s + (x.mv ?? 0), 0);
      const total = invested + cash;
      hs.forEach((x) => (x.weight = total && x.mv != null ? (x.mv / total) * 100 : null));
      const cost = hs.reduce((s, x) => s + x.cost, 0);
      const dayPL = hs.reduce((s, x) => s + (x.dayPL ?? 0), 0);
      const income = hs.reduce((s, x) => s + x.income, 0) + cashIncome;
      return { hs, cash, invested, total, cost, dayPL, income, cashIncome };
    }

    function drawTiles(c) {
      const prevInvested = c.invested - c.dayPL;
      const upl = c.invested - c.cost;
      const tile = (l, v, s, hero) => `<div class="tile ${hero ? 'hero' : ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
      tiles.innerHTML = [
        tile('Total value', money(c.total, 0), `${money(c.invested, 0)} invested + ${money(c.cash, 0)} cash`, true),
        tile("Today's P&L", `<span class="${cls(c.dayPL)}">${moneySigned(c.dayPL, 0)}</span>`, `<span class="${cls(c.dayPL)}">${arrow(c.dayPL)} ${pct(prevInvested ? (c.dayPL / prevInvested) * 100 : null)}</span>`),
        tile('Unrealized P&L', `<span class="${cls(upl)}">${moneySigned(upl, 0)}</span>`, `<span class="${cls(upl)}">${pct(c.cost ? (upl / c.cost) * 100 : null)}</span> on ${money(c.cost, 0)} cost`),
        tile('Est. annual income', money(c.income, 0), `yield ${pctf(c.total ? c.income / c.total : null, 2)} · ${money(c.income / 12, 0)}/mo`),
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
        { key: 'avgCost', label: 'Avg cost', cls: 'r', fmt: (r) => price(r.avgCost) },
        { key: 'price', label: 'Last', cls: 'r b', fmt: (r) => price(r.price) },
        { key: 'changePct', label: 'Day %', cls: 'r', fmt: (r) => `<span class="${cls(r.changePct)}">${pct(r.changePct)}</span>` },
        { key: 'dayPL', label: 'Day P&L', cls: 'r', fmt: (r) => `<span class="${cls(r.dayPL)}">${moneySigned(r.dayPL, 0)}</span>` },
        { key: 'mv', label: 'Mkt value', cls: 'r b', fmt: (r) => money(r.mv, 0) },
        { key: 'weight', label: 'Weight', cls: 'r', fmt: (r) => (r.weight == null ? DASH : num(r.weight, 1) + '%') },
        { key: 'cost', label: 'Cost basis', cls: 'r', fmt: (r) => money(r.cost, 0) },
        { key: 'upl', label: 'Unrlzd P&L', cls: 'r', fmt: (r) => `<span class="${cls(r.upl)}">${moneySigned(r.upl, 0)}</span>` },
        { key: 'uplPct', label: 'Unrlzd %', cls: 'r', fmt: (r) => `<span class="${cls(r.uplPct)}">${pct(r.uplPct)}</span>` },
        { key: 'income', label: 'Est. income', cls: 'r', fmt: (r) => (r.income ? money(r.income, 0) : DASH) },
        { key: 'accounts', label: 'Accounts', cls: 'dim', fmt: (r) => esc(r.accounts.join(', ')), sort: (r) => r.accounts.join() },
      ];
      const upl = c.invested - c.cost;
      const foot = [{ html: 'TOTAL' }, {}, {}, {}, {}, {}, { cls: 'r ' + cls(c.dayPL), html: moneySigned(c.dayPL, 0) }, { cls: 'r', html: money(c.invested, 0) }, { cls: 'r', html: c.total ? num((c.invested / c.total) * 100, 1) + '%' : '' }, { cls: 'r', html: money(c.cost, 0) }, { cls: 'r ' + cls(upl), html: moneySigned(upl, 0) }, { cls: 'r ' + cls(upl), html: pct(c.cost ? (upl / c.cost) * 100 : null) }, { cls: 'r', html: money(c.income - c.cashIncome, 0) }, {}];
      holdP.body.innerHTML = '';
      holdTable = table(cols, c.hs, { sortKey: 'mv', onRow: (r) => ctx.navigate(`#/eq/${encodeURIComponent(r.symbol)}`), foot });
      holdP.body.append(holdTable);
      const src = new Set(Object.values(quotes).map((q) => q.source));
      holdP.meta.textContent = `Live quotes: ${[...src].join(', ') || DASH}`;
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
      allocClass.body.innerHTML = hbars(group('assetClass').map(([k, v]) => ({ label: k, value: (v / c.total) * 100, color: CLASS_COLORS[k] || HEX[7], sub: bigMoney(v, 1) })), { fmt: (v) => num(v, 1) + '%', labelW: 80 });
      allocSector.body.innerHTML = hbars(group('sector').map(([k, v]) => ({ label: k, value: (v / c.total) * 100, color: HEX[0], sub: bigMoney(v, 1) })), { fmt: (v) => num(v, 1) + '%', labelW: 120 });
      // accounts: split each holding's value across its lots' accounts
      const acct = new Map();
      for (const p of state().positions) {
        const q = quotes[p.symbol];
        if (q?.price != null) acct.set(p.account, (acct.get(p.account) || 0) + q.price * p.shares);
      }
      for (const cr of state().cash) acct.set(cr.account, (acct.get(cr.account) || 0) + cr.amount);
      allocAcct.body.innerHTML = hbars([...acct.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v / c.total) * 100, color: HEX[0], sub: bigMoney(v, 1) })), { fmt: (v) => num(v, 1) + '%', labelW: 110 });
      allocSector.setFoot('Sector: Nasdaq company summary; funds grouped together — see OVLP look-through for ETF contents');
    }

    function drawLots() {
      const lots = state().positions;
      if (!lots.length) {
        lotsP.body.innerHTML = '<div class="empty">No lots</div>';
        return;
      }
      const today = Date.now();
      lotsP.body.innerHTML = `<table class="t compact"><thead><tr><th>Ticker</th><th class="r">Qty</th><th class="r">Cost/sh</th><th>Acquired</th><th>Term</th><th class="r">Gain</th><th class="r">Ann. return</th><th>Account</th><th>Class</th><th>Notes</th><th></th></tr></thead><tbody>${lots
        .map((p) => {
          const q = quotes[p.symbol];
          const gain = q?.price != null ? (q.price - p.costBasis) * p.shares : null;
          const yrs = p.purchaseDate ? (today - Date.parse(p.purchaseDate)) / (365.25 * 86400e3) : null;
          const ann = yrs && yrs > 0.08 && q?.price && p.costBasis > 0 ? (q.price / p.costBasis) ** (1 / yrs) - 1 : null;
          const term = yrs == null ? DASH : yrs > 1 ? '<span class="tag live" title="Held more than one year">LONG</span>' : `<span class="tag delayed" title="Long-term in ${Math.ceil((1 - yrs) * 365)} days">SHORT</span>`;
          return `<tr data-id="${esc(p.id)}"><td class="sym">${esc(p.symbol)}</td><td class="r">${num(p.shares, p.shares % 1 ? 4 : 0)}</td><td class="r">${price(p.costBasis)}</td><td>${p.purchaseDate ? esc(date(p.purchaseDate)) : DASH}</td><td>${term}</td><td class="r ${cls(gain)}">${moneySigned(gain, 0)}</td><td class="r ${cls(ann)}">${ann == null ? DASH : pctf(ann, 1, { sign: true })}</td><td class="dim">${esc(p.account)}</td><td class="dim">${esc(p.assetClass)}</td><td class="dim nm">${esc(p.notes)}</td>
            <td class="r"><button class="btn sm" data-act="edit">Edit</button> <button class="btn sm danger" data-act="del">✕</button></td></tr>`;
        })
        .join('')}</tbody></table>`;
      lotsP.setFoot('Term: lots held > 1 year qualify for long-term capital-gains treatment in the US. Ann. return is price-only from your cost basis.');
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
            .map((r) => `<tr data-id="${esc(r.id)}"><td>${esc(r.account)}</td><td class="r b">${money(r.amount, 0)}</td><td class="r">${num(r.apy, 2)}%</td><td class="r">${money((r.amount * r.apy) / 100, 0)}</td><td class="r"><button class="btn sm" data-act="edit">Edit</button> <button class="btn sm danger" data-act="del">✕</button></td></tr>`)
            .join('')}</tbody><tfoot><tr><td>Total</td><td class="r">${money(c.cash, 0)}</td><td></td><td class="r">${money(c.cashIncome, 0)}</td><td></td></tr></tfoot></table>`
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
      drawLots();
      drawCash(c);
      drawWatch();
      return c;
    }

    // ---- performance & risk (hypothetical: current holdings held over the last year) ----
    let perfMode = 'value';
    const perfSeg = seg([{ value: 'value', label: '$ Value' }, { value: 'pct', label: '% Return' }], perfMode, (v) => {
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
      const series = Object.fromEntries([...syms, 'SPY'].filter((s) => hist.series[s]).map((s) => [s, hist.series[s]]));
      // crypto trades 7 days a week: align on dates shared with equities
      const al = S.alignSeries(series);
      if (al.dates.length < 20) {
        perfP.body.innerHTML = '<div class="empty">Not enough overlapping price history.</div>';
        return;
      }
      const shares = Object.fromEntries(hs.map((x) => [x.symbol, x.shares]));
      const value = al.dates.map((_, t) => syms.reduce((s, sym) => s + shares[sym] * al.prices[sym][t], 0));
      const spy = al.prices.SPY;
      const box = h('div');
      perfP.body.innerHTML = '';
      perfP.body.append(box);
      const x = al.dates.map((d) => Date.parse(d + 'T12:00:00Z'));
      if (perfMode === 'value') {
        lineChart(box, { x, xType: 'time', series: [{ name: 'Your holdings', values: value, color: HEX[0], area: true }, { name: 'SPY (same start value)', values: spy.map((p) => (p / spy[0]) * value[0]), color: HEX[1] }], height: 260, yFmt: (v) => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0)), tipFmt: (v) => money(v, 0), endLabels: true });
      } else {
        lineChart(box, { x, xType: 'time', series: [{ name: 'Your holdings', values: value.map((v) => (v / value[0] - 1) * 100), color: HEX[0] }, { name: 'SPY', values: spy.map((p) => (p / spy[0] - 1) * 100), color: HEX[1] }], height: 260, yFmt: (v) => v.toFixed(0) + '%', tipFmt: (v) => pct(v), zeroLine: true, endLabels: true });
      }
      perfP.setFoot(`Hypothetical: today's share counts held for the whole period (not your actual trade history) · total-return prices where available${missing.length ? ` · no history for ${esc(missing.join(', '))}` : ''}`);
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
        ['1-day VaR 95% (hist.)', `${pctf(st_.var95, 2)} · ${money(st_.var95 * total, 0)}`],
        ['1-day CVaR 95%', `${pctf(st_.cvar95, 2)} · ${money(st_.cvar95 * total, 0)}`],
        ['Concentration (eff. # holdings)', num(1 / hs.reduce((s, x) => s + ((shares[x.symbol] * (al.prices[x.symbol]?.at(-1) || 0)) / total) ** 2, 0), 1)],
      ];
      riskP.body.innerHTML = `<table class="t compact">${rows.map(([k, v, c]) => `<tr><td class="muted">${k}</td><td class="r b ${c || ''}">${v}</td></tr>`).join('')}</table>`;
      riskP.setFoot(`Daily returns · risk-free ${pctf(rf, 2)} (3M T-bill) · <a href="#/psim">full simulation ›</a>`);
    }

    async function refreshQuotes() {
      const st = state();
      const syms = [...new Set([...st.positions.map((p) => p.symbol), ...st.watchlist])];
      try {
        quotes = (await api.quotes(syms)).quotes;
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
      const [hRes, yRes, ...pRes] = await Promise.allSettled([api.history([...syms, 'SPY'], '1y'), api.yields(), ...syms.map((s) => (/[=^]|-USD$/.test(s) ? Promise.reject(new Error('n/a')) : api.profile(s)))]);
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
    const off = onChange(() => {
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
