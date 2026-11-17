// ECO — rates & macro: Treasury curve, rate history, FRED indicators, economic & earnings calendars, Fed.
import { api } from '../api.js';
import { h, panel, loading, errorBox, seg } from '../dom.js';
import { esc, num, big, bp, cls, signed, date, DASH } from '../fmt.js';
import { lineChart, sparkline, HEX } from '../charts.js';
import { newsList, linkRows } from './common.js';

const IND = [
  { id: 'DFF', name: 'Fed funds (effective)', tf: 'level', unit: '%' },
  { id: 'CPIAUCSL', name: 'CPI inflation y/y', tf: 'yoy', unit: '%' },
  { id: 'CPILFESL', name: 'Core CPI y/y', tf: 'yoy', unit: '%' },
  { id: 'PCEPILFE', name: 'Core PCE y/y', tf: 'yoy', unit: '%' },
  { id: 'UNRATE', name: 'Unemployment rate', tf: 'level', unit: '%' },
  { id: 'PAYEMS', name: 'Payrolls m/m (K)', tf: 'diff', unit: 'K' },
  { id: 'ICSA', name: 'Initial jobless claims', tf: 'level', unit: '' },
  { id: 'A191RL1Q225SBEA', name: 'Real GDP q/q ann.', tf: 'level', unit: '%' },
  { id: 'T10YIE', name: '10Y breakeven inflation', tf: 'level', unit: '%' },
  { id: 'BAMLH0A0HYM2', name: 'High-yield OAS', tf: 'level', unit: '%' },
  { id: 'MORTGAGE30US', name: '30Y mortgage rate', tf: 'level', unit: '%' },
  { id: 'UMCSENT', name: 'UMich consumer sentiment', tf: 'level', unit: '' },
  { id: 'VIXCLS', name: 'VIX close', tf: 'level', unit: '' },
  { id: 'DCOILWTICO', name: 'WTI crude $/bbl', tf: 'level', unit: '$' },
  { id: 'M2SL', name: 'M2 money supply y/y', tf: 'yoy', unit: '%' },
  { id: 'HOUST', name: 'Housing starts (K ann.)', tf: 'level', unit: 'K' },
];

function transform(points, tf) {
  if (tf === 'level') return points;
  if (tf === 'diff') return points.slice(1).map((p, i) => ({ date: p.date, value: p.value - points[i].value }));
  // year-over-year % change, matched by date (works for monthly/quarterly/weekly)
  const out = [];
  let j = 0;
  for (let i = 0; i < points.length; i++) {
    const target = Date.parse(points[i].date) - 365 * 86400e3;
    while (j < i && Date.parse(points[j + 1].date) <= target + 5 * 86400e3) j++;
    if (Math.abs(Date.parse(points[j].date) - target) < 20 * 86400e3 && points[j].value) out.push({ date: points[i].date, value: (points[i].value / points[j].value - 1) * 100 });
  }
  return out;
}

const fmtVal = (v, unit) => (v == null ? DASH : unit === '%' ? num(v, 2) + '%' : unit === '$' ? '$' + num(v, 2) : unit === 'K' ? num(v, 0) + 'K' : v >= 10000 ? big(v, 0) : num(v, 1));
const iso = (d) => d.toISOString().slice(0, 10);

export default {
  id: 'eco',
  title: 'Macro & Rates',
  async mount(root, _p, ctx) {
    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'ECO · RATES & MACRO'), h('span', { class: 'sub' }, 'U.S. Treasury · FRED (St. Louis Fed) · Nasdaq calendars · Federal Reserve')));
    const grid = h('div', { class: 'grid' });
    root.append(grid);
    const P = (title, c, opts) => {
      const p = panel({ title, ...opts });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const curveP = P('Treasury Yield Curve', 'c6');
    const histP = P('Treasury Yields — History', 'c6');
    const indP = P('Economic Indicators (FRED)', 'c12');
    const detailP = P('Indicator Detail', 'c12');
    detailP.el.hidden = true;
    const econP = P('Economic Calendar', 'c7', { bodyCls: 'flush' });
    const earnP = P('Earnings Calendar', 'c5', { bodyCls: 'flush' });
    const fedP = P('Federal Reserve Press Releases', 'c12', { bodyCls: 'flush scroll h300' });
    [curveP, histP, indP, econP, earnP, fedP].forEach((p) => loading(p.body));

    // ---- Treasury curve & history ----
    let histTenors = ['3 Mo', '2 Yr', '10 Yr', '30 Yr'];
    try {
      const y = await api.yields();
      if (!ctx.alive) return;
      const labels = y.tenors.map((t) => t.label);
      const short = labels.map((l) => l.replace(' Month', 'M').replace(' Mo', 'M').replace(' Yr', 'Y'));
      const ser = [
        { name: `Today ${y.latest.date}`, row: y.latest, color: HEX[0] },
        { name: `1M ago ${y.monthAgo?.date}`, row: y.monthAgo, color: HEX[1] },
        { name: `1Y ago ${y.yearAgo?.date}`, row: y.yearAgo, color: HEX[6] },
      ].filter((s) => s.row);
      const box = h('div');
      curveP.body.innerHTML = '';
      curveP.body.append(box);
      lineChart(box, {
        x: short,
        xType: 'category',
        series: ser.map((s) => ({ name: s.name, values: labels.map((l) => s.row.yields[l] ?? null), color: s.color, width: s.color === HEX[0] ? 2.2 : 1.5 })),
        height: 230,
        yFmt: (v) => v.toFixed(2) + '%',
        endLabels: true,
      });
      const tbl = h('div', { class: 'scroll' });
      const L = y.latest.yields;
      const chg = (row, k) => (row?.yields?.[k] != null && L[k] != null ? (L[k] - row.yields[k]) * 100 : null);
      tbl.innerHTML = `<table class="t compact"><thead><tr><th></th>${short.map((s) => `<th class="r">${s}</th>`).join('')}</tr></thead><tbody>
        <tr><td class="amber">Yield</td>${labels.map((l) => `<td class="r b">${num(L[l], 2)}</td>`).join('')}</tr>
        ${[['1D', y.previous], ['1W', y.weekAgo], ['1M', y.monthAgo], ['1Y', y.yearAgo]].map(([n, row]) => `<tr><td class="muted">Δ ${n}</td>${labels.map((l) => `<td class="r ${cls(chg(row, l))}">${chg(row, l) == null ? DASH : signed(chg(row, l), 0)}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`;
      curveP.body.append(tbl);
      const s210 = (L['10 Yr'] - L['2 Yr']) * 100;
      curveP.meta.innerHTML = `2s10s <b class="${cls(s210)}">${bp(s210)}</b> · ${s210 < 0 ? 'inverted' : 'positively sloped'}`;
      curveP.setFoot(`Source: <a href="${esc(y.sourceUrl)}" target="_blank" rel="noopener">${esc(y.source)}</a> · changes in basis points`);

      const drawHist = () => {
        const hist = y.history;
        const box2 = h('div');
        histP.body.innerHTML = '';
        histP.body.append(box2);
        const colors = { '3 Mo': HEX[3], '2 Yr': HEX[1], '10 Yr': HEX[0], '30 Yr': HEX[6] };
        lineChart(box2, {
          x: hist.map((r) => Date.parse(r.date + 'T12:00:00Z')),
          xType: 'time',
          series: histTenors.map((t) => ({ name: t.replace(' Mo', 'M').replace(' Yr', 'Y'), values: hist.map((r) => r[t] ?? null), color: colors[t] })),
          height: 230,
          yFmt: (v) => v.toFixed(2) + '%',
          endLabels: true,
        });
        const spread = hist.map((r) => (r['10 Yr'] != null && r['2 Yr'] != null ? (r['10 Yr'] - r['2 Yr']) * 100 : null));
        const box3 = h('div', { style: { marginTop: '6px' } });
        histP.body.append(h('div', { class: 'note' }, '10Y − 2Y spread (bp)'), box3);
        lineChart(box3, { x: hist.map((r) => Date.parse(r.date + 'T12:00:00Z')), xType: 'time', series: [{ name: '2s10s', values: spread, color: HEX[2], area: true, areaBase: 0 }], height: 110, yFmt: (v) => v.toFixed(0) + 'bp', zeroLine: true });
        histP.setFoot(`Daily par yields since ${y.history[0].date}`);
      };
      drawHist();
    } catch (err) {
      errorBox(curveP.body, err);
      errorBox(histP.body, err);
    }

    // ---- FRED indicators ----
    (async () => {
      try {
        const start = iso(new Date(Date.now() - 11 * 365 * 86400e3));
        const { series, errors } = await api.fred(IND.map((i) => i.id), start);
        if (!ctx.alive) return;
        const ok = IND.filter((i) => series[i.id]);
        if (!ok.length) {
          indP.body.innerHTML = `<div class="empty err">FRED is unreachable from this machine (${esc(Object.values(errors)[0] || 'no data')}). Treasury data above comes from treasury.gov directly. You can set FRED_API_KEY to use the official FRED API instead.</div>`;
          return;
        }
        const tiles = h('div', { class: 'tiles' });
        for (const ind of IND) {
          const s = series[ind.id];
          const tile = h('div', { class: 'tile', style: { cursor: s ? 'pointer' : 'default' }, title: s ? `${ind.id} — click for history` : errors[ind.id] });
          if (!s) {
            tile.innerHTML = `<div class="l">${esc(ind.name)}</div><div class="v muted">n/a</div><div class="s err">${esc(errors[ind.id] || '')}</div>`;
          } else {
            const pts = transform(s.points, ind.tf);
            const last = pts.at(-1);
            const prev = pts.at(-2);
            const d = last && prev ? last.value - prev.value : null;
            const recent = pts.slice(-Math.min(pts.length, ind.tf === 'level' && s.points.length > 1500 ? 260 : 36));
            tile.innerHTML = `<div class="l">${esc(ind.name)}</div><div class="v">${fmtVal(last?.value, ind.unit)}</div>
              <div class="s"><span class="${cls(d)}">${d == null ? '' : (d >= 0 ? '+' : '−') + fmtVal(Math.abs(d), ind.unit)}</span> <span class="muted">${esc(date(last?.date))}</span></div>
              ${sparkline(recent.map((p) => p.value), { w: 150, h: 26, color: 'var(--s1)' })}`;
            tile.addEventListener('click', () => showDetail(ind, s, pts));
          }
          tiles.append(tile);
        }
        indP.body.innerHTML = '';
        indP.body.append(tiles);
        indP.setFoot('Source: FRED®, Federal Reserve Bank of St. Louis — click a tile for full history. Change shown vs the prior observation.');
      } catch (err) {
        errorBox(indP.body, err);
      }
    })();

    function showDetail(ind, s, pts) {
      detailP.el.hidden = false;
      detailP.el.querySelector('h2').textContent = `${ind.name} · ${ind.id}`;
      detailP.meta.innerHTML = `<a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">fred.stlouisfed.org ›</a>`;
      const box = h('div');
      detailP.body.innerHTML = '';
      detailP.body.append(box);
      lineChart(box, { x: pts.map((p) => Date.parse(p.date + 'T12:00:00Z')), xType: 'time', series: [{ name: ind.name, values: pts.map((p) => p.value), color: HEX[0], area: true }], height: 260, yFmt: (v) => fmtVal(v, ind.unit), zeroLine: true });
      detailP.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ---- calendars ----
    const mkDateNav = (onChange) => {
      let d = new Date();
      const label = h('span', { class: 'amber b' });
      const set = (delta) => {
        // Step over weekends (no releases or earnings on Saturday/Sunday).
        if (delta) do d = new Date(d.getTime() + delta * 86400e3); while (d.getDay() === 0 || d.getDay() === 6);
        label.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        onChange(iso(new Date(d.getTime() - d.getTimezoneOffset() * 60000)));
      };
      const el = h('span', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => set(-1) }, '‹'), label, h('button', { class: 'btn sm', onclick: () => set(1) }, '›'));
      return { el, init: () => set(0) };
    };
    let country = 'United States';
    let econRows = [];
    const drawEcon = () => {
      const rows = country === 'all' ? econRows : econRows.filter((r) => r.country === country);
      econP.body.innerHTML = rows.length
        ? `<div class="scroll h420"><table class="t compact"><thead><tr><th>Time ET</th><th>Country</th><th>Event</th><th class="r">Actual</th><th class="r">Consensus</th><th class="r">Previous</th></tr></thead><tbody>${rows
            .map((r) => `<tr><td class="muted">${esc(r.timeGMT)}</td><td class="dim">${esc(r.country)}</td><td class="wrap">${esc(r.event)}</td><td class="r b">${esc(r.actual) || DASH}</td><td class="r">${esc(r.consensus) || DASH}</td><td class="r dim">${esc(r.previous) || DASH}</td></tr>`)
            .join('')}</tbody></table></div>`
        : '<div class="empty">No events</div>';
    };
    const econNav = mkDateNav(async (d) => {
      loading(econP.body);
      try {
        econRows = (await api.economic(d)).rows;
        if (ctx.alive) drawEcon();
      } catch (err) {
        errorBox(econP.body, err);
      }
    });
    econP.meta.append(econNav.el, seg([{ value: 'United States', label: 'US' }, { value: 'all', label: 'All' }], country, (v) => {
      country = v;
      drawEcon();
    }));
    econP.setFoot('Source: Nasdaq economic calendar');
    econNav.init();

    const earnNav = mkDateNav(async (d) => {
      loading(earnP.body);
      try {
        const e = await api.earnings(d);
        if (!ctx.alive) return;
        earnP.body.innerHTML = e.rows.length
          ? `<div class="scroll h420"><table class="t compact"><thead><tr><th>Ticker</th><th>Company</th><th>When</th><th class="r">EPS est.</th><th class="r">Yr-ago EPS</th><th class="r">Mkt cap</th></tr></thead><tbody>${e.rows
              .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
              .map((r) => `<tr class="click" data-sym="${esc(r.symbol)}"><td class="sym">${esc(r.symbol)}</td><td class="nm">${esc(r.name)}</td><td class="muted" title="BMO = before market open, AMC = after market close">${esc(r.time)}</td><td class="r">${r.epsForecast != null ? '$' + num(r.epsForecast) : DASH}</td><td class="r dim">${r.lastYearEPS != null ? '$' + num(r.lastYearEPS) : DASH}</td><td class="r">${big(r.marketCap, 1)}</td></tr>`)
              .join('')}</tbody></table></div>`
          : '<div class="empty">No earnings scheduled</div>';
      } catch (err) {
        errorBox(earnP.body, err);
      }
    });
    earnP.meta.append(earnNav.el);
    earnP.setFoot('Source: Nasdaq earnings calendar (BMO = before open, AMC = after close)');
    linkRows(earnP.body, ctx.navigate);
    earnNav.init();

    try {
      const n = await api.news('fed', 30);
      if (ctx.alive) fedP.body.innerHTML = newsList(n.items);
    } catch (err) {
      errorBox(fedP.body, err);
    }
  },
};
