// PSIM — portfolio simulation: historical risk/return statistics, correlations, backtest,
// efficient frontier (long-only) and Monte Carlo projection.
import { api } from '../api.js';
import { h, panel, loading, errorBox, seg, toast } from '../dom.js';
import { esc, num, pctf, money, int, DASH } from '../fmt.js';
import { lineChart, scatterChart, columnChart, HEX, divergingColor, compactNum } from '../charts.js';
import { state, holdingsBySymbol, saveInputs, savedInputs } from '../state.js';
import * as S from '../lib/stats.js';

const DEFAULTS = {
  assets: [
    { s: 'VTI', w: 60 },
    { s: 'VXUS', w: 20 },
    { s: 'BND', w: 20 },
  ],
  lookback: '5y',
  benchmark: 'SPY',
  rf: '',
  maxW: 100,
  initial: 100000,
  monthly: 1000,
  years: 20,
  sims: 2000,
  method: 'gbm',
  inflation: 2.5,
  target: 1000000,
  expOverride: '',
};

export default {
  id: 'psim',
  title: 'Portfolio Simulator',
  async mount(root, { query }, ctx) {
    const cfg = { ...DEFAULTS, ...(savedInputs('psim') || {}) };
    if (query.get('s')) {
      const syms = query.get('s').toUpperCase().split(',').filter(Boolean);
      cfg.assets = syms.map((s) => ({ s, w: +(100 / syms.length).toFixed(2) }));
    }
    let rfDefault = 0.04;
    api.yields().then((y) => {
      rfDefault = (y.latest.yields['3 Mo'] ?? 4) / 100;
      rfIn.placeholder = `${(rfDefault * 100).toFixed(2)} (3M T-bill)`;
    }).catch(() => {});

    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'PSIM · PORTFOLIO SIMULATOR'), h('span', { class: 'sub' }, 'Historical statistics from daily total-return prices · long-only optimisation · Monte Carlo')));
    const left = h('div', { class: 'stack-col c4' });
    const right = h('div', { class: 'stack-col c8' });
    const grid = h('div', { class: 'grid' }, left, right);
    root.append(grid);
    const P = (title, c, opts) => {
      const p = panel({ title, ...opts });
      if (c instanceof Node) c.append(p.el);
      else {
        p.el.classList.add(c);
        grid.append(p.el);
      }
      return p;
    };
    const inP = P('Portfolio', left);
    const statsP = P('Portfolio Statistics', right);
    const assetsP = P('Asset Statistics', right, { bodyCls: 'flush scroll' });
    const corrP = P('Correlation Matrix (daily returns)', right);
    const btP = P('Backtest — Growth & Drawdown', 'c7');
    const frP = P('Efficient Frontier (long-only)', 'c5');
    const mcP = P('Monte Carlo Projection', 'c8');
    const mcSumP = P('Projection Summary', 'c4', { bodyCls: 'flush' });

    // ---- inputs ----
    const rowsBox = h('div');
    const rfIn = h('input', { class: 'in num', type: 'number', step: 'any', value: cfg.rf, placeholder: '3M T-bill' });
    const field = (label, el, hint) => h('label', {}, label, el, hint ? h('span', { class: 'hint' }, hint) : null);
    const numIn = (v, step = 'any') => h('input', { class: 'in num', type: 'number', step, value: String(v) });
    const benchIn = h('input', { class: 'in', value: cfg.benchmark });
    const maxWIn = numIn(cfg.maxW);
    const initIn = numIn(cfg.initial);
    const monthlyIn = numIn(cfg.monthly);
    const yearsIn = numIn(cfg.years, '1');
    const infIn = numIn(cfg.inflation);
    const targetIn = numIn(cfg.target);
    const expIn = h('input', { class: 'in num', type: 'number', step: 'any', value: cfg.expOverride, placeholder: 'historical' });
    const simsSel = h('select', { class: 'in' }, ...[1000, 2000, 5000].map((n) => h('option', { value: n, selected: n === Number(cfg.sims) }, `${n}`)));
    const methodSel = h('select', { class: 'in' }, h('option', { value: 'gbm', selected: cfg.method === 'gbm' }, 'Lognormal (GBM)'), h('option', { value: 'bootstrap', selected: cfg.method === 'bootstrap' }, 'Historical bootstrap'));
    const lbSeg = seg(['1y', '3y', '5y', '10y'].map((v) => ({ value: v, label: v.toUpperCase() })), cfg.lookback, (v) => (cfg.lookback = v));

    function drawRows() {
      rowsBox.innerHTML = '';
      const total = cfg.assets.reduce((s, a) => s + (Number(a.w) || 0), 0);
      cfg.assets.forEach((a, i) => {
        const sIn = h('input', { class: 'in', value: a.s, style: { width: '90px' }, oninput: (e) => (a.s = e.target.value.toUpperCase().trim()) });
        const wIn = h('input', { class: 'in num', type: 'number', step: 'any', value: String(a.w), style: { width: '80px' }, oninput: (e) => {
          a.w = Number(e.target.value) || 0;
          totalEl.textContent = `Total ${num(cfg.assets.reduce((s, x) => s + (Number(x.w) || 0), 0), 1)}%`;
        } });
        rowsBox.append(h('div', { class: 'row', style: { marginBottom: '3px' } }, h('span', { class: 'muted', style: { width: '16px' } }, String(i + 1)), sIn, wIn, h('span', { class: 'muted' }, '%'), h('button', { class: 'btn sm danger', onclick: () => {
          cfg.assets.splice(i, 1);
          drawRows();
        } }, '✕')));
      });
      const totalEl = h('span', { class: Math.abs(total - 100) > 0.01 ? 'warn' : 'muted' }, `Total ${num(total, 1)}%`);
      rowsBox.append(h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { class: 'btn sm', onclick: () => {
        if (cfg.assets.length >= 20) return toast('Up to 20 assets', true);
        cfg.assets.push({ s: '', w: 0 });
        drawRows();
      } }, '+ Asset'), h('button', { class: 'btn sm', onclick: () => {
        cfg.assets.forEach((a) => (a.w = +(100 / cfg.assets.length).toFixed(2)));
        drawRows();
      } }, 'Equal'), h('button', { class: 'btn sm', onclick: () => {
        const t = cfg.assets.reduce((s, a) => s + (Number(a.w) || 0), 0) || 1;
        cfg.assets.forEach((a) => (a.w = +((a.w / t) * 100).toFixed(2)));
        drawRows();
      } }, 'Normalise'), h('button', { class: 'btn sm', onclick: loadMine }, 'Load my portfolio'), h('span', { class: 'spacer' }), totalEl));
    }
    async function loadMine() {
      const hs = holdingsBySymbol(state().positions);
      if (!hs.length) return toast('No positions in PORT yet', true);
      const { quotes } = await api.quotes(hs.map((x) => x.symbol));
      const vals = hs.map((x) => ({ s: x.symbol, v: (quotes[x.symbol]?.price ?? x.avgCost) * x.shares })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 20);
      const t = vals.reduce((s, x) => s + x.v, 0);
      cfg.assets = vals.map((x) => ({ s: x.s, w: +((x.v / t) * 100).toFixed(2) }));
      initIn.value = String(Math.round(t + state().cash.reduce((s, c) => s + c.amount, 0)));
      drawRows();
    }
    drawRows();
    inP.body.append(
      rowsBox,
      h('hr', { class: 'sep' }),
      h('div', { class: 'form' },
        field('Lookback', lbSeg),
        field('Benchmark', benchIn),
        field('Risk-free rate %', rfIn, 'blank = current 3M T-bill'),
        field('Max weight / asset %', maxWIn, 'optimiser constraint'),
      ),
      h('hr', { class: 'sep' }),
      h('div', { class: 'form' },
        field('Starting value $', initIn),
        field('Monthly contribution $', monthlyIn),
        field('Horizon (years)', yearsIn),
        field('Target value $', targetIn),
        field('Expected return % (ann.)', expIn, 'blank = historical mean'),
        field('Inflation %', infIn),
        field('Simulations', simsSel),
        field('Method', methodSel),
      ),
      h('div', { class: 'row end', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: () => run() }, 'RUN SIMULATION')),
    );
    for (const p of [statsP, assetsP, corrP, btP, frP, mcP, mcSumP]) p.body.innerHTML = '<div class="empty">Set weights and press RUN SIMULATION</div>';

    let last = null; // cached analysis for re-running Monte Carlo with optimal weights

    async function run(overrideWeights) {
      cfg.assets = cfg.assets.filter((a) => a.s);
      if (overrideWeights) {
        cfg.assets.forEach((a, i) => (a.w = +(overrideWeights[i] * 100).toFixed(2)));
        drawRows();
      }
      Object.assign(cfg, {
        benchmark: benchIn.value.toUpperCase().trim() || 'SPY',
        rf: rfIn.value,
        maxW: Number(maxWIn.value) || 100,
        initial: Number(initIn.value) || 0,
        monthly: Number(monthlyIn.value) || 0,
        years: Math.min(60, Math.max(1, Number(yearsIn.value) || 20)),
        inflation: Number(infIn.value) || 0,
        target: Number(targetIn.value) || 0,
        expOverride: expIn.value,
        sims: Number(simsSel.value),
        method: methodSel.value,
      });
      saveInputs('psim', cfg);
      const syms = [...new Set(cfg.assets.map((a) => a.s))];
      if (!syms.length) return toast('Add at least one asset', true);
      const wsum = cfg.assets.reduce((s, a) => s + (Number(a.w) || 0), 0);
      if (wsum <= 0) return toast('Weights must sum to more than 0', true);
      const weights = syms.map((s) => cfg.assets.filter((a) => a.s === s).reduce((t, a) => t + (Number(a.w) || 0), 0) / wsum);
      const rf = cfg.rf !== '' ? Number(cfg.rf) / 100 : rfDefault;
      for (const p of [statsP, assetsP, corrP, btP, frP, mcP, mcSumP]) loading(p.body, 'Fetching price history');
      let hist;
      try {
        hist = await api.history([...syms, cfg.benchmark], cfg.lookback);
      } catch (err) {
        for (const p of [statsP, assetsP, corrP, btP, frP, mcP, mcSumP]) errorBox(p.body, err);
        return;
      }
      if (!ctx.alive) return;
      const missing = syms.filter((s) => !hist.series[s]);
      if (missing.length) toast(`No history for ${missing.join(', ')}: ${Object.values(hist.errors)[0] || ''}`, true);
      const useSyms = syms.filter((s) => hist.series[s]);
      const useW = useSyms.map((s) => weights[syms.indexOf(s)]);
      const wt = useW.reduce((a, b) => a + b, 0);
      const w = useW.map((x) => x / wt);
      if (!useSyms.length) return;
      const bench = hist.series[cfg.benchmark] ? cfg.benchmark : null;
      const al = S.alignSeries(Object.fromEntries([...useSyms, ...(bench ? [bench] : [])].map((s) => [s, hist.series[s]])));
      if (al.dates.length < 60) {
        for (const p of [statsP, assetsP, corrP, btP, frP]) errorBox(p.body, 'Less than 60 overlapping trading days — choose a shorter lookback or different assets (newer funds limit the window).');
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
      const R = useSyms.map((s) => S.toReturns(al.prices[s]));
      const RB = bench ? S.toReturns(al.prices[bench]) : null;
      const pr = S.portfolioReturns(R, w);
      const dates = al.dates.slice(1);
      const ps = S.returnStats(pr, { rf, benchmark: RB });
      const bs = RB ? S.returnStats(RB, { rf }) : null;
      const mu = R.map((r) => S.mean(r) * 252);
      const cov = S.covMatrix(R).map((row) => row.map((v) => v * 252));
      const corr = S.corrMatrix(R);
      const pv = S.portVariance(w, cov);
      const rc = w.map((wi, i) => (wi * cov[i].reduce((s, c, j) => s + c * w[j], 0)) / pv);
      last = { useSyms, w, mu, cov, rf, pr, dates, ps };
      const notAdj = useSyms.filter((s) => !hist.series[s].adjusted);
      const window = `${al.dates[0]} → ${al.dates.at(-1)} · ${int(pr.length)} trading days`;

      // stats tiles
      const tile = (l, v, s, c = '') => `<div class="tile"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
      statsP.body.innerHTML = `<div class="tiles">${[
        tile('Expected return', pctf(ps.expectedReturn, 2), 'annualised arithmetic mean'),
        tile('CAGR', pctf(ps.cagr, 2), bs ? `${esc(bench)} ${pctf(bs.cagr, 2)}` : 'realised compound growth', ps.cagr >= 0 ? 'up' : 'down'),
        tile('Std deviation', pctf(ps.volatility, 2), bs ? `${esc(bench)} ${pctf(bs.volatility, 2)}` : 'annualised volatility'),
        tile('Sharpe ratio', num(ps.sharpe, 2), bs ? `${esc(bench)} ${num(bs.sharpe, 2)}` : `rf ${pctf(rf, 2)}`),
        tile('Sortino ratio', num(ps.sortino, 2), 'downside-risk adjusted'),
        tile('Max drawdown', pctf(ps.maxDrawdown, 1), bs ? `${esc(bench)} ${pctf(bs.maxDrawdown, 1)}` : '', 'down'),
        tile('Beta', ps.beta != null ? num(ps.beta, 2) : DASH, bench ? `vs ${esc(bench)} · ρ ${num(ps.correlation, 2)}` : ''),
        tile('Alpha (Jensen)', ps.alpha != null ? pctf(ps.alpha, 2, { sign: true }) : DASH, ps.informationRatio != null ? `IR ${num(ps.informationRatio, 2)} · TE ${pctf(ps.trackingError, 1)}` : ''),
        tile('1-day VaR 95%', pctf(ps.var95, 2), `${money(ps.var95 * cfg.initial, 0)} on ${money(cfg.initial, 0)}`),
        tile('1-day CVaR 95%', pctf(ps.cvar95, 2), `expected loss beyond VaR`),
        tile('1-month VaR 95%', pctf(S.parametricVaR(ps.expectedReturn / 12, ps.volatility / Math.sqrt(12), 0.95), 2), 'parametric (normal)'),
        tile('Calmar ratio', num(ps.calmar, 2), `best day ${pctf(ps.best, 1)} · worst ${pctf(ps.worst, 1)}`),
      ].join('')}</div>`;
      statsP.setFoot(`${window} · daily rebalanced to target weights${notAdj.length ? ` · ${esc(notAdj.join(', '))}: price-only (dividends excluded)` : ' · dividend-adjusted'}`);

      // asset table
      assetsP.body.innerHTML = `<table class="t compact"><thead><tr><th>Asset</th><th class="r">Weight</th><th class="r">Ann. return</th><th class="r">Volatility</th><th class="r">Sharpe</th><th class="r">Max DD</th><th class="r">Beta</th><th class="r" title="Share of portfolio variance contributed by this asset">Risk contrib.</th></tr></thead><tbody>${useSyms
        .map((s, i) => {
          const st = S.returnStats(R[i], { rf, benchmark: RB });
          return `<tr class="click" data-sym="${esc(s)}"><td class="sym" style="color:${HEX[i % 8]}">${esc(s)}</td><td class="r">${pctf(w[i], 1)}</td><td class="r">${pctf(st.expectedReturn, 1)}</td><td class="r">${pctf(st.volatility, 1)}</td><td class="r">${num(st.sharpe, 2)}</td><td class="r down">${pctf(st.maxDrawdown, 1)}</td><td class="r">${st.beta != null ? num(st.beta, 2) : DASH}</td><td class="r"><div class="row" style="justify-content:flex-end;gap:4px"><div class="wbar" style="width:${Math.max(0, rc[i]) * 60}px"></div>${pctf(rc[i], 1)}</div></td></tr>`;
        })
        .join('')}</tbody></table>`;
      assetsP.body.onclick = (e) => {
        const tr = e.target.closest('[data-sym]');
        if (tr) ctx.navigate(`#/eq/${encodeURIComponent(tr.dataset.sym)}`);
      };

      // correlation heatmap
      corrP.body.innerHTML = `<div class="scroll"><table class="t compact"><thead><tr><th></th>${useSyms.map((s) => `<th class="c">${esc(s)}</th>`).join('')}</tr></thead><tbody>${useSyms
        .map((a, i) => `<tr><td class="sym">${esc(a)}</td>${useSyms.map((b, j) => `<td class="c" style="background:${divergingColor(corr[i][j])};color:#fff" title="${esc(a)} / ${esc(b)}: ${num(corr[i][j], 2)}">${num(corr[i][j], 2)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
      corrP.setFoot('Blue = move together (+1), grey = unrelated (0), red = move opposite (−1). Lower correlations diversify.');

      // backtest
      const growth = S.growthSeries(pr, cfg.initial || 10000);
      const x = al.dates.map((d) => Date.parse(d + 'T12:00:00Z'));
      const box1 = h('div');
      const box2 = h('div', { style: { marginTop: '4px' } });
      btP.body.innerHTML = '';
      btP.body.append(box1, h('div', { class: 'note' }, 'Drawdown from previous peak'), box2);
      const series = [{ name: 'Portfolio', values: growth, color: HEX[0] }];
      if (RB) series.push({ name: bench, values: S.growthSeries(RB, cfg.initial || 10000), color: HEX[1] });
      lineChart(box1, { x, xType: 'time', series, height: 230, yFmt: (v) => '$' + compactNum(v), tipFmt: (v) => money(v, 0), endLabels: true });
      const dd = [{ name: 'Portfolio', values: S.drawdowns(growth).map((v) => v * 100), color: HEX[0], area: true, areaBase: 0 }];
      if (RB) dd.push({ name: bench, values: S.drawdowns(S.growthSeries(RB)).map((v) => v * 100), color: HEX[1] });
      lineChart(box2, { x, xType: 'time', series: dd, height: 120, yFmt: (v) => v.toFixed(0) + '%', tipFmt: (v) => v.toFixed(1) + '%', legend: false });
      btP.setFoot(`Growth of ${money(cfg.initial || 10000, 0)} · ${window}`);

      // efficient frontier
      loading(frP.body, 'Optimising');
      await new Promise((r) => setTimeout(r, 10));
      if (useSyms.length >= 2) {
        const maxWeight = Math.min(1, Math.max(1 / useSyms.length, cfg.maxW / 100));
        const cloud = S.randomPortfolios(mu, cov, { count: 2500, rf });
        const ms = S.maxSharpe(mu, cov, { rf, maxWeight });
        const mv = S.minVolatility(mu, cov, { rf, maxWeight });
        const fr = S.efficientFrontier(mu, cov, { rf, maxWeight, points: 16 });
        const cur = S.evaluate(w, mu, cov, rf);
        const maxS = Math.max(...cloud.map((c) => c.sharpe));
        const minS = Math.min(...cloud.map((c) => c.sharpe));
        const box = h('div');
        frP.body.innerHTML = '';
        frP.body.append(box);
        scatterChart(box, {
          cloud: cloud.map((p) => ({ x: p.vol, y: p.ret, c: (p.sharpe - minS) / (maxS - minS || 1), w: p.w })),
          cloudColor: (t) => `rgba(57,135,229,${0.15 + 0.6 * t})`,
          line: fr.map((p) => ({ x: p.vol, y: p.ret })),
          marks: [
            ...useSyms.map((s, i) => ({ x: Math.sqrt(cov[i][i]), y: mu[i], label: s, color: 'var(--muted)', r: 3.5 })),
            { x: mv.vol, y: mv.ret, label: 'Min vol', color: HEX[2], w: mv.w },
            { x: ms.vol, y: ms.ret, label: 'Max Sharpe', color: HEX[3], w: ms.w },
            { x: cur.vol, y: cur.ret, label: 'Current', color: HEX[1], w: cur.w },
          ],
          xFmt: (v) => (v * 100).toFixed(0) + '%',
          yFmt: (v) => (v * 100).toFixed(1) + '%',
          xLabel: 'Volatility (annualised)',
          height: 290,
          legendItems: [{ name: 'Random portfolios (darker = higher Sharpe)', color: HEX[0], box: true }, { name: 'Efficient frontier', color: 'var(--amber)' }],
          tipExtra: (p) => (p.w ? `<div class="muted">${p.w.map((x, i) => (x > 0.005 ? `${esc(useSyms[i])} ${(x * 100).toFixed(0)}%` : '')).filter(Boolean).join(' · ')}</div>` : ''),
        });
        const wtRow = (name, p) => `<tr><td class="amber">${name}</td>${p.w.map((x) => `<td class="r">${(x * 100).toFixed(1)}</td>`).join('')}<td class="r">${pctf(p.ret, 1)}</td><td class="r">${pctf(p.vol, 1)}</td><td class="r">${num(p.sharpe, 2)}</td></tr>`;
        const tbl = h('div', { class: 'scroll', html: `<table class="t compact"><thead><tr><th>Weights %</th>${useSyms.map((s) => `<th class="r">${esc(s)}</th>`).join('')}<th class="r">Ret</th><th class="r">Vol</th><th class="r">Sharpe</th></tr></thead><tbody>${wtRow('Current', cur)}${wtRow('Max Sharpe', ms)}${wtRow('Min vol', mv)}</tbody></table>` });
        frP.body.append(tbl, h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { class: 'btn sm', onclick: () => run(ms.w) }, 'Use max-Sharpe weights'), h('button', { class: 'btn sm', onclick: () => run(mv.w) }, 'Use min-vol weights')));
        frP.setFoot(`Mean-variance optimisation on historical returns · max ${num(maxWeight * 100, 0)}% per asset. Historical means are noisy estimates of future returns — treat optimal weights as illustrative.`);
      } else frP.body.innerHTML = '<div class="empty">Add at least two assets for an efficient frontier.</div>';

      runMC();
    }

    function runMC() {
      if (!last) return;
      const { ps, pr, dates } = last;
      const exp = cfg.expOverride !== '' ? Number(cfg.expOverride) / 100 : ps.expectedReturn;
      const monthly = S.monthlyReturns(pr, dates);
      const mc = S.monteCarlo({
        initial: cfg.initial,
        monthlyContribution: cfg.monthly,
        years: cfg.years,
        annualReturn: exp,
        annualVol: ps.volatility,
        sims: cfg.sims,
        method: cfg.method,
        history: monthly,
        inflation: cfg.inflation / 100,
        target: cfg.target || null,
      });
      const yrsX = mc.bands.map((b) => b.month / 12);
      const box = h('div');
      mcP.body.innerHTML = '';
      mcP.body.append(box);
      const every = Math.max(1, Math.floor(mc.bands.length / 240));
      const pick = (arr) => arr.filter((_, i) => i % every === 0 || i === arr.length - 1);
      const B = pick(mc.bands);
      lineChart(box, {
        x: pick(yrsX),
        xType: 'number',
        xFmt: (v) => `${v.toFixed(0)}y`,
        tipXFmt: (v) => `Year ${v.toFixed(1)}`,
        bands: [
          { lo: B.map((b) => b.p5), hi: B.map((b) => b.p95), color: HEX[0], opacity: 0.14, name: '5th–95th pct' },
          { lo: B.map((b) => b.p25), hi: B.map((b) => b.p75), color: HEX[0], opacity: 0.28, name: '25th–75th pct' },
        ],
        series: [
          { name: 'Median', values: B.map((b) => b.p50), color: HEX[0], width: 2 },
          { name: 'Contributions only', values: B.map((b) => cfg.initial + cfg.monthly * b.month), color: 'var(--muted)', dash: true, width: 1.2 },
        ],
        refY: cfg.target ? { value: cfg.target, label: `Target ${money(cfg.target, 0)}` } : null,
        height: 280,
        yFmt: (v) => '$' + compactNum(v),
        tipFmt: (v) => money(v, 0),
      });
      const hist = S.histogram(mc.finals.filter((v) => v <= mc.summary.p95 * 1.5), 30);
      const hbox = h('div', { style: { marginTop: '6px' } });
      mcP.body.append(h('div', { class: 'note' }, 'Distribution of ending values'), hbox);
      columnChart(hbox, { labels: hist.map((b) => '$' + compactNum(b.x0)), tipLabels: hist.map((b) => `${money(b.x0, 0)} – ${money(b.x1, 0)}`), series: [{ name: 'Simulations', values: hist.map((b) => b.count), color: HEX[0] }], height: 120, yFmt: (v) => String(Math.round(v)) });
      mcP.setFoot(`${mc.method === 'bootstrap' ? 'Block bootstrap of historical monthly returns' : `Lognormal monthly returns · μ ${pctf(exp, 2)} · σ ${pctf(ps.volatility, 2)}`} · ${int(cfg.sims)} paths · ${cfg.years} years · seeded (repeatable)`);
      const r = (l, v, c = '') => `<tr><td class="muted">${l}</td><td class="r b ${c}">${v}</td></tr>`;
      mcSumP.body.innerHTML = `<table class="t compact">
        ${r('Total contributed', money(mc.totalContributed, 0))}
        ${r('Median ending value', money(mc.summary.p50, 0), 'amber')}
        ${r('  in today\'s dollars', money(mc.summaryReal.p50, 0))}
        ${r('Pessimistic (5th pct)', money(mc.summary.p5, 0), 'down')}
        ${r('Cautious (25th pct)', money(mc.summary.p25, 0))}
        ${r('Optimistic (75th pct)', money(mc.summary.p75, 0))}
        ${r('Very good (95th pct)', money(mc.summary.p95, 0), 'up')}
        ${r('Mean ending value', money(mc.mean, 0))}
        ${cfg.target ? r(`P(reach ${money(cfg.target, 0)})`, pctf(mc.probTarget, 1), mc.probTarget >= 0.5 ? 'up' : 'down') : ''}
        ${r('P(end below contributions)', pctf(mc.probLoss, 1), mc.probLoss > 0.1 ? 'down' : '')}
      </table>`;
      mcSumP.setFoot(`Inflation ${num(cfg.inflation, 1)}% for real values. Projections are not predictions.`);
    }

    if (query.get('s') || savedInputs('psim')) run();
  },
};
