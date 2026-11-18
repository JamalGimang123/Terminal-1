// NEWS — aggregated headlines by category, plus news for your holdings & watchlist.
import { api } from '../api.js';
import { h, panel, loading, errorBox, seg } from '../dom.js';
import { esc, timeIn, displayTz, tzLabel } from '../fmt.js';
import { state, holdingsBySymbol } from '../state.js';
import { newsList } from './common.js';

const CATS = [
  ['top', 'Top'], ['markets', 'Markets'], ['economy', 'Economy'], ['fed', 'Fed'], ['earnings', 'Earnings'], ['tech', 'Tech'], ['world', 'World'], ['regulatory', 'SEC'], ['indonesia', 'Indonesia'], ['mine', 'My Holdings'],
];

export default {
  id: 'news',
  title: 'News',
  async mount(root, { args }, ctx) {
    let cat = CATS.some((c) => c[0] === args[0]) ? args[0] : 'top';
    let filter = '';
    const main = panel({ title: 'Headlines', bodyCls: 'flush' });
    const side = panel({ title: 'Feed Status', bodyCls: 'flush' });
    const grid = h('div', { class: 'grid' });
    main.el.classList.add('c9');
    side.el.classList.add('c3');
    grid.append(main.el, side.el);
    const tabs = seg(CATS.map(([v, l]) => ({ value: v, label: l })), cat, (v) => {
      cat = v;
      history.replaceState(null, '', `#/news/${v}`);
      langSeg.hidden = v !== 'indonesia';
      load();
    });
    let lang = 'all';
    const langSeg = seg([{ value: 'all', label: 'All languages' }, { value: 'en', label: 'English' }, { value: 'id', label: 'Bahasa Indonesia' }], lang, (v) => {
      lang = v;
      draw();
    });
    langSeg.hidden = cat !== 'indonesia';
    const search = h('input', { class: 'in', placeholder: 'filter headlines…', style: { width: '200px' }, oninput: (e) => {
      filter = e.target.value.toLowerCase();
      draw();
    } });
    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'NEWS'), tabs, langSeg, h('span', { class: 'spacer' }), search), grid);

    let items = [];
    const mySyms = () => {
      const st = state();
      return [...new Set([...holdingsBySymbol(st.positions).map((p) => p.symbol), ...st.watchlist])];
    };
    function draw() {
      let list = filter ? items.filter((i) => `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(filter)) : items;
      if (cat === 'indonesia' && lang !== 'all') list = list.filter((i) => i.lang === lang);
      main.body.innerHTML = newsList(list, { highlight: mySyms(), limit: 150 });
      main.meta.textContent = `${list.length} stories · updated ${timeIn(new Date(), displayTz)} ${tzLabel()}`;
    }
    async function load() {
      loading(main.body);
      try {
        if (cat === 'mine') {
          const syms = mySyms().filter((s) => !/[=^]/.test(s)).slice(0, 12);
          if (!syms.length) {
            main.body.innerHTML = '<div class="empty">Add positions (PORT) or watchlist symbols to see news about them.</div>';
            return;
          }
          const res = await Promise.allSettled(syms.map((s) => api.symbolNews(s)));
          const seen = new Set();
          items = res
            .flatMap((r, i) => (r.status === 'fulfilled' ? r.value.items.map((it) => ({ ...it, symbols: [...(it.symbols || []), syms[i]] })) : []))
            .filter((i) => !seen.has(i.link) && seen.add(i.link))
            .sort((a, b) => (b.published || '').localeCompare(a.published || ''));
          side.body.innerHTML = `<table class="t compact">${syms.map((s, i) => `<tr><td class="sym">${esc(s)}</td><td class="r ${res[i].status === 'fulfilled' ? 'up' : 'down'}">${res[i].status === 'fulfilled' ? res[i].value.items.length + ' stories' : 'failed'}</td></tr>`).join('')}</table>`;
        } else {
          const n = await api.news(cat, cat === 'indonesia' ? 300 : 150);
          items = n.items;
          side.body.innerHTML = `<table class="t compact">${n.feeds.map((f) => `<tr title="${esc(f.error || '')}"><td>${esc(f.feed)}</td><td class="r ${f.ok ? 'up' : 'down'}">${f.ok ? f.count : 'error'}</td></tr>`).join('')}</table>`;
        }
        if (ctx.alive) draw();
        side.setFoot(cat === 'indonesia' ? 'Indonesia: CNBC Indonesia, Antara (Bahasa & English), Detik Finance (advertorials removed), Bank Indonesia press releases.' : 'Headlines link to the original publisher. Sources: CNBC, MarketWatch, Federal Reserve, SEC, Nasdaq, Yahoo Finance RSS.');
      } catch (err) {
        errorBox(main.body, err);
      }
    }
    load();
    ctx.every(120000, load);
  },
};
