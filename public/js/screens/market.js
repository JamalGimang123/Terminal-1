// MKT — market monitor: indices, futures, rates, world, FX, crypto, sectors, movers, news, calendars.
import { api } from '../api.js';
import { h, panel, loading, errorBox, seg, setStatus } from '../dom.js';
import { esc, price, pct, signed, cls, arrow, big, bp, num, timeIn } from '../fmt.js';
import { sparkline, perfColor } from '../charts.js';
import { state } from '../state.js';
import { US_INDICES, FUTURES, WORLD, FX, SECTORS } from '../symbols.js';
import { quoteTable, linkRows, newsList } from './common.js';

export default {
  id: 'mkt',
  title: 'Market Monitor',
  async mount(root, _p, ctx) {
    const grid = h('div', { class: 'grid' });
    root.append(grid);
    const P = (title, c, opts = {}) => {
      const p = panel({ title, ...opts });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const idx = P('US Equity Indices', 'c4');
    const fut = P('Futures & Commodities', 'c4');
    const rates = P('US Treasury Yields', 'c4');
    const world = P('World Indices', 'c4');
    const fx = P('Currencies', 'c4');
    const crypto = P('Crypto', 'c4');
    const sectors = P('S&P 500 Sectors (SPDR ETFs)', 'c7');
    const movers = P('Movers', 'c5');
    const watch = P('Watchlist', 'c4');
    const top = P('Top Headlines', 'c5', { bodyCls: 'flush scroll h420' });
    const cal = P('Today', 'c3', { bodyCls: 'flush' });
    [idx, fut, world, fx, sectors, watch, movers, crypto].forEach((p) => linkRows(p.body, ctx.navigate));
    [idx, fut, rates, world, fx, crypto, sectors, movers, watch].forEach((p) => loading(p.body));
    loading(top.body);
    loading(cal.body);

    // ---- quotes (one batched call) ----
    const sectorSyms = SECTORS.map((s) => s[0]);
    async function refreshQuotes() {
      const wl = state().watchlist || [];
      const all = [...US_INDICES, ...FUTURES, ...WORLD, ...FX, ...sectorSyms, ...wl];
      try {
        const { quotes, errors } = await api.quotes(all);
        if (!ctx.alive) return;
        idx.body.innerHTML = quoteTable(US_INDICES, quotes, errors);
        fut.body.innerHTML = quoteTable(FUTURES, quotes, errors);
        world.body.innerHTML = quoteTable(WORLD, quotes, errors, { spark: true, showTime: false });
        fx.body.innerHTML = quoteTable(FX, quotes, errors);
        watch.body.innerHTML = wl.length ? quoteTable(wl, quotes, errors, { nameW: 120 }) : '<div class="empty">Watchlist is empty — type WATCH AAPL MSFT</div>';
        watch.meta.innerHTML = `<a href="#/port">edit</a>`;
        sectors.body.innerHTML = `<div class="heat">${SECTORS.map(([s, name]) => {
          const q = quotes[s];
          return `<div class="cell" data-sym="${s}" style="background:${perfColor(q?.changePct)}" title="${esc(name)} ${q ? pct(q.changePct) : ''}">
            <div><span class="a">${s}</span> <span class="b2">${esc(name)}</span></div>
            <div class="p">${q ? arrow(q.changePct) + ' ' + pct(q.changePct) : '—'}</div>
            <div class="b2">${q ? price(q.price) : 'unavailable'}</div></div>`;
        }).join('')}</div>`;
        const ordered = sectorSyms.filter((s) => s !== 'SPY' && quotes[s]).sort((a, b) => quotes[b].changePct - quotes[a].changePct);
        sectors.meta.textContent = ordered.length ? `Leader ${ordered[0]} ${pct(quotes[ordered[0]].changePct)} · Laggard ${ordered.at(-1)} ${pct(quotes[ordered.at(-1)].changePct)}` : '';
        const src = new Set(Object.values(quotes).map((q) => q.source));
        setStatus(`Market monitor updated ${timeIn(new Date(), 'America/New_York', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} ET · sources: ${[...src].join(', ')}`);
      } catch (err) {
        [idx, fut, world, fx, sectors, watch].forEach((p) => errorBox(p.body, err));
      }
    }

    // ---- rates ----
    async function refreshRates() {
      try {
        const y = await api.yields();
        if (!ctx.alive) return;
        const keys = ['1 Mo', '3 Mo', '6 Mo', '1 Yr', '2 Yr', '5 Yr', '10 Yr', '20 Yr', '30 Yr'].filter((k) => y.latest.yields[k] != null);
        const L = y.latest.yields;
        const P1 = y.previous?.yields || {};
        const M = y.monthAgo?.yields || {};
        const Yr = y.yearAgo?.yields || {};
        const d = (a, b) => (a != null && b != null ? (a - b) * 100 : null);
        const rows = keys
          .map((k) => `<tr><td class="sym">${k.replace(' Mo', 'M').replace(' Yr', 'Y')}</td><td class="r b">${num(L[k], 2)}%</td><td class="r ${cls(d(L[k], P1[k]))}">${bp(d(L[k], P1[k]))}</td><td class="r ${cls(d(L[k], M[k]))}">${bp(d(L[k], M[k]))}</td><td class="r ${cls(d(L[k], Yr[k]))}">${bp(d(L[k], Yr[k]))}</td></tr>`)
          .join('');
        const s2s10 = (L['10 Yr'] - L['2 Yr']) * 100;
        const s3m10 = (L['10 Yr'] - L['3 Mo']) * 100;
        rates.body.innerHTML = `<table class="t compact"><thead><tr><th>Tenor</th><th class="r">Yield</th><th class="r">1D</th><th class="r">1M</th><th class="r">1Y</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="row" style="margin-top:4px"><span class="tag">2s10s <b class="${cls(s2s10)}">${signed(s2s10, 0)}bp</b></span><span class="tag">3m10y <b class="${cls(s3m10)}">${signed(s3m10, 0)}bp</b></span><span class="spacer"></span><a href="#/eco">curve ›</a></div>`;
        rates.meta.textContent = `as of ${y.latest.date}`;
        rates.setFoot('Source: U.S. Treasury daily par yield curve');
      } catch (err) {
        errorBox(rates.body, err);
      }
    }

    // ---- crypto ----
    async function refreshCrypto() {
      try {
        const { coins } = await api.crypto(20);
        if (!ctx.alive) return;
        crypto.body.innerHTML = `<table class="t compact"><thead><tr><th>Coin</th><th class="r">Price</th><th class="r">24h</th><th class="r">7d</th><th class="r">Mkt Cap</th><th class="r">7 days</th></tr></thead><tbody>${coins
          .filter((c) => !/^(USDT|USDC|DAI|USDE|FDUSD|USDS|PYUSD|USD1)-/.test(c.symbol) && /^[A-Z0-9]{2,6}-USD$/.test(c.symbol))
          .slice(0, 8)
          .map((c) => `<tr class="click" data-sym="${esc(c.symbol)}"><td class="sym" title="${esc(c.name)}">${esc(c.symbol.replace('-USD', ''))}</td><td class="r b">${price(c.price)}</td><td class="r ${cls(c.changePct)}">${pct(c.changePct)}</td><td class="r ${cls(c.change7d)}">${pct(c.change7d)}</td><td class="r">${big(c.marketCap, 1)}</td><td class="r">${sparkline(c.spark, { w: 64, h: 16 })}</td></tr>`)
          .join('')}</tbody></table>`;
        crypto.setFoot('Source: CoinGecko');
      } catch (err) {
        errorBox(crypto.body, err);
      }
    }

    // ---- movers ----
    let moverTab = 'ndxGainers';
    let moverData = null;
    const tabs = seg(
      [
        { value: 'ndxGainers', label: 'NDX ▲' },
        { value: 'ndxLosers', label: 'NDX ▼' },
        { value: 'gainers', label: 'All ▲' },
        { value: 'losers', label: 'All ▼' },
        { value: 'active', label: 'Most $Vol' },
      ],
      moverTab,
      (v) => {
        moverTab = v;
        drawMovers();
      },
    );
    movers.meta.append(tabs);
    function drawMovers() {
      if (!moverData) return;
      const rows = moverData[moverTab] || [];
      movers.body.innerHTML = rows.length
        ? `<table class="t compact"><thead><tr><th>Ticker</th><th>Name</th><th class="r">Last</th><th class="r">Chg</th><th class="r">%Chg</th></tr></thead><tbody>${rows
            .map((r) => `<tr class="click" data-sym="${esc(r.symbol)}"><td class="sym">${esc(r.symbol)}</td><td class="nm">${esc(r.name)}</td><td class="r">${price(r.price)}</td><td class="r ${cls(r.change)}">${signed(r.change)}</td><td class="r ${cls(r.changePct)}">${arrow(r.changePct)} ${pct(r.changePct)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<div class="empty">No data</div>';
      movers.setFoot(`Source: Nasdaq · ${esc(moverData.asOf || '')}`);
    }
    async function refreshMovers() {
      try {
        moverData = await api.movers();
        if (ctx.alive) drawMovers();
      } catch (err) {
        errorBox(movers.body, err);
      }
    }

    // ---- news & calendar ----
    async function refreshNews() {
      try {
        const n = await api.news('top', 40);
        if (!ctx.alive) return;
        const hl = [...(state().watchlist || []), ...(state().positions || []).map((p) => p.symbol)];
        top.body.innerHTML = newsList(n.items, { highlight: hl, showSummary: false });
        top.meta.innerHTML = `<a href="#/news">more ›</a>`;
      } catch (err) {
        errorBox(top.body, err);
      }
    }

    let calTab = 'econ';
    let econ = null;
    let earn = null;
    const calTabs = seg(
      [
        { value: 'econ', label: 'Economic' },
        { value: 'earn', label: 'Earnings' },
      ],
      calTab,
      (v) => {
        calTab = v;
        drawCal();
      },
    );
    cal.meta.append(calTabs);
    function drawCal() {
      if (calTab === 'econ') {
        if (!econ) return loading(cal.body);
        const rows = econ.rows.filter((r) => r.country === 'United States');
        cal.body.innerHTML = rows.length
          ? `<div class="scroll h420"><table class="t compact"><thead><tr><th>ET</th><th>Event</th><th class="r">Act</th><th class="r">Cons</th></tr></thead><tbody>${rows
              .map((r) => `<tr title="Previous: ${esc(r.previous)}"><td class="muted">${esc(r.timeGMT)}</td><td class="wrap">${esc(r.event)}</td><td class="r b">${esc(r.actual) || '—'}</td><td class="r dim">${esc(r.consensus) || '—'}</td></tr>`)
              .join('')}</tbody></table></div>`
          : '<div class="empty">No US releases today</div>';
      } else {
        if (!earn) return loading(cal.body);
        cal.body.innerHTML = earn.rows.length
          ? `<div class="scroll h420"><table class="t compact"><thead><tr><th>Ticker</th><th>When</th><th class="r">EPS est</th><th class="r">Mkt cap</th></tr></thead><tbody>${earn.rows
              .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
              .map((r) => `<tr class="click" data-sym="${esc(r.symbol)}" title="${esc(r.name)}"><td class="sym">${esc(r.symbol)}</td><td class="muted">${esc(r.time)}</td><td class="r">${r.epsForecast != null ? '$' + num(r.epsForecast) : '—'}</td><td class="r">${big(r.marketCap, 1)}</td></tr>`)
              .join('')}</tbody></table></div>`
          : '<div class="empty">No earnings today</div>';
      }
    }
    linkRows(cal.body, ctx.navigate);
    async function refreshCal() {
      const [e1, e2] = await Promise.allSettled([api.economic(), api.earnings()]);
      econ = e1.status === 'fulfilled' ? e1.value : { rows: [] };
      earn = e2.status === 'fulfilled' ? e2.value : { rows: [] };
      if (ctx.alive) drawCal();
      cal.setFoot('Source: Nasdaq calendars');
    }

    refreshQuotes();
    refreshRates();
    refreshCrypto();
    refreshMovers();
    refreshNews();
    refreshCal();
    ctx.every(15000, refreshQuotes);
    ctx.every(60000, refreshCrypto);
    ctx.every(60000, refreshMovers);
    ctx.every(180000, refreshNews);
    ctx.every(30 * 60000, refreshRates);
    ctx.every(15 * 60000, refreshCal);
  },
};
