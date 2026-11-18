// EQ — security detail: quote, chart, key stats, performance & risk, fundamentals, filings, holdings, news.
import { api } from '../api.js';
import { h, panel, loading, errorBox, seg, modal, toast, setStatus } from '../dom.js';
import { esc, price, pct, pctf, signed, cls, arrow, big, bigMoney, num, int, money, date, hhmm, safeUrl, decimalsFor, tzLabel, DASH } from '../fmt.js';
import { priceChart, columnChart, hbars, HEX } from '../charts.js';
import { state, update, uid } from '../state.js';
import { nameOf, isIndexLike, NAMES } from '../symbols.js';
import { newsList, rangeBar } from './common.js';
import * as S from '../lib/stats.js';

const ITEMS_8K = {
  '1.01': 'Material agreement', '1.02': 'Agreement terminated', '1.03': 'Bankruptcy', '2.01': 'Acquisition/disposition', '2.02': 'Results of operations',
  '2.03': 'New obligation', '2.05': 'Exit costs', '2.06': 'Impairment', '3.01': 'Listing notice', '3.02': 'Unregistered equity sale', '3.03': 'Security holder rights',
  '4.01': 'Auditor change', '4.02': 'Non-reliance on financials', '5.01': 'Change in control', '5.02': 'Officer/director change', '5.03': 'Bylaws amendment',
  '5.07': 'Shareholder vote', '7.01': 'Reg FD disclosure', '8.01': 'Other events', '9.01': 'Exhibits',
};
const describeItems = (items) => String(items || '').split(',').map((i) => ITEMS_8K[i.trim()]).filter(Boolean).filter((d) => d !== 'Exhibits').join(' · ');

const RANGES = [
  ['1d', '1D'], ['5d', '5D'], ['1mo', '1M'], ['3mo', '3M'], ['6mo', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['5y', '5Y'], ['max', 'MAX'],
];

export function addPositionDialog(symbol, defaults = {}) {
  const f = h('form', { class: 'form' });
  f.innerHTML = `
    <label>Symbol<input class="in" name="symbol" required value="${esc(symbol || '')}"></label>
    <label>Shares / units<input class="in num" name="shares" type="number" step="any" required value="${esc(defaults.shares ?? '')}"></label>
    <label>Cost per share ($)<input class="in num" name="costBasis" type="number" step="any" min="0" required value="${esc(defaults.costBasis ?? '')}"></label>
    <label>Purchase date<input class="in" name="purchaseDate" type="date" value="${esc(defaults.purchaseDate || '')}"></label>
    <label>Account<input class="in" name="account" list="acct-list" value="${esc(defaults.account || 'Taxable')}"><datalist id="acct-list"><option>Taxable</option><option>Roth IRA</option><option>Traditional IRA</option><option>401(k)</option><option>HSA</option><option>Crypto</option></datalist></label>
    <label>Asset class<select class="in" name="assetClass">${['Equity', 'ETF', 'Fund', 'Bond', 'Crypto', 'Commodity', 'Other'].map((c) => `<option ${c === (defaults.assetClass || 'Equity') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label style="grid-column:1/-1">Notes<input class="in" name="notes" value="${esc(defaults.notes || '')}"></label>
    <div class="row end" style="grid-column:1/-1"><button class="btn primary" type="submit">${defaults.id ? 'Save lot' : 'Add position'}</button></div>`;
  const m = modal(defaults.id ? `Edit lot · ${symbol}` : 'Add position', f);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const lot = {
      id: defaults.id || uid(),
      symbol: v.symbol.trim().toUpperCase(),
      shares: Number(v.shares),
      costBasis: Number(v.costBasis),
      purchaseDate: v.purchaseDate,
      account: v.account || 'Taxable',
      assetClass: v.assetClass,
      notes: v.notes,
    };
    if (!lot.symbol || !Number.isFinite(lot.shares) || lot.shares === 0 || !Number.isFinite(lot.costBasis)) return toast('Enter symbol, shares and cost', true);
    update((d) => {
      const i = d.positions.findIndex((p) => p.id === lot.id);
      if (i >= 0) d.positions[i] = lot;
      else d.positions.push(lot);
    });
    toast(`${defaults.id ? 'Updated' : 'Added'} ${lot.shares} ${lot.symbol}`);
    m.close();
  });
}

export default {
  id: 'eq',
  title: 'Security',
  async mount(root, { args, query }, ctx) {
    const sym = (args[0] || 'AAPL').toUpperCase();
    const focus = query.get('focus');
    let quote = null;
    let profile = null;
    let fundamentals = null;
    let hist5y = null;
    let chartName = '';
    let chartCurrency = '';
    const ccy = () => quote?.currency || chartCurrency || 'USD';
    const fmtCcy = (v) => (v == null ? DASH : ccy() === 'USD' ? money(v) : `${num(v, 2)} ${ccy()}`);

    const head = h('div', { class: 'qhead' }, h('span', { class: 'loading' }, `Loading ${sym}`));
    const left = h('div', { class: 'stack-col c8' });
    const right = h('div', { class: 'stack-col c4' });
    const grid = h('div', { class: 'grid' }, left, right);
    root.append(head, grid);
    const P = (title, col, opts = {}) => {
      const p = panel({ title, ...opts });
      col.append(p.el);
      return p;
    };
    const chartP = P('Price Chart', left);
    chartP.el.id = 'sec-chart';
    const statsP = P('Key Statistics', right, { bodyCls: 'flush' });
    const fundP = P('Financials (SEC XBRL)', left);
    fundP.el.id = 'sec-fundamentals';
    const perfP = P('Performance & Risk', right, { bodyCls: 'flush' });
    const newsP = P('News', left, { bodyCls: 'flush scroll h520' });
    newsP.el.id = 'sec-news';
    const profP = P('Profile (SEC EDGAR)', right);
    profP.el.id = 'sec-profile';
    const filingsP = P('Filings', right, { bodyCls: 'flush' });
    filingsP.el.id = 'sec-filings';
    [statsP, perfP, fundP, profP, newsP, filingsP].forEach((p) => loading(p.body));

    // ---- header ----
    function drawHead() {
      const q = quote;
      const inWatch = state().watchlist.includes(sym);
      const held = state().positions.filter((p) => p.symbol === sym);
      const heldShares = held.reduce((s, p) => s + p.shares, 0);
      const name = nameOf(sym, profile?.isFund ? q?.name : profile?.sec?.name || (q?.name && q.name !== sym ? q.name : chartName) || sym);
      head.innerHTML = '';
      const d = q ? decimalsFor(q.price) : 2;
      head.append(
        h('div', {}, h('div', { class: 'sym' }, sym), h('div', { class: 'nm' }, name)),
        q
          ? h('div', { html: `<div class="px">${price(q.price, d)} <span class="muted" style="font-size:12px">${esc(ccy())}</span></div><div class="chg">${arrow(q.changePct)} <span class="${cls(q.change)}">${signed(q.change, d)} (${pct(q.changePct)})</span></div>` })
          : h('div', { class: 'muted' }, 'No live quote'),
        q
          ? h('div', {
              class: 'facts',
              html: `<span><b>Time</b>${esc(hhmm(q.time))} ${tzLabel()}</span><span><b>Session</b>${esc(q.marketState || DASH)}</span><span><b>Source</b>${esc(q.source)}</span>${q.realtime ? '<span class="tag live">REAL-TIME</span>' : q.delayed ? '<span class="tag delayed">DELAYED</span>' : ''}${heldShares ? `<span class="tag amber">YOU HOLD ${num(heldShares, heldShares % 1 ? 4 : 0)}</span>` : ''}`,
            })
          : '',
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn', onclick: () => {
            update((st) => {
              st.watchlist = inWatch ? st.watchlist.filter((s) => s !== sym) : [...st.watchlist, sym];
            });
            drawHead();
          } }, inWatch ? '★ Watching' : '☆ Watch'),
          !isIndexLike(sym) ? h('button', { class: 'btn primary', onclick: () => addPositionDialog(sym, { costBasis: q?.price ? Number(q.price.toFixed(2)) : '', assetClass: profile?.isFund ? 'ETF' : /-USD$/.test(sym) ? 'Crypto' : 'Equity' }) }, '+ Position') : null,
          profile?.isFund ? h('button', { class: 'btn', onclick: () => ctx.navigate(`#/ovlp?f=${sym}`) }, 'Overlap ›') : null,
          !isIndexLike(sym) ? h('button', { class: 'btn', onclick: () => ctx.navigate(`#/psim?s=${sym}`) }, 'Simulate ›') : null,
        ),
      );
    }

    async function refreshQuote() {
      try {
        const { quotes, errors } = await api.quotes([sym]);
        quote = quotes[sym] || null;
        if (!quote && errors[sym]) setStatus(`${sym}: ${errors[sym]}`);
        if (ctx.alive) {
          drawHead();
          drawStats();
        }
      } catch (err) {
        setStatus(err.message);
      }
    }

    // ---- chart ----
    let range = isIndexLike(sym) ? '1d' : '1y';
    let mode = 'line';
    let showSma = true;
    const chartBox = h('div');
    chartP.body.append(chartBox);
    const rangeSeg = seg(RANGES.map(([v, l]) => ({ value: v, label: l })), range, (v) => {
      range = v;
      drawChart();
    });
    const modeSeg = seg([{ value: 'line', label: 'Line' }, { value: 'candle', label: 'Candle' }], mode, (v) => {
      mode = v;
      drawChart();
    });
    const smaSeg = seg([{ value: true, label: 'SMA 50/200' }, { value: false, label: 'Off' }], showSma, (v) => {
      showSma = v;
      drawChart();
    });
    chartP.meta.append(rangeSeg, modeSeg, smaSeg);
    async function drawChart() {
      loading(chartBox);
      try {
        const c = await api.chart(sym, range);
        if (!ctx.alive) return;
        if (!chartName && c.name && c.name !== sym) {
          chartName = c.name;
          chartCurrency = c.currency || '';
          drawHead();
        }
        const pts = c.points;
        const overlays = [];
        if (showSma && ['6mo', 'ytd', '1y', '5y', 'max'].includes(range)) {
          // Compute SMAs on longer history so they exist from the first visible bar.
          const longer = range === '5y' || range === 'max' ? c : await api.chart(sym, range === '1y' || range === 'ytd' || range === '6mo' ? '2y' : '5y').catch(() => c);
          const closes = longer.points.map((p) => p.c);
          const idx = new Map(longer.points.map((p, i) => [p.d, i]));
          const s50 = S.sma(closes, 50);
          const s200 = S.sma(closes, 200);
          const map = (arr) => pts.map((p) => (idx.has(p.d) ? arr[idx.get(p.d)] : null));
          if (range !== 'max') overlays.push({ name: 'SMA 50', values: map(s50), color: HEX[0] }, { name: 'SMA 200', values: map(s200), color: HEX[6] });
        }
        const ref = range === '1d' ? c.prevClose ?? quote?.prevClose : null;
        priceChart(chartBox, { points: pts, mode, overlays, height: 360, refY: ref ? { value: ref, label: `Prev close ${price(ref)}` } : null, fmt: (v) => price(v, decimalsFor(v)) });
        const first = pts[0]?.c;
        const last = pts.at(-1)?.c;
        const chg = first ? (last / first - 1) * 100 : null;
        chartP.setFoot(`${esc(c.source)}${c.adjusted ? ' · dividend-adjusted closes used for returns' : ''} · ${pts.length} bars (${esc(c.interval)}) · range change <span class="${cls(chg)}">${pct(chg)}</span>`);
      } catch (err) {
        errorBox(chartBox, err);
      }
    }

    // ---- stats ----
    function drawStats() {
      const q = quote;
      const f = profile?.summary?.fields || {};
      const fv = (k) => f[k]?.value;
      const fund = fundamentals;
      const px = q?.price;
      const shares = fund?.sharesOutstanding?.val;
      const mcap = parseFloat(String(fv('MarketCap') || '').replace(/,/g, '')) || (shares && px ? shares * px : null);
      const eps = fund?.ttm?.epsDiluted;
      const rev = fund?.ttm?.revenue;
      const ni = fund?.ttm?.netIncome;
      const eq = fund?.latest?.equity?.val;
      const ttmDiv = hist5y ? hist5y.dividends.filter((d) => d.t > Date.now() - 365 * 86400e3).reduce((s, d) => s + d.amount, 0) : null;
      const hi52 = q?.high52 ?? (hist5y ? Math.max(...hist5y.points.filter((p) => p.t > Date.now() - 365 * 86400e3).map((p) => p.h)) : null);
      const lo52 = q?.low52 ?? (hist5y ? Math.min(...hist5y.points.filter((p) => p.t > Date.now() - 365 * 86400e3).map((p) => p.l)) : null);
      const vol3m = hist5y ? S.mean(hist5y.points.slice(-63).map((p) => p.v || 0)) : null;
      const rows = [
        ['Previous close', price(q?.prevClose)],
        ['Open', price(q?.open)],
        ['Day range', fv('TodayHighLow') || (q?.high != null ? `${price(q.low)} – ${price(q.high)}` : DASH)],
        ['52-week range', hi52 && lo52 ? `${price(lo52)} – ${price(hi52)}` : fv('FiftTwoWeekHighLow') || DASH, hi52 && lo52 && px ? rangeBar(lo52, hi52, px) : ''],
        ['Volume', int(q?.volume)],
        ['Avg volume (3M)', vol3m ? int(vol3m) : DASH],
        ['Market cap', mcap ? (ccy() === 'USD' ? bigMoney(mcap) : `${big(mcap)} ${ccy()}`) : DASH],
        ['P/E (TTM)', eps > 0 && px ? num(px / eps, 1) + '×' : eps != null ? 'n/m' : DASH],
        ['EPS (TTM, diluted)', eps != null ? fmtCcy(eps) : DASH],
        ['Price / sales', rev > 0 && mcap ? num(mcap / rev, 2) + '×' : DASH],
        ['Price / book', eq > 0 && mcap ? num(mcap / eq, 2) + '×' : DASH],
        ['Net margin (TTM)', rev > 0 && ni != null ? pctf(ni / rev, 1) : DASH],
        ['Dividend (annual)', fv('AnnualizedDividend') || (ttmDiv ? fmtCcy(ttmDiv) + ' TTM' : DASH)],
        ['Dividend yield', fv('Yield') || (ttmDiv && px ? pctf(ttmDiv / px, 2) + ' TTM' : DASH)],
        ['Ex-dividend date', fv('ExDividendDate') || DASH],
        ['1-yr analyst target', fv('OneYrTarget') || DASH],
        ['Expense ratio', fv('ExpenseRatio') || null],
        ['Sector', fv('Sector') || profile?.sec?.industry || null],
        ['Industry', fv('Industry') || null],
        ['Exchange', fv('Exchange') || q?.exchange || null],
      ]
        .filter((r) => r[1] != null)
        // Company valuation metrics don't apply to funds, indices, FX or crypto.
        .filter((r) => !(profile?.isFund || !profile?.sec) || !['P/E (TTM)', 'EPS (TTM, diluted)', 'Price / sales', 'Price / book', 'Net margin (TTM)', '1-yr analyst target'].includes(r[0]) || r[1] !== DASH);
      statsP.body.innerHTML = `<table class="t compact">${rows.map(([k, v, extra]) => `<tr><td class="muted">${esc(k)}</td><td class="r b">${esc(v)}${extra ? `<div style="margin-top:3px">${extra}</div>` : ''}</td></tr>`).join('')}</table>`;
      statsP.setFoot(`Quote: ${esc(q?.source || DASH)}${fundamentals ? ' · Fundamentals: SEC EDGAR' : ''}${profile?.summary ? ' · Summary: Nasdaq' : ''}${hist5y && !profile?.summary ? ` · History: ${esc(hist5y.source)}` : ''}`);
    }

    // ---- performance & risk (5y daily history) ----
    async function drawPerf() {
      try {
        const [h5, bench] = await Promise.all([api.chart(sym, '5y'), sym === 'SPY' ? null : api.chart('SPY', '5y').catch(() => null)]);
        hist5y = h5;
        if (!ctx.alive) return;
        drawStats();
        const pts = h5.points;
        const closes = pts.map((p) => p.a ?? p.c);
        const lastT = pts.at(-1).t;
        const back = (days) => {
          const cut = lastT - days * 86400e3;
          let i = pts.findIndex((p) => p.t >= cut);
          if (i <= 0 && days > (lastT - pts[0].t) / 86400e3 + 5) return null;
          i = Math.max(0, i);
          return closes.at(-1) / closes[i] - 1;
        };
        const ytdStart = pts.findIndex((p) => p.d >= `${new Date().getUTCFullYear()}-01-01`);
        const ytd = ytdStart > 0 ? closes.at(-1) / closes[ytdStart - 1] - 1 : null;
        const yrs = (lastT - pts[0].t) / (365.25 * 86400e3);
        const ann = (r, y) => (r == null ? null : (1 + r) ** (1 / y) - 1);
        const r1y = closes.slice(-253);
        const rets1y = S.toReturns(r1y);
        let betaV = null;
        let betaLabel = 'Beta vs SPY (1Y daily)';
        if (bench) {
          const al = S.alignSeries({ a: { dates: pts.map((p) => p.d), close: closes }, b: { dates: bench.points.map((p) => p.d), close: bench.points.map((p) => p.a ?? p.c) } });
          // Markets in other time zones close at different instants, so same-day returns are
          // asynchronous: use weekly returns over 2 years for non-US listings.
          const weekly = /\.[A-Z]{1,4}$/.test(sym) || /=X$|-USD$/.test(sym);
          const pick = (arr) => (weekly ? arr.slice(-505).filter((_, i, a) => (a.length - 1 - i) % 5 === 0) : arr.slice(-253));
          const ra = S.toReturns(pick(al.prices.a));
          const rb = S.toReturns(pick(al.prices.b));
          if (ra.length > (weekly ? 40 : 60)) betaV = S.beta(ra, rb);
          betaLabel = weekly ? 'Beta vs SPY (2Y weekly)' : 'Beta vs SPY (1Y daily)';
        }
        const mdd = S.maxDrawdown(closes);
        const rows = [
          ['1 week', back(7)],
          ['1 month', back(30)],
          ['3 months', back(91)],
          ['YTD', ytd],
          ['1 year', back(365)],
          ['3 years (ann.)', ann(back(1095), 3)],
          ['5 years (ann.)', yrs > 4.9 ? ann(closes.at(-1) / closes[0] - 1, yrs) : null],
        ];
        const vol = S.stdev(rets1y) * Math.sqrt(252);
        perfP.body.innerHTML = `<table class="t compact">${rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td class="r b ${cls(v)}">${v == null ? DASH : pctf(v, 2, { sign: true })}</td></tr>`).join('')}
          <tr><td class="muted">Volatility (1Y, ann.)</td><td class="r b">${pctf(vol, 1)}</td></tr>
          <tr><td class="muted">${betaLabel}</td><td class="r b">${betaV != null ? num(betaV, 2) : sym === 'SPY' ? '1.00' : DASH}</td></tr>
          <tr><td class="muted">Max drawdown (5Y)</td><td class="r b down">${pctf(mdd.maxDrawdown, 1)}</td></tr>
          <tr><td class="muted">RSI (14)</td><td class="r b">${num(S.rsi(closes.slice(-200), 14), 1)}</td></tr>
          <tr><td class="muted">vs 200-day SMA</td><td class="r b ${cls(closes.at(-1) / S.sma(closes, 200).at(-1) - 1)}">${pctf(closes.at(-1) / S.sma(closes, 200).at(-1) - 1, 1, { sign: true })}</td></tr></table>`;
        perfP.setFoot(`${esc(h5.source)}${h5.adjusted ? ' · total return (dividends reinvested)' : ' · price return'}`);
      } catch (err) {
        errorBox(perfP.body, err);
      }
    }

    // ---- fundamentals ----
    let period = 'annual';
    const periodSeg = seg([{ value: 'annual', label: 'Annual' }, { value: 'quarterly', label: 'Quarterly' }], period, (v) => {
      period = v;
      drawFund();
    });
    fundP.meta.append(periodSeg);
    function drawFund() {
      const f = fundamentals;
      if (!f) return;
      const ser = f.series;
      const ends = [...new Set([...ser.revenue[period], ...ser.netIncome[period]].map((x) => x.end))].sort().slice(period === 'annual' ? -6 : -8);
      if (!ends.length) return (fundP.body.innerHTML = '<div class="empty">No XBRL financial data reported</div>');
      const get = (k, e) => ser[k][period].find((x) => x.end === e)?.val ?? null;
      const label = (e) => (period === 'annual' ? `FY${e.slice(0, 4)}` : `${e.slice(2, 7)}`);
      const line = (name, k, fmt = (v) => big(v, 2), extra = {}) => ({ name, vals: ends.map((e) => (typeof k === 'function' ? k(e) : get(k, e))), fmt, ...extra });
      const fcf = (e) => (get('operatingCashFlow', e) != null && get('capex', e) != null ? get('operatingCashFlow', e) - get('capex', e) : null);
      const margin = (num_, e) => (get(num_, e) != null && get('revenue', e) ? get(num_, e) / get('revenue', e) : null);
      const lines = [
        line('Revenue', 'revenue'),
        line('  growth y/y', (e) => {
          const i = ends.indexOf(e);
          const prevEnd = period === 'annual' ? ends[i - 1] : ser.revenue.quarterly.find((x) => Math.abs(Date.parse(x.end) - (Date.parse(e) - 365 * 86400e3)) < 20 * 86400e3)?.end;
          return prevEnd && get('revenue', prevEnd) ? get('revenue', e) / get('revenue', prevEnd) - 1 : null;
        }, (v) => pctf(v, 1, { sign: true }), { pct: true }),
        line('Gross profit', 'grossProfit'),
        line('  gross margin', (e) => margin('grossProfit', e), (v) => pctf(v, 1), { pct: true }),
        line('Operating income', 'operatingIncome'),
        line('  operating margin', (e) => margin('operatingIncome', e), (v) => pctf(v, 1), { pct: true }),
        line('Net income', 'netIncome'),
        line('  net margin', (e) => margin('netIncome', e), (v) => pctf(v, 1), { pct: true }),
        line('EPS (diluted)', 'epsDiluted', (v) => money(v)),
        line('R&D expense', 'rnd'),
        line('Operating cash flow', 'operatingCashFlow'),
        line('Capital expenditure', 'capex'),
        line('Free cash flow', fcf),
        line('Dividends paid', 'dividendsPaid'),
        line('Share buybacks', 'buybacks'),
        line('Total assets', 'totalAssets'),
        line('Total liabilities', 'totalLiabilities'),
        line("Shareholders' equity", 'equity'),
        line('Cash & equivalents', 'cash'),
        line('Long-term debt', 'longTermDebt'),
      ].filter((l) => l.vals.some((v) => v != null));
      const chartBox = h('div');
      fundP.body.innerHTML = '';
      fundP.body.append(chartBox);
      columnChart(chartBox, {
        labels: ends.map(label),
        tipLabels: ends.map((e) => `Period ending ${date(e)}`),
        series: [
          { name: 'Revenue', values: ends.map((e) => get('revenue', e)), color: HEX[0] },
          { name: 'Net income', values: ends.map((e) => get('netIncome', e)), color: HEX[2] },
          { name: 'Free cash flow', values: ends.map(fcf), color: HEX[1] },
        ],
        height: 170,
        tipFmt: (v) => bigMoney(v),
      });
      const tbl = h('div', { class: 'scroll', style: { marginTop: '6px' } });
      tbl.innerHTML = `<table class="t compact"><thead><tr><th>USD</th>${ends.map((e) => `<th class="r" title="Period ending ${esc(e)}">${esc(label(e))}</th>`).join('')}</tr></thead><tbody>${lines
        .map((l) => `<tr><td class="${l.pct ? 'muted' : ''}" style="white-space:pre">${esc(l.name)}</td>${l.vals.map((v) => `<td class="r ${l.pct ? 'dim ' + (l.name.includes('growth') ? cls(v) : '') : ''}">${v == null ? DASH : esc(l.fmt(v))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
      fundP.body.append(tbl);
      const derived = period === 'quarterly' && ser.revenue.quarterly.some((x) => x.derived);
      fundP.setFoot(`Source: SEC EDGAR XBRL company facts (CIK ${f.cik})${derived ? ' · some quarters derived from year-to-date filings' : ''} · TTM through ${esc(f.ttmAsOf || DASH)}`);
    }

    // ---- ETF holdings (replaces financials for funds) ----
    async function drawHoldings() {
      fundP.el.querySelector('h2').textContent = 'Top Holdings';
      periodSeg.remove();
      loading(fundP.body, 'Loading holdings (first load of an N-PORT filing can take ~10s)');
      try {
        const hd = await api.holdings(sym);
        if (!ctx.alive) return;
        const top = hd.holdings.slice(0, 25);
        const top10 = hd.holdings.slice(0, 10).reduce((s, x) => s + x.weight, 0);
        fundP.meta.innerHTML = `${int(hd.count)} holdings · top 10 = ${num(top10, 1)}%`;
        fundP.body.innerHTML = `<div class="grid"><div class="c6">${hbars(top.slice(0, 15).map((x) => ({ label: x.ticker || x.name, value: x.weight, title: `${x.name} ${num(x.weight, 2)}%` })), { fmt: (v) => num(v, 2) + '%', labelW: 70 })}</div>
          <div class="c6 scroll h300"><table class="t compact"><thead><tr><th>Ticker</th><th>Name</th><th class="r">Weight</th></tr></thead><tbody>${top
            .map((x) => `<tr class="${x.ticker ? 'click' : ''}" ${x.ticker ? `data-sym="${esc(x.ticker)}"` : ''}><td class="sym">${esc(x.ticker || DASH)}</td><td class="nm">${esc(x.name)}</td><td class="r">${num(x.weight, 2)}%</td></tr>`)
            .join('')}</tbody></table></div></div>`;
        fundP.body.querySelectorAll('[data-sym]').forEach((tr) => tr.addEventListener('click', () => ctx.navigate(`#/eq/${encodeURIComponent(tr.dataset.sym)}`)));
        fundP.setFoot(`Source: <a href="${safeUrl(hd.sourceUrl)}" target="_blank" rel="noopener">${esc(hd.source)}</a> · as of ${esc(hd.asOf)}${hd.approximate ? ' · approximation' : ''}`);
      } catch (err) {
        errorBox(fundP.body, err);
      }
    }

    // ---- profile & filings ----
    let formFilter = 'key';
    const formSeg = seg([{ value: 'key', label: '10-K/Q, 8-K' }, { value: 'all', label: 'All' }], formFilter, (v) => {
      formFilter = v;
      drawFilings();
    });
    filingsP.meta.append(formSeg);
    function drawFilings() {
      const fl = profile?.sec?.filings || [];
      const rows = formFilter === 'key' ? fl.filter((f) => /^(10-K|10-Q|8-K|20-F|6-K|40-F|DEF 14A|S-1|N-CSR|N-CSRS|497K?|485BPOS)/.test(f.form)) : fl;
      filingsP.body.innerHTML = rows.length
        ? `<div class="scroll h520"><table class="t compact"><thead><tr><th>Filed</th><th>Form</th><th>Description</th><th class="r">Doc</th></tr></thead><tbody>${rows
            .slice(0, 40)
            .map((f) => `<tr><td class="muted">${esc(f.filed)}</td><td class="amber b">${esc(f.form)}</td><td class="nm wrap" style="max-width:none">${esc(describeItems(f.items) || f.description || '')}${f.items ? ` <span class="muted">(${esc(f.items)})</span>` : ''}</td><td class="r"><a href="${safeUrl(f.url)}" target="_blank" rel="noopener noreferrer">open ›</a></td></tr>`)
            .join('')}</tbody></table></div>`
        : '<div class="empty">No filings</div>';
      if (profile?.sec) filingsP.setFoot(`Source: <a href="${safeUrl(profile.sec.edgarUrl)}" target="_blank" rel="noopener">SEC EDGAR</a>`);
    }
    function drawProfile() {
      const s = profile?.sec;
      if (!s) {
        // SEC panels only apply to US registrants: hide them for indices, FX, crypto and foreign listings.
        profP.el.remove();
        filingsP.el.remove();
        return;
      }
      const fye = s.fiscalYearEnd ? `${s.fiscalYearEnd.slice(0, 2)}/${s.fiscalYearEnd.slice(2)}` : DASH;
      profP.body.innerHTML = `<table class="t compact">
        <tr><td class="muted">Registrant</td><td class="r">${esc(s.name)}</td></tr>
        <tr><td class="muted">Tickers</td><td class="r amber">${esc(s.tickers.join(', '))}</td></tr>
        <tr><td class="muted">Exchanges</td><td class="r">${esc(s.exchanges.join(', ') || DASH)}</td></tr>
        <tr><td class="muted">SIC industry</td><td class="r">${esc(s.industry || DASH)}</td></tr>
        <tr><td class="muted">Filer category</td><td class="r">${esc(s.category || DASH)}</td></tr>
        <tr><td class="muted">Fiscal year end</td><td class="r">${esc(fye)}</td></tr>
        <tr><td class="muted">Incorporated</td><td class="r">${esc(s.stateOfIncorporation || DASH)}</td></tr>
        <tr><td class="muted">Address</td><td class="r wrap">${esc(s.address || DASH)}</td></tr>
        ${s.website ? `<tr><td class="muted">Website</td><td class="r"><a href="${safeUrl(s.website.startsWith('http') ? s.website : 'https://' + s.website)}" target="_blank" rel="noopener">${esc(s.website)}</a></td></tr>` : ''}
        <tr><td class="muted">CIK</td><td class="r"><a href="${safeUrl(s.edgarUrl)}" target="_blank" rel="noopener">${s.cik}</a></td></tr>
        ${s.formerNames.length ? `<tr><td class="muted">Former names</td><td class="r wrap">${esc(s.formerNames.slice(0, 3).join('; '))}</td></tr>` : ''}
      </table>`;
      drawFilings();
    }

    async function drawNews() {
      try {
        const n = await api.symbolNews(sym, profile?.sec?.name || NAMES[sym] || (quote?.name !== sym ? quote?.name : '') || chartName || '');
        if (!ctx.alive) return;
        newsP.body.innerHTML = newsList(n.items, { highlight: [sym] });
        newsP.setFoot(`Sources: ${n.feeds.map((f) => `${esc(f.feed)} ${f.ok ? '✓' : '✗'}`).join(' · ')} + general feeds mentioning ${esc(sym)}`);
      } catch (err) {
        errorBox(newsP.body, err);
      }
    }

    // ---- load ----
    drawHead();
    refreshQuote();
    drawChart();
    drawPerf();
    try {
      profile = await api.profile(sym);
    } catch (err) {
      profile = { errors: [err.message] };
    }
    if (!ctx.alive) return;
    drawHead();
    drawProfile();
    drawNews();
    if (profile.isFund) drawHoldings();
    else if (profile.sec) {
      try {
        fundamentals = await api.fundamentals(sym);
        if (ctx.alive) {
          drawFund();
          drawStats();
        }
      } catch (err) {
        errorBox(fundP.body, err);
      }
    } else fundP.el.remove();
    drawStats();
    ctx.every(10000, refreshQuote);
    if (focus) document.getElementById(`sec-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
};
