// BOND — bond search, yield curves (Indonesia + global), Indonesian fair prices (PHEI),
// corporate spreads, bond ETFs and a price/yield calculator.
import { api } from '../api.js';
import { h, panel, loading, errorBox, seg, table } from '../dom.js';
import { esc, num, price, pct, signed, cls, arrow, date, safeUrl, DASH } from '../fmt.js';
import { lineChart, HEX, sparkline } from '../charts.js';
import { linkRows } from './common.js';
import { bondDialog } from '../positions.js';
import * as B from '../lib/bonds.js';

const TENORS = [0.25, 1, 2, 3, 5, 7, 10, 20, 30];
const TLABEL = (y) => (y < 1 ? `${Math.round(y * 12)}M` : `${y}Y`);
const BOND_ETFS = ['BND', 'AGG', 'TLT', 'IEF', 'SHY', 'TIP', 'LQD', 'HYG', 'EMB', 'BNDX', 'IGOV', 'EMLC'];
const ETF_NAMES = { BND: 'US total bond market', AGG: 'US aggregate bonds', TLT: 'US Treasury 20Y+', IEF: 'US Treasury 7–10Y', SHY: 'US Treasury 1–3Y', TIP: 'US inflation-linked (TIPS)', LQD: 'US investment-grade corporate', HYG: 'US high-yield corporate', EMB: 'EM sovereign (USD)', BNDX: 'International bonds (hedged)', IGOV: 'International government', EMLC: 'EM local-currency govt' };
const today = () => new Date().toISOString().slice(0, 10);

function interp(points, years) {
  const p = points.filter((x) => x.yield != null).sort((a, b) => a.years - b.years);
  if (!p.length || years < p[0].years - 1e-9 || years > p.at(-1).years + 1e-9) return null;
  for (let i = 1; i < p.length; i++) if (years <= p[i].years) return p[i - 1].yield + ((years - p[i - 1].years) / (p[i].years - p[i - 1].years)) * (p[i].yield - p[i - 1].yield);
  return p[0].yield;
}

export default {
  id: 'bond',
  title: 'Bonds',
  async mount(root, { query }, ctx) {
    const input = h('input', { class: 'in', placeholder: 'SBR015T2 · FR0108 · ORI025T3 · US CUSIP (91282CKX8) · US10Y', style: { width: '360px' }, value: query.get('q') || '' });
    const go = () => {
      const q = input.value.trim();
      if (!q) return;
      history.replaceState(null, '', `#/bond?q=${encodeURIComponent(q)}`);
      search(q);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'BOND · BONDS & YIELD CURVES'), h('span', { class: 'sub' }, 'PHEI · U.S. Treasury · ECB · Bundesbank · MOF Japan · Bank of Canada'), h('span', { class: 'spacer' }), input, h('button', { class: 'btn primary', onclick: go }, 'SEARCH')));
    const grid = h('div', { class: 'grid' });
    root.append(grid);
    const P = (title, c, opts) => {
      const p = panel({ title, ...opts });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const resP = P('Search result', 'c12');
    resP.el.hidden = true;
    const curvesP = P('Government Yield Curves', 'c8');
    const tenP = P('10-Year Government Yields', 'c4', { bodyCls: 'flush' });
    grid.append(h('div', { class: 'c12 section-hd', html: 'INDONESIA <small>PHEI fair prices & yields (Indonesia Bond Pricing Agency)</small>' }));
    const igsP = P('IDR Government Yield Curve (IGSYC)', 'c6');
    const corpP = P('IDR Corporate Yields by Rating', 'c6');
    const sbnP = P('Government Bonds — Fair Prices', 'c12', { bodyCls: 'flush scroll h520' });
    grid.append(h('div', { class: 'c12 section-hd', html: 'GLOBAL <small>bond ETFs & calculator</small>' }));
    const etfP = P('Bond ETFs', 'c6', { bodyCls: 'flush' });
    const calcP = P('Bond Calculator', 'c6');
    [curvesP, tenP, igsP, corpP, sbnP, etfP].forEach((p) => loading(p.body));
    linkRows(etfP.body, ctx.navigate);

    let data = null;

    // ---- overview ----
    async function loadOverview() {
      try {
        data = await api.bonds();
      } catch (err) {
        [curvesP, tenP, igsP, corpP, sbnP].forEach((p) => errorBox(p.body, err));
        return;
      }
      if (!ctx.alive) return;
      drawCurves();
      drawTen();
      drawIndonesia();
    }

    let shown = null;
    function drawCurves() {
      const curves = data.curves;
      shown ||= new Set(curves.map((c) => c.code));
      const order = ['ID', 'US', 'EA', 'DE', 'JP', 'CA'];
      const colorOf = (code) => HEX[order.indexOf(code) % 8];
      const toggles = h('div', { class: 'row', style: { marginBottom: '4px' } });
      for (const c of [...curves].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))) {
        const id = `cv-${c.code}`;
        const cb = h('input', { type: 'checkbox', id, checked: shown.has(c.code) });
        cb.addEventListener('change', () => {
          cb.checked ? shown.add(c.code) : shown.delete(c.code);
          drawCurves();
        });
        toggles.append(h('label', { for: id, class: 'row', style: { gap: '4px', cursor: 'pointer' } }, cb, h('span', { class: 'sw', style: { display: 'inline-block', width: '10px', height: '3px', background: colorOf(c.code) } }), c.country));
      }
      const box = h('div');
      curvesP.body.innerHTML = '';
      curvesP.body.append(toggles, box);
      const sel = curves.filter((c) => shown.has(c.code)).sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
      lineChart(box, {
        x: TENORS.map(TLABEL),
        xType: 'category',
        series: sel.map((c) => ({ name: c.country, values: TENORS.map((t) => interp(c.points, t)), color: colorOf(c.code), width: c.code === 'ID' ? 2.2 : 1.6 })),
        height: 300,
        yFmt: (v) => v.toFixed(1) + '%',
        tipFmt: (v) => v.toFixed(2) + '%',
        legend: false,
        endLabels: sel.length <= 4,
      });
      const errs = Object.entries(data.curveErrors || {});
      curvesP.setFoot(`Maturity on the x-axis (interpolated between published tenors). ${curves.map((c) => `${c.code}: ${esc(c.source)} ${esc(c.asOf || '')}`).join(' · ')}${errs.length ? ` · unavailable: ${errs.map(([k]) => k).join(', ')}` : ''}`);
    }

    function drawTen() {
      const rows = data.curves.map((c) => {
        const ten = c.points.find((p) => p.years === 10);
        const two = c.points.find((p) => p.years === 2);
        return { country: c.country, code: c.code, y10: ten?.yield ?? null, d10: ten && ten.prev != null ? (ten.yield - ten.prev) * 100 : null, s210: ten && two ? (ten.yield - two.yield) * 100 : null, asOf: c.asOf };
      });
      tenP.body.innerHTML = '';
      tenP.body.append(
        table(
          [
            { key: 'country', label: 'Country', cls: 'amber', fmt: (r) => esc(r.country) },
            { key: 'y10', label: '10Y', cls: 'r b', fmt: (r) => (r.y10 == null ? DASH : num(r.y10, 2) + '%') },
            { key: 'd10', label: '1D', cls: 'r', fmt: (r) => `<span class="${cls(r.d10)}">${r.d10 == null ? DASH : signed(r.d10, 1) + 'bp'}</span>` },
            { key: 's210', label: '2s10s', cls: 'r', fmt: (r) => `<span class="${cls(r.s210)}">${r.s210 == null ? DASH : signed(r.s210, 0) + 'bp'}</span>`, title: '10-year minus 2-year yield' },
            { key: 'asOf', label: 'As of', cls: 'muted', fmt: (r) => esc(date(r.asOf, { month: 'short', day: 'numeric' })) },
          ],
          rows,
          { sortKey: 'y10', compact: true },
        ),
      );
      const id = rows.find((r) => r.code === 'ID');
      const us = rows.find((r) => r.code === 'US');
      tenP.setFoot(id && us ? `Indonesia–US 10Y spread: <b class="amber">${signed((id.y10 - us.y10) * 100, 0)}bp</b> · Japan &amp; Euro-area figures are official end-of-day values.` : '');
    }

    function drawIndonesia() {
      const ph = data.phei;
      if (!ph) {
        [igsP, corpP, sbnP].forEach((p) => errorBox(p.body, data.errors.join('; ') || 'PHEI unavailable'));
        return;
      }
      // IGSYC today vs yesterday
      const box = h('div');
      igsP.body.innerHTML = '';
      igsP.body.append(box);
      lineChart(box, {
        x: ph.curve.map((p) => p.years),
        xType: 'number',
        xFmt: (v) => `${Math.round(v)}Y`,
        tipXFmt: (v) => (v < 1 ? `${Math.round(v * 12)} months` : `${v} years`),
        series: [{ name: `Today (${ph.asOf})`, values: ph.curve.map((p) => p.yield), color: HEX[0], width: 2 }, { name: 'Previous day', values: ph.curve.map((p) => p.prev), color: HEX[1], dash: true }],
        height: 220,
        yFmt: (v) => v.toFixed(2) + '%',
        endLabels: true,
      });
      const at = (y) => ph.curve.find((p) => p.years === y);
      igsP.meta.innerHTML = `10Y <b class="amber">${num(at(10)?.yield, 3)}%</b> <span class="${cls(at(10) ? at(10).yield - at(10).prev : 0)}">${at(10) ? signed((at(10).yield - at(10).prev) * 100, 1) + 'bp' : ''}</span>`;
      igsP.setFoot(`Source: <a href="${safeUrl(ph.sourceUrl)}" target="_blank" rel="noopener">${esc(ph.source)}</a> · ${esc(ph.asOf)}`);

      // corporate by rating
      const box2 = h('div');
      corpP.body.innerHTML = '';
      corpP.body.append(box2);
      const ratings = ['IGS', 'AAA', 'AA', 'A', 'BBB'].filter((r) => ph.corporate.some((x) => x[r] != null));
      lineChart(box2, {
        x: ph.corporate.map((r) => r.years),
        xType: 'number',
        xFmt: (v) => `${Math.round(v)}Y`,
        tipXFmt: (v) => `${v} years`,
        series: ratings.map((r, i) => ({ name: r === 'IGS' ? 'Government' : r, values: ph.corporate.map((x) => x[r]), color: HEX[[0, 2, 3, 1, 7][i]] })),
        height: 200,
        yFmt: (v) => v.toFixed(1) + '%',
      });
      const five = ph.corporate.find((r) => r.years === 5);
      if (five) corpP.body.append(h('div', { class: 'note', html: `5-year spread over government: ${ratings.filter((r) => r !== 'IGS').map((r) => `${r} <b>${num((five[r] - five.IGS) * 100, 0)}bp</b>`).join(' · ')}` }));
      corpP.setFoot('PHEI corporate bond yield curves by credit rating (IDR)');

      // series table
      const rows = ph.series.map((s) => {
        const si = B.sbnInfo(s.series);
        const maturity = B.addYears(ph.asOf, s.ttm);
        const risk = si ? B.riskMeasures({ settle: ph.asOf, maturity, coupon: s.coupon, freq: si.freq, ytm: s.yield }) : null;
        const curveY = interp(ph.curve, s.ttm);
        return { ...s, type: si?.type || '', dy: s.prevYield != null ? (s.yield - s.prevYield) * 100 : null, dp: s.prevPrice != null ? s.price - s.prevPrice : null, spread: curveY != null ? (s.yield - curveY) * 100 : null, dur: risk?.modified ?? null };
      });
      sbnP.body.innerHTML = '';
      sbnP.body.append(
        table(
          [
            { key: 'series', label: 'Series', cls: 'sym', fmt: (r) => esc(r.series) },
            { key: 'group', label: 'Group', cls: 'dim', fmt: (r) => esc(r.group) },
            { key: 'ttm', label: 'Years left', cls: 'r', fmt: (r) => num(r.ttm, 2) },
            { key: 'coupon', label: 'Coupon', cls: 'r', fmt: (r) => num(r.coupon, 3) + '%' },
            { key: 'price', label: 'Price %', cls: 'r b', fmt: (r) => num(r.price, 3) },
            { key: 'dp', label: 'Δ price', cls: 'r', fmt: (r) => `<span class="${cls(r.dp)}">${r.dp == null ? DASH : signed(r.dp, 3)}</span>` },
            { key: 'yield', label: 'Yield', cls: 'r b', fmt: (r) => num(r.yield, 3) + '%' },
            { key: 'dy', label: 'Δ yield', cls: 'r', fmt: (r) => `<span class="${cls(-r.dy)}">${r.dy == null ? DASH : signed(r.dy, 1) + 'bp'}</span>`, title: 'Yields up = prices down' },
            { key: 'spread', label: 'vs curve', cls: 'r', fmt: (r) => (r.spread == null ? DASH : signed(r.spread, 0) + 'bp'), title: 'Yield minus the IGSYC curve at the same maturity (positive = cheaper)' },
            { key: 'dur', label: 'Mod. dur.', cls: 'r', fmt: (r) => (r.dur == null ? DASH : num(r.dur, 2)), title: 'Modified duration: % price change for a 1-point yield move' },
          ],
          rows,
          { sortKey: 'ttm', sortDir: 1, compact: true, onRow: (r) => {
            input.value = r.series;
            go();
          } },
        ),
      );
      sbnP.setFoot(`Benchmark FR (conventional) &amp; PBS (sukuk) series and tradable retail ORI/SR · ${esc(ph.asOf)} · click a row for detail · non-tradable SBR/ST have no market price (valued at nominal)`);
    }

    // ---- ETFs ----
    async function loadEtfs() {
      try {
        const { quotes } = await api.quotes(BOND_ETFS);
        if (!ctx.alive) return;
        etfP.body.innerHTML = `<table class="t compact"><thead><tr><th>ETF</th><th>Exposure</th><th class="r">Last</th><th class="r">%Chg</th><th class="r">Intraday</th></tr></thead><tbody>${BOND_ETFS.map((s) => {
          const q = quotes[s];
          return `<tr class="click" data-sym="${s}"><td class="sym">${s}</td><td class="nm">${ETF_NAMES[s]}</td><td class="r b">${price(q?.price)}</td><td class="r ${cls(q?.changePct)}">${arrow(q?.changePct)} ${pct(q?.changePct)}</td><td class="r">${sparkline(q?.spark, { w: 70, h: 16, base: q?.prevClose })}</td></tr>`;
        }).join('')}</tbody></table>`;
        etfP.setFoot('Click for price history, holdings and risk (EQ screen)');
      } catch (err) {
        errorBox(etfP.body, err);
      }
    }

    // ---- calculator ----
    function calculator(pre = {}) {
      calcP.body.innerHTML = '';
      const f = h('div', { class: 'form' });
      f.innerHTML = `
        <label>Coupon (% per year)<input class="in num" name="coupon" type="number" step="any" value="${esc(pre.coupon ?? 6.5)}"></label>
        <label>Coupons per year<select class="in" name="freq">${[[2, 'Semiannual'], [12, 'Monthly'], [4, 'Quarterly'], [1, 'Annual']].map(([v, l]) => `<option value="${v}" ${Number(pre.freq ?? 2) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Settlement date<input class="in" name="settle" type="date" value="${esc(pre.settle || today())}"></label>
        <label>Maturity date<input class="in" name="maturity" type="date" value="${esc(pre.maturity || B.addYears(today(), 10))}"></label>
        <label>Solve for<select class="in" name="mode"><option value="price">Price from yield</option><option value="yield" ${pre.price != null ? 'selected' : ''}>Yield from price</option></select></label>
        <label class="m-y">Yield to maturity (%)<input class="in num" name="ytm" type="number" step="any" value="${esc(pre.ytm ?? 7.5)}"></label>
        <label class="m-p">Clean price (% of par)<input class="in num" name="price" type="number" step="any" value="${esc(pre.price ?? 95)}"></label>
        <label>Face amount<input class="in num" name="face" type="number" step="any" value="${esc(pre.face ?? 100000000)}"></label>`;
      const out = h('div', { style: { marginTop: '6px' } });
      calcP.body.append(f, out);
      const v = (n) => f.querySelector(`[name=${n}]`);
      const run = () => {
        const mode = v('mode').value;
        f.querySelector('.m-y').hidden = mode !== 'price';
        f.querySelector('.m-p').hidden = mode !== 'yield';
        const args = { settle: v('settle').value, maturity: v('maturity').value, coupon: Number(v('coupon').value), freq: Number(v('freq').value) };
        if (!args.settle || !args.maturity || args.maturity <= args.settle) return (out.innerHTML = '<div class="empty">Maturity must be after settlement</div>');
        const ytm = mode === 'price' ? Number(v('ytm').value) : B.yieldFromPrice({ ...args, clean: Number(v('price').value) });
        if (ytm == null) return (out.innerHTML = '<div class="empty err">No yield matches that price</div>');
        const p = B.priceFromYield({ ...args, ytm });
        const r = B.riskMeasures({ ...args, ytm });
        const face = Number(v('face').value) || 0;
        const tile = (l, val, s = '') => `<div class="tile"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${s || '&nbsp;'}</div></div>`;
        out.innerHTML = `<div class="tiles">${[
          tile('Clean price', num(p.clean, 4), '% of par'),
          tile('Yield to maturity', num(ytm, 4) + '%', mode === 'yield' ? 'solved' : 'input'),
          tile('Accrued interest', num(p.accrued, 4), `dirty ${num(p.dirty, 4)}`),
          tile('Modified duration', num(r.modified, 3), `Macaulay ${num(r.macaulay, 3)} yrs`),
          tile('Convexity', num(r.convexity, 2), ''),
          tile('DV01', num((r.dv01 * face) / 100, 0), 'value change per 1bp on face'),
          tile('Market value', num((face * p.dirty) / 100, 0), 'face × dirty price'),
        ].join('')}</div>`;
      };
      f.addEventListener('input', run);
      f.addEventListener('change', run);
      run();
      calcP.setFoot('Street convention, compounding at the coupon frequency; accrued interest Act/Act. Educational estimate — dealer quotes may differ.');
    }

    // ---- search ----
    async function search(q) {
      resP.el.hidden = false;
      loading(resP.body, `Looking up ${q}`);
      resP.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      let r;
      try {
        r = await api.bondSearch(q);
      } catch (err) {
        return errorBox(resP.body, err);
      }
      if (!ctx.alive) return;
      const tile = (l, val, s = '') => `<div class="tile"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${s || '&nbsp;'}</div></div>`;
      const addBtn = (series, defaults) => h('button', { class: 'btn primary', onclick: () => bondDialog(series, defaults) }, '+ Add to portfolio');
      resP.body.innerHTML = '';
      if (r.kind === 'sbn') {
        const si = r.info;
        resP.el.querySelector('h2').textContent = `${si.series} — ${si.name}`;
        const bi = r.biRate?.[0];
        if (r.row) {
          const row = r.row;
          const maturity = B.addYears(r.asOf, row.ttm);
          const risk = B.riskMeasures({ settle: r.asOf, maturity, coupon: row.coupon, freq: si.freq, ytm: row.yield });
          const curveY = interp(r.curve, row.ttm);
          resP.body.innerHTML = `<div class="tiles">${[
            tile('Fair price (PHEI)', num(row.price, 4) + '%', `<span class="${cls(row.price - row.prevPrice)}">${signed(row.price - row.prevPrice, 4)}</span> vs previous day`),
            tile('Yield', num(row.yield, 4) + '%', `<span class="${cls(row.prevYield - row.yield)}">${signed((row.yield - row.prevYield) * 100, 1)}bp</span> · net of 10% tax ≈ ${num(row.yield - (row.coupon * si.taxRate) / 100, 2)}%`),
            tile('Coupon', num(row.coupon, 3) + '%', `${si.freq === 12 ? 'monthly' : si.freq === 2 ? 'semiannual' : si.freq + '×/yr'} · ${si.kind}`),
            tile('Time to maturity', `${num(row.ttm, 2)} yrs`, `≈ ${date(maturity)}`),
            tile('Modified duration', num(risk.modified, 2), `price −${num(risk.modified, 2)}% if yields +1pt`),
            tile('vs IGSYC curve', curveY == null ? DASH : signed((row.yield - curveY) * 100, 0) + 'bp', curveY == null ? '' : `curve ${num(curveY, 3)}% at ${num(row.ttm, 1)}y`),
          ].join('')}</div><p class="note">${esc(row.group)} series · ${si.tradable ? 'tradable on the secondary market' : 'non-tradable'}${si.sharia ? ' · sharia-compliant (sukuk)' : ''} · prices as of ${esc(r.asOf)}.</p>`;
          resP.body.append(h('div', { class: 'row' }, addBtn(si.series, { bond: { kind: 'fixed', coupon: row.coupon, freq: si.freq, maturity, taxRate: si.taxRate, tradable: true, currency: 'IDR' }, costBasis: row.price / 100 }), h('button', { class: 'btn', onclick: () => calculator({ coupon: row.coupon, freq: si.freq, settle: r.asOf, maturity, ytm: row.yield, face: 100000000 }) }, 'Open in calculator')));
        } else if (!si.tradable) {
          const k = B.knownSeries(si.series);
          const today = new Date().toISOString().slice(0, 10);
          const cpnNow = k ? B.couponOn(k, today, r.biRate || []) : null;
          resP.body.innerHTML = `<div class="tiles">${[
            tile('Type', si.type, si.name),
            tile('Valuation', 'Nominal', 'not traded — no market price; worth its face value'),
            k
              ? tile('Coupon now', num(cpnNow, 2) + '%', `BI-Rate + ${num(k.spread, 2)}% · floor ${num(k.floor, 2)}% · resets every 3 months`)
              : tile('Coupon', 'Floating', 'BI-Rate + fixed spread, never below the floor'),
            tile('BI-Rate now', bi ? num(bi.rate, 2) + '%' : DASH, bi ? `since ${date(bi.date)}` : ''),
            k
              ? tile('Maturity', date(k.maturity), today >= k.maturity ? 'matured' : `${num(B.daysBetween(today, k.maturity) / 365.25, 2)} yrs left · paid monthly on the ${Number(k.maturity.slice(8))}th`)
              : tile('Payments', 'Monthly', `10% final tax on coupons${si.tenorYears ? ` · ${si.tenorYears}-year tenor` : ''}`),
            ...(k ? [tile('Net coupon', num(cpnNow * 0.9, 2) + '%', 'after the 10% final tax')] : []),
          ].join('')}</div>
          <p class="prose">${esc(si.series)} is a non-tradable retail government ${si.sharia ? 'sukuk' : 'bond'} sold through appointed distributors (banks and online platforms). Its coupon is reset every three months to the BI-Rate plus a spread fixed at issuance, with the initial coupon as a floor, and it can only be cashed early in the early-redemption window stated in its terms. The exact spread, floor and maturity are in the series' term sheet (memorandum informasi) from DJPPR or your distributor — enter them once and FinTerm tracks the coupon against the live BI-Rate.</p>`;
          if (k) resP.body.querySelector('.prose').insertAdjacentHTML('beforeend', ' <b>Published terms for this series are filled in for you</b> — confirm them against your purchase confirmation.');
          resP.body.append(h('div', { class: 'row' }, addBtn(si.series, { bond: k || { kind: 'floating', freq: 12, taxRate: 10, tradable: false, currency: 'IDR' } })));
        } else {
          const ig = (y) => interp(r.curve, y);
          resP.body.innerHTML = `<p class="prose">${esc(si.series)} (${esc(si.name)}) isn't in PHEI's public fair-price table, which covers the benchmark FR/PBS series and the tradable retail ORI/SR series. You can value it from today's government curve: enter its coupon and maturity in the calculator below (pre-filled with the IGSYC 10-year yield ${ig(10) != null ? num(ig(10), 3) + '%' : ''}).</p>`;
          calculator({ coupon: 7, freq: si.freq, settle: r.asOf || today(), ytm: ig(10) ?? 7.5 });
          resP.body.append(h('div', { class: 'row' }, addBtn(si.series, { bond: { kind: si.kind === 'floating' ? 'floating' : 'fixed', freq: si.freq, taxRate: 10, tradable: true, currency: 'IDR' } })));
        }
        resP.setFoot(r.sourceUrl ? `Source: <a href="${safeUrl(r.sourceUrl)}" target="_blank" rel="noopener">PHEI</a> · BI-Rate: Bank Indonesia` : 'BI-Rate: Bank Indonesia');
      } else if (r.kind === 'treasury') {
        const s = r.security;
        resP.el.querySelector('h2').textContent = `${s.cusip} — US Treasury ${s.description}`;
        const us = data?.curves.find((c) => c.code === 'US');
        const yrs = B.daysBetween(today(), s.maturity) / 365.25;
        const curveY = us && yrs > 0 ? interp(us.points, Math.max(us.points[0].years, yrs)) : null;
        const model = curveY != null && s.coupon > 0 && yrs > 0 ? B.priceFromYield({ settle: today(), maturity: s.maturity, coupon: s.coupon, freq: 2, ytm: curveY }) : null;
        const risk = curveY != null && yrs > 0 ? B.riskMeasures({ settle: today(), maturity: s.maturity, coupon: s.coupon, freq: 2, ytm: curveY }) : null;
        const last = s.auctions.at(-1);
        resP.body.innerHTML = `<div class="tiles">${[
          tile('Coupon', num(s.coupon, 3) + '%', s.tips ? 'inflation-protected' : s.frn ? 'floating rate' : 'semiannual'),
          tile('Maturity', date(s.maturity), yrs > 0 ? `${num(yrs, 2)} years left` : 'matured'),
          tile('Last auction', last?.highYield != null ? num(last.highYield, 3) + '%' : DASH, `${date(last?.auctionDate || last?.issueDate)} · price ${num(last?.price, 4)}`),
          tile('Bid-to-cover', num(last?.bidToCover, 2), `${s.auctions.length} auction${s.auctions.length > 1 ? 's (reopened)' : ''}`),
          tile('Curve yield today', curveY != null ? num(curveY, 3) + '%' : DASH, 'Treasury par curve at this maturity'),
          tile('Model price', model ? num(model.clean, 3) : DASH, model ? `mod. duration ${num(risk.modified, 2)}` : 'needs a coupon bond'),
        ].join('')}</div><p class="note">Model price = this bond's cash flows discounted at today's Treasury par-curve yield for its maturity — a fair-value estimate, not a dealer quote.</p>`;
        resP.setFoot(`Source: ${esc(s.source)}`);
      } else if (r.kind === 'curve-point') {
        resP.el.querySelector('h2').textContent = `${r.query} — US Treasury ${TLABEL(r.years)}`;
        resP.body.innerHTML = `<div class="tiles">${tile(`US ${TLABEL(r.years)} yield`, r.yield != null ? num(r.yield, 3) + '%' : DASH, `Treasury par curve · ${esc(r.curve?.asOf || '')}`)}</div>`;
      } else {
        resP.el.querySelector('h2').textContent = `No bond found for “${q}”`;
        resP.body.innerHTML = `<p class="prose">Search Indonesian government series (FR0108, PBS034, ORI025T3, SR022T5, SBR015T2, ST014T2), a US Treasury CUSIP (e.g. 91282CKX8) or a US tenor (US2Y, US10Y). Corporate bonds and other countries' individual bonds aren't freely published — use the curves above or a bond ETF:</p>`;
        resP.body.append(h('div', { class: 'row' }, ...['BND', 'TLT', 'EMB', 'BNDX'].map((s) => h('button', { class: 'btn', onclick: () => ctx.navigate(`#/eq/${s}`) }, s))));
      }
    }

    loadOverview();
    loadEtfs();
    calculator();
    if (query.get('q')) search(query.get('q'));
    ctx.every(60000, loadEtfs);
  },
};
