// OVLP — ETF overlap calculator & look-through exposure.
import { api } from '../api.js';
import { h, panel, loading, errorBox, toast } from '../dom.js';
import { esc, num, int, safeUrl, DASH } from '../fmt.js';
import { HEX, sequentialColor, resolveVars } from '../charts.js';
import { state, holdingsBySymbol, saveInputs, savedInputs } from '../state.js';
import { overlapMatrix, overlapPair, lookThrough, resolveKeys } from '../lib/overlap.js';
import { valuePortfolio } from '../valuation.js';

const MAX = 6;

function venn(a, b, o) {
  // Two circles sized by holdings count; labels sit outside the circles so they never collide.
  const W = 420;
  const H = 170;
  const big = Math.max(o.countA, o.countB, 1);
  const ra = 22 + 52 * Math.sqrt(o.countA / big);
  const rb = 22 + 52 * Math.sqrt(o.countB / big);
  const share = o.commonCount / Math.max(1, Math.min(o.countA, o.countB));
  const d = (ra + rb) * (1 - 0.85 * share) + Math.abs(ra - rb) * 0.85 * share;
  const cx = W / 2 + (ra - rb) / 2;
  const xa = cx - d / 2;
  const xb = cx + d / 2;
  const lensX = Math.max(xb - rb, xa - ra) / 2 + Math.min(xa + ra, xb + rb) / 2;
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(a)} and ${esc(b)} holdings overlap">
    <circle cx="${xa}" cy="${H / 2}" r="${ra}" fill="${HEX[0]}" fill-opacity=".32" stroke="${HEX[0]}" stroke-width="1.5"/>
    <circle cx="${xb}" cy="${H / 2}" r="${rb}" fill="${HEX[1]}" fill-opacity=".32" stroke="${HEX[1]}" stroke-width="2" stroke-opacity=".9"/>
    <text class="lbl-strong" x="${xa - ra - 8}" y="${H / 2 - 4}" text-anchor="end">${esc(a)}</text>
    <text class="lbl" x="${xa - ra - 8}" y="${H / 2 + 12}" text-anchor="end">${int(o.countA - o.commonCount)} only</text>
    <text class="lbl-strong" x="${xb + rb + 8}" y="${H / 2 - 4}">${esc(b)}</text>
    <text class="lbl" x="${xb + rb + 8}" y="${H / 2 + 12}">${int(o.countB - o.commonCount)} only</text>
    <text class="lbl-strong" x="${lensX}" y="${H / 2 + 1}" text-anchor="middle">${int(o.commonCount)}</text>
    <text class="lbl" x="${lensX}" y="${H / 2 + 14}" text-anchor="middle">common</text>
  </svg>`;
}

export default {
  id: 'ovlp',
  title: 'ETF Overlap',
  async mount(root, { query }, ctx) {
    const saved = savedInputs('ovlp') || {};
    let funds = (query.get('f') || saved.funds?.join(',') || 'SPY,QQQ').toUpperCase().split(',').filter(Boolean).slice(0, MAX);
    let alloc = query.get('w') ? query.get('w').split(',').map(Number) : saved.alloc && saved.funds?.join() === funds.join() ? saved.alloc : funds.map(() => 1);
    let data = {};
    let pair = [0, 1];

    const chips = h('div', { class: 'chips' });
    const input = h('input', { class: 'in', placeholder: 'add ETF (e.g. VTI)', style: { width: '150px' } });
    const addFund = () => {
      const syms = input.value.toUpperCase().split(/[\s,]+/).filter(Boolean);
      input.value = '';
      for (const s of syms) if (!funds.includes(s) && funds.length < MAX) {
        funds.push(s);
        alloc.push(1);
      }
      drawChips();
      run();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && addFund());
    function drawChips() {
      chips.innerHTML = '';
      funds.forEach((f, i) => {
        const w = h('input', { class: 'in num', type: 'number', min: '0', step: 'any', value: String(alloc[i] ?? 1), style: { width: '64px' }, title: 'Allocation for look-through (relative weight or $)' });
        w.addEventListener('change', () => {
          alloc[i] = Math.max(0, Number(w.value) || 0);
          drawLookThrough();
          persist();
        });
        chips.append(
          h('span', { class: 'chip', style: { borderColor: HEX[i] } }, h('b', { style: { color: HEX[i] } }, f), w, h('button', { title: `Remove ${f}`, onclick: () => {
            funds.splice(i, 1);
            alloc.splice(i, 1);
            drawChips();
            run();
          } }, '✕')),
        );
      });
    }
    const persist = () => saveInputs('ovlp', { funds, alloc });
    const loadMine = async () => {
      const st = state();
      const etfs = new Set(holdingsBySymbol(st.positions).filter((x) => ['ETF', 'Fund'].includes(x.assetClass)).map((x) => x.symbol));
      if (!etfs.size) return toast('No ETF/Fund positions in your portfolio (set asset class to ETF)', true);
      const v = await valuePortfolio({ ...st, positions: st.positions.filter((p) => etfs.has(p.symbol)), cash: [] });
      const rows = Object.entries(v.bySymbol).sort((a, b) => b[1] - a[1]).slice(0, MAX);
      funds = rows.map(([sym]) => sym);
      alloc = rows.map(([, x]) => Math.round(x));
      drawChips();
      run();
    };

    root.append(
      h('div', { class: 'screen-title' }, h('h1', {}, 'OVLP · ETF OVERLAP'), h('span', { class: 'sub' }, 'Holdings from issuer files (SSGA daily) or SEC N-PORT filings')),
      h('div', { class: 'panel', style: { marginBottom: '6px' } }, h('div', { class: 'bd row' }, h('span', { class: 'muted' }, 'FUNDS & ALLOCATION'), chips, input, h('button', { class: 'btn', onclick: addFund }, 'Add'), h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: loadMine }, 'Load my ETFs'), h('button', { class: 'btn primary', onclick: () => run() }, 'Compare'))),
    );
    const grid = h('div', { class: 'grid' });
    root.append(grid);
    const P = (title, c, opts) => {
      const p = panel({ title, ...opts });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const fundsP = P('Funds', 'c7', { bodyCls: 'flush' });
    const matrixP = P('Overlap Matrix — % of portfolio in common', 'c5');
    const pairP = P('Pair Detail', 'c12');
    const ltP = P('Look-through Exposure (combined by allocation)', 'c12');
    drawChips();

    function drawFunds() {
      fundsP.body.innerHTML = `<table class="t compact"><thead><tr><th>Fund</th><th>Name</th><th class="r">Holdings</th><th class="r">Top 10</th><th>As of</th><th>Source</th></tr></thead><tbody>${funds
        .map((f, i) => {
          const d = data[f];
          if (!d) return `<tr><td class="sym" style="color:${HEX[i]}">${esc(f)}</td><td colspan="5" class="muted"><span class="loading">loading holdings</span></td></tr>`;
          if (d.error) return `<tr><td class="sym" style="color:${HEX[i]}">${esc(f)}</td><td colspan="5" class="err wrap">${esc(d.error)}</td></tr>`;
          const top10 = d.holdings.slice(0, 10).reduce((s, x) => s + x.weight, 0);
          return `<tr class="click" data-sym="${esc(f)}"><td class="sym" style="color:${HEX[i]}">${esc(f)}</td><td class="nm" style="max-width:240px">${esc(d.name)}</td><td class="r">${int(d.count)}</td><td class="r">${num(top10, 1)}%</td><td>${esc(d.asOf)}</td><td class="dim wrap" style="max-width:260px"><a href="${safeUrl(d.sourceUrl)}" target="_blank" rel="noopener">${esc(d.source)}</a>${d.approximate ? ' <span class="tag delayed">approx.</span>' : ''}</td></tr>`;
        })
        .join('')}</tbody></table>`;
      fundsP.setFoot('N-PORT holdings are quarterly (published with up to a 60-day lag); SSGA files update daily.');
    }
    fundsP.body.addEventListener('click', (e) => {
      const tr = e.target.closest('[data-sym]');
      if (tr && !e.target.closest('a')) ctx.navigate(`#/eq/${encodeURIComponent(tr.dataset.sym)}`);
    });

    const ready = () => funds.map((f, i) => ({ f, i, d: data[f] })).filter((x) => x.d && !x.d.error);

    function drawMatrix() {
      const ok = ready();
      if (ok.length < 2) {
        matrixP.body.innerHTML = '<div class="empty">Add at least two funds with holdings data.</div>';
        return;
      }
      const m = overlapMatrix(ok.map((x) => ({ symbol: x.f, holdings: x.d.holdings })));
      matrixP.body.innerHTML = `<table class="t"><thead><tr><th></th>${ok.map((x) => `<th class="c" style="color:${HEX[x.i]}">${esc(x.f)}</th>`).join('')}</tr></thead><tbody>${ok
        .map((a, i) => `<tr><td class="sym" style="color:${HEX[a.i]}">${esc(a.f)}</td>${ok
          .map((b, j) => {
            if (i === j) return '<td class="c muted">—</td>';
            const o = m[i][j];
            const sel = (pair[0] === a.i && pair[1] === b.i) || (pair[0] === b.i && pair[1] === a.i);
            return `<td class="c" data-a="${a.i}" data-b="${b.i}" style="cursor:pointer;background:${sequentialColor(o.weightOverlap / 100)};${sel ? 'outline:1px solid var(--amber);outline-offset:-1px;' : ''}" title="${esc(a.f)} ∩ ${esc(b.f)}: ${num(o.weightOverlap, 1)}% by weight, ${o.commonCount} common holdings"><b style="color:var(--heat-text)">${num(o.weightOverlap, 1)}%</b><div style="font-size:10px;color:var(--heat-text);opacity:.8">${o.commonCount} common</div></td>`;
          })
          .join('')}</tr>`)
        .join('')}</tbody></table>`;
      matrixP.setFoot('Weight overlap = Σ min(weight in A, weight in B) across shared securities. Click a cell for detail.');
    }
    matrixP.body.addEventListener('click', (e) => {
      const td = e.target.closest('td[data-a]');
      if (!td) return;
      pair = [Number(td.dataset.a), Number(td.dataset.b)];
      drawMatrix();
      drawPair();
    });

    function drawPair() {
      const ok = ready();
      let A = ok.find((x) => x.i === pair[0]);
      let B = ok.find((x) => x.i === pair[1]);
      if (!A || !B) [A, B] = ok;
      if (!A || !B) {
        pairP.body.innerHTML = '<div class="empty">Select two funds.</div>';
        return;
      }
      pair = [A.i, B.i];
      const fa = { symbol: A.f, holdings: A.d.holdings };
      const fb = { symbol: B.f, holdings: B.d.holdings };
      const o = overlapPair(fa, fb, resolveKeys([fa, fb]));
      pairP.el.querySelector('h2').textContent = `Pair Detail — ${A.f} vs ${B.f}`;
      const w = (v) => (v == null ? DASH : num(v, 2) + '%');
      const list = (rows, cols) => `<div class="scroll h360"><table class="t compact"><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${c.l}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr class="${r.ticker ? 'click' : ''}" ${r.ticker ? `data-sym="${esc(r.ticker)}"` : ''}>${cols.map((c) => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      const maxMin = Math.max(...o.common.slice(0, 40).map((c) => c.min), 0.01);
      pairP.body.innerHTML = `<div class="grid">
        <div class="c3">
          <div class="tiles" style="grid-template-columns:1fr 1fr">
            <div class="tile hero" style="grid-column:1/-1"><div class="l">Weight overlap</div><div class="v">${num(o.weightOverlap, 1)}%</div><div class="s">of each portfolio is identical</div></div>
            <div class="tile"><div class="l">${esc(A.f)} in ${esc(B.f)}</div><div class="v">${num(o.pctWeightA, 1)}%</div><div class="s">${num(o.pctCountA * 100, 0)}% of holdings</div></div>
            <div class="tile"><div class="l">${esc(B.f)} in ${esc(A.f)}</div><div class="v">${num(o.pctWeightB, 1)}%</div><div class="s">${num(o.pctCountB * 100, 0)}% of holdings</div></div>
          </div>
          ${resolveVars(venn(A.f, B.f, o))}
          <div class="note">“${esc(A.f)} in ${esc(B.f)}” = share of ${esc(A.f)}'s assets in securities ${esc(B.f)} also owns.</div>
        </div>
        <div class="c5"><div class="note amber" style="margin-bottom:3px">COMMON HOLDINGS (${o.commonCount})</div>${list(o.common.slice(0, 60), [
          { l: 'Ticker', cls: 'sym', f: (r) => esc(r.ticker || DASH) },
          { l: 'Name', cls: 'nm', f: (r) => esc(r.name) },
          { l: esc(A.f), cls: 'r', f: (r) => w(r.wA) },
          { l: esc(B.f), cls: 'r', f: (r) => w(r.wB) },
          { l: 'Overlap', cls: 'r', f: (r) => `<div class="row" style="justify-content:flex-end;gap:4px"><div class="wbar" style="width:${(r.min / maxMin) * 50}px;background:${HEX[2]}"></div>${w(r.min)}</div>` },
        ])}</div>
        <div class="c2"><div class="note" style="margin-bottom:3px;color:${HEX[A.i]}">ONLY IN ${esc(A.f)} (${o.onlyA.length})</div>${list(o.onlyA.slice(0, 40), [
          { l: 'Ticker', cls: 'sym', f: (r) => esc(r.ticker || r.name.slice(0, 14)) },
          { l: 'Wt', cls: 'r', f: (r) => w(r.weight) },
        ])}</div>
        <div class="c2"><div class="note" style="margin-bottom:3px;color:${HEX[B.i]}">ONLY IN ${esc(B.f)} (${o.onlyB.length})</div>${list(o.onlyB.slice(0, 40), [
          { l: 'Ticker', cls: 'sym', f: (r) => esc(r.ticker || r.name.slice(0, 14)) },
          { l: 'Wt', cls: 'r', f: (r) => w(r.weight) },
        ])}</div>
      </div>`;
      pairP.setFoot('Securities are matched by CUSIP, ISIN and ticker, so funds that publish different identifiers still line up.');
    }
    pairP.body.addEventListener('click', (e) => {
      const tr = e.target.closest('[data-sym]');
      if (tr) ctx.navigate(`#/eq/${encodeURIComponent(tr.dataset.sym)}`);
    });

    function drawLookThrough() {
      const ok = ready();
      if (!ok.length) {
        ltP.body.innerHTML = '<div class="empty">—</div>';
        return;
      }
      const lt = lookThrough(ok.map((x) => ({ symbol: x.f, holdings: x.d.holdings })), ok.map((x) => alloc[x.i] ?? 1));
      const totalAlloc = ok.reduce((s, x) => s + (alloc[x.i] > 0 ? alloc[x.i] : 0), 0) || 1;
      const rows = lt.rows.slice(0, 30);
      const max = rows[0]?.weight || 1;
      ltP.body.innerHTML = `<div class="grid"><div class="c3"><div class="tiles" style="grid-template-columns:1fr">
          <div class="tile"><div class="l">Unique securities</div><div class="v">${int(lt.uniqueCount)}</div><div class="s">across ${ok.length} funds</div></div>
          <div class="tile"><div class="l">Top 10 look-through weight</div><div class="v">${num(lt.top10Weight, 1)}%</div><div class="s">concentration of the combined portfolio</div></div>
          <div class="tile"><div class="l">Effective # of holdings</div><div class="v">${num(lt.effectiveN, 0)}</div><div class="s">1 / Σ weight² (Herfindahl)</div></div>
          <div class="tile"><div class="l">Allocation</div><div class="s" style="white-space:normal">${ok.map((x) => `<span style="color:${HEX[x.i]}">${esc(x.f)}</span> ${num(((alloc[x.i] > 0 ? alloc[x.i] : 0) / totalAlloc) * 100, 1)}%`).join(' · ')}</div></div>
        </div></div>
        <div class="c9 scroll h520"><table class="t compact"><thead><tr><th>#</th><th>Ticker</th><th>Name</th><th class="r">Combined</th><th style="width:40%">Contribution by fund</th></tr></thead><tbody>${rows
          .map((r, k) => `<tr class="${r.ticker ? 'click' : ''}" ${r.ticker ? `data-sym="${esc(r.ticker)}"` : ''}><td class="muted">${k + 1}</td><td class="sym">${esc(r.ticker || DASH)}</td><td class="nm">${esc(r.name)}</td><td class="r b">${num(r.weight, 2)}%</td><td><div class="stack" style="width:${(r.weight / max) * 100}%">${ok
            .filter((x) => r.sources[x.f])
            .map((x) => `<span style="flex:${r.sources[x.f]};background:${HEX[x.i]}" title="${esc(x.f)}: ${num(r.sources[x.f], 2)}%"></span>`)
            .join('')}</div></td></tr>`)
          .join('')}</tbody></table></div></div>`;
      ltP.setFoot('Combined weight = Σ (fund allocation × security weight in fund). Set allocations in the fund chips above (dollars or relative weights).');
    }
    ltP.body.addEventListener('click', (e) => {
      const tr = e.target.closest('[data-sym]');
      if (tr) ctx.navigate(`#/eq/${encodeURIComponent(tr.dataset.sym)}`);
    });

    async function run() {
      persist();
      history.replaceState(null, '', `#/ovlp?f=${funds.join(',')}`);
      drawFunds();
      [matrixP, pairP, ltP].forEach((p) => loading(p.body, 'Waiting for holdings'));
      await Promise.all(
        funds.map(async (f) => {
          if (data[f] && !data[f].error) return;
          try {
            data[f] = await api.holdings(f);
          } catch (err) {
            data[f] = { error: err.message };
          }
          if (ctx.alive) drawFunds();
        }),
      );
      if (!ctx.alive) return;
      drawFunds();
      drawMatrix();
      drawPair();
      drawLookThrough();
    }
    if (funds.length) run();
    else errorBox(fundsP.body, 'Add ETFs to compare');
  },
};
