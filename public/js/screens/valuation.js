// VAL — valuation workbench: what analysts think, your own DCF, trading comparables, precedent
// transactions, dividend discount model, and a football field that blends them into your fair value.
import { api } from '../api.js';
import { h, panel, loading, errorBox, toast } from '../dom.js';
import { esc, num, price, pct, pctf, cls, date, DASH } from '../fmt.js';
import { fmtBig } from '../valuation.js';
import { legend, niceTicks, resolveVars, HEX } from '../charts.js';
import { state, saveInputs, savedInputs } from '../state.js';
import * as V from '../lib/valmodels.js';

const KEY = (s) => `val:${s}`;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const GROUPS = {
  market: { label: 'Market reference', color: HEX[0] },
  intrinsic: { label: 'Intrinsic (cash flows)', color: HEX[1] },
  relative: { label: 'Relative (multiples)', color: HEX[2] },
};
const MULTIPLES = [
  ['pe', 'P/E (trailing)', 'eps', 'equity'],
  ['fwdPe', 'P/E (forward)', 'fwdEps', 'equity'],
  ['evEbitda', 'EV/EBITDA', 'ebitda', 'ev'],
  ['evSales', 'EV/Sales', 'revenue', 'ev'],
  ['pb', 'P/B', 'bvps', 'equity'],
];
const SHORT = { w52: '52-wk range', street: 'Analysts', dcfG: 'DCF growth', dcfX: 'DCF exit ×', ddm: 'Dividend DDM', pe: 'P/E', fwdPe: 'Fwd P/E', evEbitda: 'EV/EBITDA', evSales: 'EV/Sales', pb: 'P/B', dealEbitda: 'Deals EBITDA', dealSales: 'Deals sales', dealPremium: 'Deal premium', premium: 'Takeover' };
// Multiples above these are data errors or meaningless (near-zero earnings): left out of the statistics.
const CAP = { pe: 300, fwdPe: 300, evEbitda: 150, evSales: 60, pb: 150 };
const sane = (k, v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= CAP[k];
const REC = { strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell', none: 'No rating' };

// Company figures the models need (per-share in the trading currency).
function basics(d) {
  const f = d.financials || {};
  const t = f.ttm || {};
  const b = f.balance || {};
  const shares = d.stats.sharesOutstanding || b.shares || null;
  return {
    shares,
    debt: b.totalDebt || 0,
    cash: b.cash || 0,
    netDebt: (b.totalDebt || 0) - (b.cash || 0),
    minority: b.minority || 0,
    equityMV: d.stats.marketCap || (shares && d.price ? shares * d.price : 0),
    eps: d.stats.trailingEps ?? t.eps ?? null,
    fwdEps: d.stats.forwardEps ?? d.analysts.estimates.find((e) => e.period === '+1y')?.eps ?? null,
    bvps: d.stats.bookValue ?? (b.equity && shares ? b.equity / shares : null),
    ebitda: t.ebitda ?? (isNum(t.ebit) && isNum(t.da) ? t.ebit + t.da : null),
    revenue: t.revenue ?? null,
  };
}

// Starting assumptions taken from the data (all editable).
function defaultsFrom(d) {
  const f = d.financials || { annual: [], ttm: {}, balance: {} };
  const t = f.ttm || {};
  const idr = d.currency === 'IDR';
  const ann = (f.annual || []).filter((a) => a.revenue > 0);
  const hist = ann.length >= 2 ? (ann.at(-1).revenue / ann[Math.max(0, ann.length - 4)].revenue) ** (1 / Math.min(3, ann.length - 1)) - 1 : null;
  const est = d.analysts.estimates.find((e) => e.period === '+1y')?.revenueGrowth ?? d.analysts.estimates.find((e) => e.period === '0y')?.revenueGrowth;
  const gT = idr ? 0.05 : 0.025;
  const g1 = clamp(isNum(est) ? est : isNum(hist) ? hist : 0.05, -0.1, 0.35);
  const rev = t.revenue;
  // Banks and insurers have no meaningful EBIT/FCFF: leave the margin blank so the DCF waits for your input.
  const margin = d.financialCo ? null : rev && isNum(t.ebit) ? t.ebit / rev : (d.stats.operatingMargin ?? null);
  const taxA = (f.annual || []).at(-1)?.taxRate;
  const nw = [];
  for (let i = 1; i < (f.annual || []).length; i++) {
    const a = f.annual[i];
    const dr = a.revenue - f.annual[i - 1].revenue;
    if (dr > 0 && isNum(a.changeInWc)) nw.push(-a.changeInWc / dr);
  }
  const b = f.balance || {};
  const kd = t.interestExpense && b.totalDebt ? t.interestExpense / b.totalDebt : null;
  const rf = (d.riskFree?.rate ?? (idr ? 7 : 4.5)) / 100;
  const epsG = d.analysts.estimates.find((e) => e.period === '+1y')?.growth;
  const roe = d.stats.roe;
  const payout = d.stats.payoutRatio;
  const ddmG = isNum(epsG) ? epsG : isNum(d.dividends?.cagr5) ? d.dividends.cagr5 : isNum(roe) && isNum(payout) && payout < 1 ? V.sustainableGrowth(roe, payout) : gT;
  return {
    dcf: {
      revenue0: rev ?? null,
      years: 5,
      g1,
      gN: Math.max(gT, (g1 + gT) / 2),
      m1: margin,
      mN: margin,
      tax: isNum(taxA) && taxA > 0 && taxA < 0.45 ? taxA : idr ? 0.22 : 0.21,
      daPct: rev && isNum(t.da) ? t.da / rev : 0.03,
      capexPct: rev && isNum(t.capex) ? t.capex / rev : 0.04,
      nwcPct: nw.length ? clamp(median(nw), 0, 0.15) : 0.05,
      terminal: 'gordon',
      g: gT,
      exitMultiple: d.stats.evToEbitda > 0 ? Math.round(d.stats.evToEbitda * 10) / 10 : 10,
      midYear: true,
      normalizeTerminal: true,
      rf,
      beta: Math.round((d.beta?.adjusted ?? d.stats.yahooBeta ?? 1) * 100) / 100,
      erp: 0.05,
      crp: idr ? 0.02 : 0,
      kd: isNum(kd) && kd > 0.005 && kd < 0.2 ? kd : rf + 0.015,
      waccOverride: null,
    },
    comps: { peers: d.peers.slice(0, 6), auto: true },
    deals: [],
    premium: { low: 0.2, high: 0.4 },
    ddm: { d0: d.dividends?.ttm || d.stats.dividendRate || 0, g1: clamp(ddmG, -0.05, 0.15), n: 5, g2: gT, keOverride: null },
    weights: {
      w52: 0,
      street: 0,
      dcfG: d.financialCo ? 0 : 1,
      dcfX: d.financialCo ? 0 : 1,
      ddm: d.financialCo || (d.stats.dividendYield || 0) > 0.03 ? 1 : 0,
      pe: 1,
      fwdPe: 1,
      evEbitda: d.financialCo ? 0 : 1,
      evSales: 0,
      pb: d.financialCo ? 1 : 0,
      dealEbitda: 1,
      dealSales: 0,
      dealPremium: 1,
      premium: 0,
    },
    hidden: {},
    notes: '',
  };
}

function mergeModel(def, saved) {
  if (!saved) return def;
  const out = { ...def };
  for (const k of Object.keys(def)) {
    if (saved[k] == null) continue;
    out[k] = Array.isArray(def[k]) ? saved[k] : typeof def[k] === 'object' && def[k] !== null ? { ...def[k], ...saved[k] } : saved[k];
  }
  return out;
}

export default {
  id: 'val',
  title: 'Valuation',
  async mount(root, { args, query }, ctx) {
    const sym = (args[0] || query.get('s') || '').toUpperCase();
    const searchIn = h('input', { class: 'in', placeholder: 'Ticker, e.g. AAPL or BBCA.JK', value: sym, style: { width: '210px' }, 'aria-label': 'Ticker to value' });
    const go = () => searchIn.value.trim() && ctx.navigate(`#/val/${encodeURIComponent(searchIn.value.trim().toUpperCase())}`);
    searchIn.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    const quoteLine = h('span', { class: 'sub' });
    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'VAL · VALUATION'), quoteLine, h('span', { class: 'spacer' }), searchIn, h('button', { class: 'btn primary', onclick: go }, 'Value it')));
    const mine = h('div', { class: 'chips', style: { marginBottom: '6px' } });
    root.append(mine);
    drawMine();
    function drawMine() {
      const saved = Object.entries(state().saved || {}).filter(([k, v]) => k.startsWith('val:') && v?.summary);
      mine.innerHTML = saved.length ? '<span class="muted">Your valuations:</span>' : '';
      for (const [k, v] of saved.sort((a, b) => (b[1].summary.at || '').localeCompare(a[1].summary.at || ''))) {
        const s = k.slice(4);
        const up = V.upside(v.summary.mid, v.summary.price);
        mine.append(h('a', { class: 'chip', href: `#/val/${encodeURIComponent(s)}`, title: `Fair value ${price(v.summary.mid)} vs price ${price(v.summary.price)} when saved` }, s, h('span', { class: cls(up) }, isNum(up) ? pctf(up, 0, { sign: true }) : '')));
      }
    }
    if (!sym) {
      root.append(h('div', { class: 'empty' }, h('div', {}, 'Type a stock ticker above to value it — US (AAPL, MSFT) or Indonesian (BBCA.JK, TLKM.JK).'), h('p', { class: 'note' }, 'You get the analysts’ consensus and price targets, then build your own valuation with a DCF, comparable companies, precedent deals and a dividend model, summarised in a football-field chart.')));
      return;
    }

    const grid = h('div', { class: 'grid' });
    root.append(grid);
    const P = (title, c, opts) => {
      const p = panel({ title, ...opts });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const ffP = P('Football Field — Value per Share', 'c8');
    const youP = P('Your Fair Value', 'c4');
    const streetP = P('Wall Street View', 'c6');
    const estP = P('Estimates & Analyst Actions', 'c6', { bodyCls: 'flush scroll h420' });
    const dcfP = P('Discounted Cash Flow (FCFF)', 'c12');
    const compsP = P('Comparable Companies', 'c7');
    const ddmP = P('Dividend Discount Model', 'c5');
    const dealsP = P('Precedent Transactions & Takeover Premium', 'c12');
    loading(ffP.body);

    let d;
    try {
      d = await api.valuation(sym);
    } catch (err) {
      errorBox(ffP.body, err);
      return;
    }
    if (!ctx.alive) return;
    if (!isNum(d.price)) {
      errorBox(ffP.body, new Error(`No price for ${sym}`));
      return;
    }
    const CCY = d.currency;
    const B = basics(d);
    const defaults = defaultsFrom(d);
    let model = mergeModel(defaults, savedInputs(KEY(sym)));
    const px = (v) => (isNum(v) ? `${price(v, CCY === 'IDR' ? 0 : 2)}` : DASH);
    const big = (v) => fmtBig(v, CCY, 2);
    quoteLine.innerHTML = `<b class="amber">${esc(d.symbol)}</b> ${esc(d.name)} · <b>${px(d.price)}</b> ${esc(CCY)} <span class="${cls(d.changePct)}">${pct(d.changePct)}</span> · ${esc([d.sector, d.industry].filter(Boolean).join(' / '))}`;
    if (d.warnings.length) grid.before(h('div', { class: 'note warn', style: { margin: '0 0 6px' }, html: d.warnings.map(esc).join('<br>') }));

    let saveTimer = null;
    let lastRows = [];
    const persist = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const blend = V.blend(lastRows.filter((r) => !model.hidden[r.id]).map((r) => ({ ...r, weight: model.weights[r.id] || 0 })));
        saveInputs(KEY(sym), { ...model, summary: blend ? { ...blend, price: d.price, at: new Date().toISOString() } : null });
        drawMine();
      }, 800);
    };
    const recalc = () => {
      drawDcfOut();
      drawCompsOut();
      drawDdmOut();
      drawDealsOut();
      drawField();
      persist();
    };

    // number input bound to obj[key]; pct inputs show percent, store decimals
    function field(obj, key, label, { pct: isPct = false, step = 'any', hint = '', on = recalc } = {}) {
      const v = obj[key];
      const input = h('input', { class: 'in num', type: 'number', step: String(step), value: isNum(v) ? String(isPct ? +(v * 100).toFixed(3) : +v.toFixed(6)) : '' });
      input.addEventListener('input', () => {
        const x = input.value === '' ? null : Number(input.value);
        obj[key] = x == null || !Number.isFinite(x) ? null : isPct ? x / 100 : x;
        on();
      });
      return h('label', { title: hint }, `${label}${isPct ? ' %' : ''}`, input, hint ? h('span', { class: 'hint' }, hint) : null);
    }

    // ================= Wall Street view =================
    const A = d.analysts;
    const tile = (l, v, s = '', c = '') => `<div class="tile"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
    const upTxt = (v) => (isNum(v) ? `<span class="${cls(V.upside(v, d.price))}">${pctf(V.upside(v, d.price), 1, { sign: true })}</span> vs price` : '');
    {
      const tr = A.trend[0];
      const total = tr ? tr.strongBuy + tr.buy + tr.hold + tr.sell + tr.strongSell : 0;
      streetP.body.innerHTML = `<div class="tiles">${[
        tile('Consensus', esc(REC[A.recommendationKey] || (A.recommendationKey ? A.recommendationKey : DASH)), isNum(A.recommendationMean) ? `<span title="1 = strong buy … 5 = sell">score ${num(A.recommendationMean, 2)} (1 best – 5)</span>` : '', /buy/.test(A.recommendationKey || '') ? 'up' : /sell|under/.test(A.recommendationKey || '') ? 'down' : ''),
        tile('Analysts', isNum(A.n) ? String(A.n) : total ? String(total) : DASH, 'with a price target'),
        tile('Mean target', px(A.targetMean), upTxt(A.targetMean)),
        tile('Median target', px(A.targetMedian), upTxt(A.targetMedian)),
        tile('Target range', isNum(A.targetLow) ? `${px(A.targetLow)} – ${px(A.targetHigh)}` : DASH, 'lowest – highest'),
      ].join('')}</div>`;
      if (A.trend.length && total) {
        const seg = [['strongBuy', 'Strong buy', 'var(--up)'], ['buy', 'Buy', 'color-mix(in srgb, var(--up) 55%, var(--panel))'], ['hold', 'Hold', 'var(--heat-mid)'], ['sell', 'Sell', 'color-mix(in srgb, var(--down) 55%, var(--panel))'], ['strongSell', 'Strong sell', 'var(--down)']];
        const label = { '0m': 'Now', '-1m': '1 mo ago', '-2m': '2 mo ago', '-3m': '3 mo ago' };
        streetP.body.insertAdjacentHTML(
          'beforeend',
          `<div class="cw-sec" style="margin-top:10px">Recommendations over time</div>${legend(seg.map(([, n, c]) => ({ name: n, color: c, box: true })))}
          ${A.trend
            .map((t) => {
              const n = seg.reduce((s, [k]) => s + (t[k] || 0), 0);
              return `<div class="row" style="gap:6px;margin:3px 0"><span class="muted" style="width:62px">${label[t.period] || esc(t.period)}</span><div style="display:flex;gap:2px;flex:1;height:16px">${seg
                .filter(([k]) => t[k])
                .map(([k, nm, c]) => `<div title="${nm}: ${t[k]}" style="flex:${t[k]};background:${c};color:var(--text);font-size:10px;display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden">${t[k]}</div>`)
                .join('')}</div><span class="muted" style="width:24px;text-align:right">${n}</span></div>`;
            })
            .join('')}`,
        );
      }
      const nq = d.nasdaq;
      if (nq) {
        streetP.body.insertAdjacentHTML(
          'beforeend',
          `<div class="cw-sec" style="margin-top:10px">Cross-check · ${esc(nq.source)}</div>
          <p class="prose" style="margin:4px 0">Targets ${px(nq.targetLow)} – ${px(nq.targetHigh)}, mean <b>${px(nq.targetMean)}</b> (${upTxt(nq.targetMean)}). Ratings: <span class="up">${nq.buy ?? DASH} buy</span> · ${nq.hold ?? DASH} hold · <span class="down">${nq.sell ?? DASH} sell</span>${nq.meanRating ? ` · mean rating <b>${esc(nq.meanRating)}</b>` : ''}. ${esc(nq.summary)}</p>
          ${nq.brokers.length ? `<p class="note" style="margin:0">Covering firms: ${esc(nq.brokers.join(', '))}</p>` : ''}`,
        );
      }
      streetP.setFoot(`Source: ${esc(A.source)}${d.nasdaq ? ' and Nasdaq' : ''} · analyst figures are opinions, not facts — compare them with your own work below.`);
    }

    // ================= estimates & actions =================
    {
      const nm = { '0q': 'Current quarter', '+1q': 'Next quarter', '0y': 'Current fiscal year', '+1y': 'Next fiscal year' };
      let html = A.estimates.length
        ? `<table class="t compact"><thead><tr><th>Period</th><th>Ends</th><th class="r">EPS est.</th><th class="r">Low – high</th><th class="r">Analysts</th><th class="r">EPS growth</th><th class="r">Revenue est.</th></tr></thead><tbody>${A.estimates
            .map((e) => `<tr><td>${esc(nm[e.period] || e.period)}</td><td class="dim">${e.end ? esc(date(e.end)) : DASH}</td><td class="r b">${px(e.eps)}</td><td class="r dim">${px(e.low)} – ${px(e.high)}</td><td class="r">${e.n ?? DASH}</td><td class="r ${cls(e.growth)}">${isNum(e.growth) ? pctf(e.growth, 1, { sign: true }) : DASH}</td><td class="r">${big(e.revenue)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<div class="empty">No consensus estimates published for this stock.</div>';
      if (d.nasdaq?.epsYearly?.length) {
        html += `<div class="cw-sec" style="margin:8px 8px 0">Longer-range EPS consensus (Nasdaq)</div><table class="t compact"><thead><tr><th>Fiscal year</th><th class="r">EPS</th><th class="r">Low – high</th><th class="r">Estimates</th></tr></thead><tbody>${d.nasdaq.epsYearly.map((e) => `<tr><td>${esc(e.fiscalEnd)}</td><td class="r b">${px(e.eps)}</td><td class="r dim">${px(e.low)} – ${px(e.high)}</td><td class="r">${e.n ?? DASH}</td></tr>`).join('')}</tbody></table>`;
      }
      const act = { up: ['Upgrade', 'up'], down: ['Downgrade', 'down'], init: ['Initiated', 'amber'], main: ['Maintained', 'dim'], reit: ['Reiterated', 'dim'] };
      html += `<div class="cw-sec" style="margin:8px 8px 0">Recent analyst actions (12 months)</div>`;
      html += A.actions.length
        ? `<table class="t compact"><thead><tr><th>Date</th><th>Firm</th><th>Action</th><th>Rating</th><th class="r">Price target</th></tr></thead><tbody>${A.actions
            .map((a) => {
              const [t, c] = act[a.action] || [a.action || DASH, 'dim'];
              const pt = isNum(a.target) ? `${a.priorTarget ? `<span class="muted">${px(a.priorTarget)} →</span> ` : ''}<b class="${a.priorTarget ? cls(a.target - a.priorTarget) : ''}">${px(a.target)}</b>` : DASH;
              return `<tr><td class="dim">${esc(date(a.date))}</td><td>${esc(a.firm)}</td><td class="${c}">${esc(t)}</td><td>${a.fromGrade && a.fromGrade !== a.toGrade ? `<span class="muted">${esc(a.fromGrade)} →</span> ` : ''}${esc(a.toGrade || DASH)}</td><td class="r">${pt}</td></tr>`;
            })
            .join('')}</tbody></table>`
        : `<div class="empty">${/\.[A-Z]{1,3}$/.test(sym) ? 'Individual broker actions are not published by the free sources for this market — the consensus and targets on the left cover it.' : 'No analyst actions in the last 12 months.'}</div>`;
      estP.body.innerHTML = html;
    }

    // ================= DCF =================
    const dcfIn = h('div');
    const dcfOut = h('div');
    dcfP.body.append(h('div', { class: 'val-split' }, dcfIn, dcfOut));
    function drawDcfInputs() {
      const m = model.dcf;
      dcfIn.innerHTML = '';
      const sec = (t) => h('div', { class: 'cw-sec' }, t);
      const termSel = h('select', { class: 'in' }, h('option', { value: 'gordon', selected: m.terminal === 'gordon' }, 'Perpetual growth (Gordon)'), h('option', { value: 'exit', selected: m.terminal === 'exit' }, 'Exit EV/EBITDA multiple'));
      termSel.addEventListener('change', () => {
        m.terminal = termSel.value;
        recalc();
      });
      const norm = h('input', { type: 'checkbox', checked: m.normalizeTerminal !== false });
      norm.addEventListener('change', () => {
        m.normalizeTerminal = norm.checked;
        recalc();
      });
      const mid = h('input', { type: 'checkbox', checked: !!m.midYear });
      mid.addEventListener('change', () => {
        m.midYear = mid.checked;
        recalc();
      });
      const yearsSel = h('select', { class: 'in' }, ...[3, 5, 7, 10].map((n) => h('option', { value: n, selected: m.years === n }, `${n} years`)));
      yearsSel.addEventListener('change', () => {
        m.years = Number(yearsSel.value);
        recalc();
      });
      dcfIn.append(
        sec('Operations'),
        h('div', { class: 'form' },
          field(m, 'revenue0', `Base revenue (${CCY})`, { hint: `TTM: ${big(B.revenue)}` }),
          h('label', {}, 'Forecast', yearsSel),
          field(m, 'g1', 'Revenue growth, year 1', { pct: true, hint: 'analyst estimate or 3-yr history' }),
          field(m, 'gN', 'Revenue growth, final year', { pct: true, hint: 'growth fades in a straight line' }),
          field(m, 'm1', 'EBIT margin, year 1', { pct: true, hint: 'TTM operating margin' }),
          field(m, 'mN', 'EBIT margin, final year', { pct: true }),
          field(m, 'tax', 'Tax rate', { pct: true }),
          field(m, 'daPct', 'D&A (of revenue)', { pct: true }),
          field(m, 'capexPct', 'Capex (of revenue)', { pct: true }),
          field(m, 'nwcPct', 'Working capital (of revenue increase)', { pct: true, hint: 'extra capital tied up per unit of growth' }),
        ),
        sec('Discount rate (WACC)'),
        h('div', { class: 'form' },
          field(m, 'rf', 'Risk-free rate', { pct: true, hint: d.riskFree?.label || '' }),
          field(m, 'beta', 'Beta', { hint: d.beta ? `${num(d.beta.raw, 2)} raw vs ${d.beta.benchmark}, 2y weekly → adjusted ${num(d.beta.adjusted, 2)}` : 'no history — 1.0' }),
          field(m, 'erp', 'Equity risk premium', { pct: true, hint: 'your assumption (typ. 4–6%)' }),
          field(m, 'crp', 'Country risk premium', { pct: true, hint: 'extra for emerging markets; your assumption' }),
          field(m, 'kd', 'Pre-tax cost of debt', { pct: true, hint: 'interest expense ÷ debt' }),
          field(m, 'waccOverride', 'WACC override', { pct: true, hint: 'leave blank to use the build-up' }),
        ),
        sec('Terminal value'),
        h('div', { class: 'form' },
          h('label', {}, 'Method', termSel),
          field(m, 'g', 'Perpetual growth', { pct: true, hint: 'long-run nominal growth; must be < WACC' }),
          field(m, 'exitMultiple', 'Exit EV/EBITDA (×)', { hint: isNum(d.stats.evToEbitda) ? `today: ${num(d.stats.evToEbitda, 1)}×` : '' }),
          h('label', { title: 'Cash flows arrive through the year, not all on 31 December' }, 'Mid-year discounting', h('span', { class: 'row' }, mid, h('span', { class: 'hint' }, 'standard practice'))),
          h('label', { title: 'In the perpetuity, spending on assets must at least replace what wears out' }, 'Terminal capex ≥ D&A', h('span', { class: 'row' }, norm, h('span', { class: 'hint' }, isNum(m.daPct) && isNum(m.capexPct) && m.daPct > m.capexPct ? `matters here: D&A ${pctf(m.daPct, 1)} > capex ${pctf(m.capexPct, 1)}` : 'recommended'))),
        ),
      );
    }
    function waccNow(m = model.dcf) {
      const ke = V.capm({ rf: m.rf ?? 0, beta: m.beta ?? 1, erp: m.erp ?? 0, crp: m.crp ?? 0 });
      const w = isNum(m.waccOverride) ? m.waccOverride : V.wacc({ costEquity: ke, costDebt: m.kd ?? 0, taxRate: m.tax ?? 0, equity: B.equityMV, debt: d.financialCo ? 0 : B.debt });
      return { ke, w };
    }
    function runDcf(over = {}) {
      const m = { ...model.dcf, ...over };
      const need = ['revenue0', 'g1', 'gN', 'm1', 'mN', 'tax', 'daPct', 'capexPct', 'nwcPct'];
      if (need.some((k) => !isNum(m[k])) || !B.shares) return null;
      const n = m.years || 5;
      return V.dcf({ revenue0: m.revenue0, growth: V.linearPath(m.g1, m.gN, n), margin: V.linearPath(m.m1, m.mN, n), taxRate: m.tax, daPct: m.daPct, capexPct: m.capexPct, nwcPct: m.nwcPct, wacc: over.wacc ?? waccNow(m).w, terminal: m.terminal, g: m.g ?? 0.02, exitMultiple: m.exitMultiple ?? 10, netDebt: B.netDebt, minority: B.minority, shares: B.shares, midYear: !!m.midYear, normalizeTerminal: m.normalizeTerminal !== false });
    }
    let dcfRes = null;
    function drawDcfOut() {
      const m = model.dcf;
      const { ke, w } = waccNow();
      dcfRes = runDcf();
      if (!dcfRes) {
        dcfOut.innerHTML = `<div class="empty">The DCF needs base revenue and an EBIT margin${d.financialCo ? ' — for a bank or insurer, use the dividend model and P/E or P/B comparables instead' : ''}. Enter them on the left to run it.</div>`;
        return;
      }
      const r = dcfRes;
      const up = V.upside(r.perShare, d.price);
      const ann = (d.financials?.annual || []).slice(-3);
      const head = [...ann.map((a) => `<th class="r">${esc(a.date.slice(0, 4))}A</th>`), `<th class="r">TTM</th>`, ...r.rows.map((x) => `<th class="r amber">Y${x.year}</th>`)].join('');
      const T = d.financials?.ttm || {};
      const hrow = (label, hist, proj, fmt = big, c = '') => `<tr><td class="${c}">${label}</td>${hist.map((v) => `<td class="r dim">${fmt(v)}</td>`).join('')}${proj.map((v) => `<td class="r ${c}">${fmt(v)}</td>`).join('')}</tr>`;
      const pc = (v) => (isNum(v) ? pctf(v, 1) : DASH);
      const histRev = [...ann.map((a) => a.revenue), T.revenue];
      const histEbit = [...ann.map((a) => a.ebit), T.ebit];
      const growthHist = histRev.map((v, i) => (i && isNum(v) && histRev[i - 1] ? v / histRev[i - 1] - 1 : null));
      growthHist[growthHist.length - 1] = null; // TTM overlaps the last fiscal year
      const table = `<table class="t compact"><thead><tr><th>${esc(CCY)}</th>${head}</tr></thead><tbody>
        ${hrow('Revenue', histRev, r.rows.map((x) => x.revenue), big, 'b')}
        ${hrow('Growth', growthHist, r.rows.map((x) => x.growth), pc)}
        ${hrow('EBIT', histEbit, r.rows.map((x) => x.ebit))}
        ${hrow('EBIT margin', histEbit.map((v, i) => (isNum(v) && histRev[i] ? v / histRev[i] : null)), r.rows.map((x) => x.margin), pc)}
        ${hrow('− Taxes on EBIT', [...ann.map(() => null), null], r.rows.map((x) => x.ebit - x.nopat))}
        ${hrow('+ D&A', [...ann.map((a) => a.da), T.da], r.rows.map((x) => x.da))}
        ${hrow('− Capex', [...ann.map((a) => a.capex), T.capex], r.rows.map((x) => x.capex))}
        ${hrow('− Δ Working capital', [...ann.map((a) => (isNum(a.changeInWc) ? -a.changeInWc : null)), null], r.rows.map((x) => x.dNwc))}
        ${hrow('Free cash flow to firm', [...ann.map((a) => a.fcf), T.fcf], r.rows.map((x) => x.fcff), big, 'b amber')}
        ${hrow('Discount factor', [...ann.map(() => null), null], r.rows.map((x) => x.df), (v) => (isNum(v) ? num(v, 3) : ''))}
        ${hrow('Present value', [...ann.map(() => null), null], r.rows.map((x) => x.pv))}
      </tbody></table>`;
      // Sensitivity: WACC × terminal growth (or exit multiple).
      const ws = [-0.01, -0.005, 0, 0.005, 0.01].map((x) => w + x);
      const gordon = m.terminal !== 'exit';
      const cs = gordon ? [-0.01, -0.005, 0, 0.005, 0.01].map((x) => (m.g ?? 0.02) + x) : [0.8, 0.9, 1, 1.1, 1.2].map((x) => Math.round((m.exitMultiple ?? 10) * x * 10) / 10);
      const sens = V.grid(ws, cs, (wv, cv) => runDcf(gordon ? { wacc: wv, g: cv } : { wacc: wv, exitMultiple: cv })?.perShare);
      const tint = (v) => {
        const u = V.upside(v, d.price);
        if (!isNum(u)) return '';
        const a = Math.min(35, Math.abs(u) * 100);
        return `background:color-mix(in srgb, ${u >= 0 ? 'var(--up)' : 'var(--down)'} ${a.toFixed(0)}%, transparent)`;
      };
      const sensHtml = `<table class="t compact sens"><thead><tr><th>WACC ↓ / ${gordon ? 'growth' : 'exit ×'} →</th>${cs.map((c) => `<th class="r">${gordon ? pctf(c, 1) : num(c, 1) + '×'}</th>`).join('')}</tr></thead><tbody>${ws
        .map((wv, i) => `<tr><td class="amber">${pctf(wv, 1)}</td>${sens[i].map((v, j) => `<td class="r ${i === 2 && j === 2 ? 'b' : ''}" style="${tint(v)}">${isNum(v) && v > 0 ? px(v) : 'n/m'}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
      dcfOut.innerHTML = `<div class="tiles">${[
        tile('Value per share', px(r.perShare), `<span class="${cls(up)}">${pctf(up, 1, { sign: true })}</span> vs ${px(d.price)}`, cls(up)),
        tile('WACC', pctf(w, 2), isNum(m.waccOverride) ? 'your override' : `cost of equity ${pctf(ke, 2)} · debt ${pctf(B.equityMV + B.debt ? B.debt / (B.equityMV + B.debt) : 0, 0)} of capital`),
        tile('Enterprise value', big(r.ev), `terminal value ${pctf(r.tvShare, 0)} of it`),
        tile('Equity value', big(r.equity), `EV − net debt ${big(B.netDebt)}${B.minority ? ` − minorities ${big(B.minority)}` : ''}`),
        tile(gordon ? 'Implied exit multiple' : 'Implied perpetual growth', gordon ? `${num(r.impliedExitMultiple, 1)}× EBITDA` : pctf(r.impliedGrowth, 2), 'sanity check of the terminal value'),
      ].join('')}</div>
        <div style="margin-top:8px;overflow-x:auto">${table}</div>
        <div class="cw-sec">Sensitivity — value per share</div><div style="overflow-x:auto">${sensHtml}</div>
        <p class="note">${esc(B.shares ? `${num(B.shares / 1e6, 1)}M shares` : '')} · FCFF = EBIT × (1 − tax) + D&amp;A − capex − Δ working capital · cost of equity = risk-free + beta × equity premium${m.crp ? ' + country premium' : ''} · ${m.midYear ? 'mid-year' : 'year-end'} discounting${r.tvShare > 0.8 ? ' · <span class="warn">over 80% of the value sits in the terminal value — small changes in growth or WACC move it a lot</span>' : ''}</p>`;
    }

    // ================= comparables =================
    let peers = [];
    let peerErrors = {};
    const compsIn = h('div');
    const compsOut = h('div');
    compsP.body.append(compsIn, compsOut);
    function drawCompsIn() {
      const add = h('input', { class: 'in', placeholder: 'add ticker', style: { width: '110px' }, 'aria-label': 'Add a comparable company' });
      const doAdd = () => {
        const s = add.value.trim().toUpperCase();
        if (s && !model.comps.peers.includes(s) && s !== sym) {
          model.comps.peers.push(s);
          loadPeers();
        }
        add.value = '';
      };
      add.addEventListener('keydown', (e) => e.key === 'Enter' && doAdd());
      const chips = h('div', { class: 'chips' }, h('span', { class: 'muted' }, 'Peers:'), ...model.comps.peers.map((p) => h('span', { class: 'chip' }, p, h('button', { title: `Remove ${p}`, onclick: () => {
        model.comps.peers = model.comps.peers.filter((x) => x !== p);
        loadPeers();
      } }, '×'))), add, h('button', { class: 'btn sm', onclick: doAdd }, 'Add'));
      compsIn.innerHTML = '';
      compsIn.append(chips, h('p', { class: 'note', style: { margin: '4px 0' } }, 'Suggested peers come from Yahoo Finance’s “similar stocks” — replace them with true competitors (same business, size and market) for a meaningful range.'));
    }
    async function loadPeers() {
      drawCompsIn();
      if (!model.comps.peers.length) {
        peers = [];
        recalc();
        return;
      }
      compsOut.innerHTML = '<div class="loading">Loading peer multiples</div>';
      try {
        const r = await api.peers(model.comps.peers);
        peers = r.peers;
        peerErrors = r.errors;
        // First visit: keep only peers in the same industry when at least two are.
        if (model.comps.auto && d.industry) {
          model.comps.auto = false;
          const same = peers.filter((p) => p.industry === d.industry);
          if (same.length >= 2 && same.length < peers.length) {
            const dropped = peers.filter((p) => p.industry !== d.industry).map((p) => p.symbol);
            peers = same;
            model.comps.peers = same.map((p) => p.symbol);
            drawCompsIn();
            toast(`Comparables: kept ${same.length} ${d.industry} peers, dropped ${dropped.join(', ')} (different industry)`);
          }
        }
      } catch (err) {
        peers = [];
        peerErrors = { all: err.message };
      }
      if (ctx.alive) recalc();
    }
    const compStats = () => Object.fromEntries(MULTIPLES.map(([k]) => [k, V.quartiles(peers.map((p) => p[k]).filter((v) => sane(k, v)))]));
    const own = { pe: d.stats.trailingPE, fwdPe: d.stats.forwardPE, evEbitda: d.stats.evToEbitda, evSales: d.stats.evToRevenue, pb: d.stats.priceToBook };
    function impliedFromMultiple(kind, metricKey, mult) {
      const metric = B[metricKey];
      if (!isNum(metric) || !isNum(mult) || metric <= 0) return null;
      return kind === 'equity' ? V.fromEquityMultiple(mult, metric) : V.fromEvMultiple(mult, metric, { netDebt: B.netDebt, minority: B.minority, shares: B.shares });
    }
    function drawCompsOut() {
      if (!model.comps.peers.length) {
        compsOut.innerHTML = '<div class="empty">Add at least two peers to value the company on their multiples.</div>';
        return;
      }
      if (!peers.length && !Object.keys(peerErrors).length) return;
      const st = compStats();
      const x = (v) => (isNum(v) ? `${num(v, 1)}×` : DASH);
      const cell = (k, v) => (isNum(v) && !sane(k, v) ? `<span class="muted" title="Implausible — left out of the statistics">${x(v)}</span>` : x(v));
      const rows = peers.map((p) => `<tr><td class="sym">${esc(p.symbol)}</td><td class="nm" title="${esc([p.industry, p.note].filter(Boolean).join(' · '))}">${esc(p.name)}${p.industry && d.industry && p.industry !== d.industry ? ` <span class="warn" title="${esc(p.industry)} — not ${esc(d.industry)}">≠</span>` : ''}${p.note ? ' <span class="warn">*</span>' : ''}</td><td class="r">${fmtBig(p.marketCap, p.currency || CCY, 1)}</td>${MULTIPLES.map(([k]) => `<td class="r">${cell(k, p[k])}</td>`).join('')}<td class="r">${isNum(p.divYield) ? pctf(p.divYield, 1) : DASH}</td><td class="r">${isNum(p.roe) ? pctf(p.roe, 0) : DASH}</td></tr>`).join('');
      const statRow = (label, k, c = '') => `<tr class="${c}"><td colspan="3" class="${c}">${label}</td>${MULTIPLES.map(([m]) => `<td class="r">${x(st[m]?.[k])}</td>`).join('')}<td></td><td></td></tr>`;
      const implied = MULTIPLES.map(([k, label, metric, kind]) => {
        const s = st[k];
        const lo = s && impliedFromMultiple(kind, metric, s.q1);
        const mid = s && impliedFromMultiple(kind, metric, s.median);
        const hi = s && impliedFromMultiple(kind, metric, s.q3);
        return `<tr><td>${label}</td><td class="r dim">${isNum(B[metric]) ? (kind === 'ev' ? big(B[metric]) : px(B[metric])) : DASH}</td><td class="r">${px(lo)}</td><td class="r b">${px(mid)}</td><td class="r">${px(hi)}</td><td class="r ${cls(V.upside(mid, d.price))}">${isNum(mid) ? pctf(V.upside(mid, d.price), 1, { sign: true }) : DASH}</td></tr>`;
      }).join('');
      compsOut.innerHTML = `<div style="overflow-x:auto"><table class="t compact"><thead><tr><th>Ticker</th><th>Name</th><th class="r">Mkt cap</th>${MULTIPLES.map(([, l]) => `<th class="r">${l}</th>`).join('')}<th class="r">Div yld</th><th class="r">ROE</th></tr></thead><tbody>${rows}</tbody>
        <tfoot>${statRow('25th percentile', 'q1')}${statRow('Median', 'median', 'amber')}${statRow('75th percentile', 'q3')}<tr><td colspan="3" class="sym">${esc(sym)} today</td>${MULTIPLES.map(([k]) => `<td class="r b">${x(own[k])}</td>`).join('')}<td></td><td></td></tr></tfoot></table></div>
        <div class="cw-sec">Implied value per share (peer 25th – median – 75th)</div>
        <table class="t compact"><thead><tr><th>Multiple</th><th class="r">${esc(sym)} metric</th><th class="r">Low</th><th class="r">Mid</th><th class="r">High</th><th class="r">vs price</th></tr></thead><tbody>${implied}</tbody></table>
        ${Object.keys(peerErrors).length ? `<p class="note warn">No data for: ${esc(Object.keys(peerErrors).join(', '))}</p>` : ''}
        ${d.industry && peers.length && !peers.some((p) => p.industry === d.industry) ? `<p class="note warn">None of these peers is in ${esc(d.industry)} (≠). Add real competitors with the box above for a meaningful comparison.</p>` : ''}
        ${peers.some((p) => p.note) ? `<p class="note">* ${esc(peers.filter((p) => p.note).map((p) => `${p.symbol} ${p.note}`).join('; '))}.</p>` : ''}
        <p class="note">P/E × EPS and P/B × book value per share give a price directly; EV multiples × EBITDA or revenue give an enterprise value, then net debt${B.minority ? ' and minorities are' : ' is'} subtracted. Negative or missing multiples are ignored.</p>`;
    }

    // ================= dividend discount model =================
    const ddmIn = h('div', { class: 'form' });
    const ddmOut = h('div');
    ddmP.body.append(ddmIn, ddmOut);
    function drawDdmIn() {
      const m = model.ddm;
      ddmIn.innerHTML = '';
      ddmIn.append(
        field(m, 'd0', `Dividend per share, last 12 mo (${CCY})`, { hint: d.dividends?.years?.length ? `paid: ${d.dividends.years.slice(-4).map((y) => `${y.year} ${px(y.dps)}`).join(' · ')}` : 'no dividend history' }),
        field(m, 'g1', 'Growth, stage 1', { pct: true, hint: `5-yr dividend growth ${isNum(d.dividends?.cagr5) ? pctf(d.dividends.cagr5, 1) : DASH} · ROE × retention ${isNum(d.stats.roe) && isNum(d.stats.payoutRatio) && d.stats.payoutRatio < 1 ? pctf(V.sustainableGrowth(d.stats.roe, d.stats.payoutRatio), 1) : DASH}` }),
        field(m, 'n', 'Stage 1 length (years)', { step: 1 }),
        field(m, 'g2', 'Long-run growth', { pct: true }),
        field(m, 'keOverride', 'Cost of equity override', { pct: true, hint: `blank = CAPM from the DCF inputs (${pctf(waccNow().ke, 2)})` }),
      );
    }
    let ddmRes = null;
    function drawDdmOut() {
      const m = model.ddm;
      const ke = isNum(m.keOverride) ? m.keOverride : waccNow().ke;
      if (!(m.d0 > 0)) {
        ddmRes = null;
        ddmOut.innerHTML = '<div class="empty">This company pays no dividend, so the dividend discount model does not apply.</div>';
        return;
      }
      const two = (r) => V.ddmTwoStage({ d0: m.d0, g1: m.g1 ?? 0, n: Math.max(1, Math.round(m.n || 5)), g2: m.g2 ?? 0.02, r });
      const gordon = V.ddmGordon({ d0: m.d0, g: m.g2 ?? 0.02, r: ke });
      ddmRes = { mid: two(ke), low: two(ke + 0.01), high: two(ke - 0.01), gordon, ke };
      const up = V.upside(ddmRes.mid, d.price);
      ddmOut.innerHTML = `<div class="tiles" style="margin-top:8px">${[
        tile('Two-stage value', px(ddmRes.mid), isNum(up) ? `<span class="${cls(up)}">${pctf(up, 1, { sign: true })}</span> vs price` : 'growth must be below cost of equity', cls(up)),
        tile('Gordon (one stage)', px(gordon), `long-run growth only`),
        tile('Cost of equity', pctf(ke, 2), `range ${px(ddmRes.low)} – ${px(ddmRes.high)} at ±1%`),
        tile('Dividend yield', isNum(d.stats.dividendYield) ? pctf(d.stats.dividendYield, 2) : pctf(m.d0 / d.price, 2), isNum(d.stats.payoutRatio) ? `payout ${pctf(d.stats.payoutRatio, 0)} of earnings` : ''),
      ].join('')}</div><p class="note">Value = dividends growing at stage-1 rate for ${Math.round(m.n || 5)} years, then at the long-run rate forever, discounted at the cost of equity. Best for steady payers such as banks, utilities and telecoms.</p>`;
    }

    // ================= precedent transactions =================
    const dealsIn = h('div');
    const dealsOut = h('div');
    dealsP.body.append(h('div', { class: 'val-split' }, dealsIn, dealsOut));
    function drawDealsIn() {
      dealsIn.innerHTML = '';
      const tbl = h('table', { class: 't compact' });
      tbl.innerHTML = `<thead><tr><th>Target</th><th>Acquirer</th><th>Year</th><th class="r">EV/EBITDA</th><th class="r">EV/Sales</th><th class="r" title="Price paid over the undisturbed share price">Premium %</th><th></th></tr></thead>`;
      const body = h('tbody');
      model.deals.forEach((deal, i) => {
        const cell = (k, type = 'number', w = '70px') => {
          const inp = h('input', { class: `in ${type === 'number' ? 'num' : ''}`, type, step: 'any', value: deal[k] ?? '', style: { width: w } });
          inp.addEventListener('input', () => {
            deal[k] = type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
            recalc();
          });
          return h('td', {}, inp);
        };
        body.append(h('tr', {}, cell('target', 'text', '120px'), cell('acquirer', 'text', '110px'), cell('year', 'number', '60px'), cell('evEbitda'), cell('evSales'), cell('premium'), h('td', {}, h('button', { class: 'btn sm', title: 'Remove', onclick: () => {
          model.deals.splice(i, 1);
          drawDealsIn();
          recalc();
        } }, '×'))));
      });
      tbl.append(body);
      const prem = model.premium;
      dealsIn.append(
        model.deals.length ? tbl : h('div', { class: 'empty', style: { padding: '8px' } }, 'No deals entered yet.'),
        h('div', { class: 'row', style: { margin: '6px 0' } }, h('button', { class: 'btn', onclick: () => {
          model.deals.push({ target: '', acquirer: '', year: new Date().getFullYear(), evEbitda: null, evSales: null, premium: null });
          drawDealsIn();
        } }, '+ Add deal')),
        h('p', { class: 'note' }, 'There is no free public database of deal multiples, so enter deals you find: merger proxies and fairness opinions list them (', h('a', { href: 'https://www.sec.gov/edgar/search/#/q=%22selected%20precedent%20transactions%22&forms=DEFM14A', target: '_blank', rel: 'noopener' }, 'search SEC filings'), '); for Indonesian deals see tender-offer disclosures on IDX. Use deals in the same industry from the last few years.'),
        h('div', { class: 'cw-sec' }, 'Takeover premium (if you have no deals)'),
        h('div', { class: 'form' }, field(prem, 'low', 'Premium low', { pct: true }), field(prem, 'high', 'Premium high', { pct: true, hint: 'typical control premiums: 20–40%' })),
      );
    }
    let dealRes = {};
    function drawDealsOut() {
      const st = (k) => {
        const v = model.deals.map((x) => x[k]).filter((x) => isNum(x) && x > 0);
        if (!v.length) return null;
        const q = V.quartiles(v);
        return v.length >= 4 ? { low: q.q1, mid: q.median, high: q.q3, n: v.length } : { low: q.min, mid: q.median, high: q.max, n: v.length };
      };
      const ebitda = st('evEbitda');
      const sales = st('evSales');
      const premium = st('premium');
      const ev = (s, metric) => s && { low: impliedFromMultiple('ev', metric, s.low), mid: impliedFromMultiple('ev', metric, s.mid), high: impliedFromMultiple('ev', metric, s.high), n: s.n, mult: s };
      dealRes = {
        dealEbitda: ev(ebitda, 'ebitda'),
        dealSales: ev(sales, 'revenue'),
        dealPremium: premium && { low: d.price * (1 + premium.low / 100), mid: d.price * (1 + premium.mid / 100), high: d.price * (1 + premium.high / 100), n: premium.n },
        premium: isNum(model.premium.low) && isNum(model.premium.high) ? { low: d.price * (1 + model.premium.low), mid: d.price * (1 + (model.premium.low + model.premium.high) / 2), high: d.price * (1 + model.premium.high) } : null,
      };
      const row = (label, r, extra = '') => `<tr><td>${label}</td><td class="r dim">${extra}</td><td class="r">${px(r?.low)}</td><td class="r b">${px(r?.mid)}</td><td class="r">${px(r?.high)}</td></tr>`;
      const m = (s, suffix) => (s ? `${num(s.low, 1)}–${num(s.high, 1)}${suffix} (${s.n})` : '');
      dealsOut.innerHTML = `<table class="t compact"><thead><tr><th>Method</th><th class="r">Range used</th><th class="r">Low</th><th class="r">Mid</th><th class="r">High</th></tr></thead><tbody>
        ${row('Deals — EV/EBITDA', dealRes.dealEbitda, m(ebitda, '×'))}${row('Deals — EV/Sales', dealRes.dealSales, m(sales, '×'))}${row('Deals — premium paid', dealRes.dealPremium, m(premium, '%'))}${row('Assumed takeover premium', dealRes.premium, `${pctf(model.premium.low, 0)}–${pctf(model.premium.high, 0)}`)}
      </tbody></table><p class="note">Deal values include a control premium, so they usually sit above trading comparables. With 4+ deals the 25th–75th percentile is used; with fewer, the full range.</p>`;
    }

    // ================= football field =================
    const ffBox = h('div');
    ffP.body.innerHTML = '';
    ffP.body.append(ffBox);
    ffP.meta.innerHTML = legend(Object.values(GROUPS).map((g) => ({ name: g.label, color: resolveVars(g.color), box: true })));
    function fieldRows() {
      const st = compStats();
      const rows = [];
      const push = (id, label, group, r, note = '') => {
        if (!r || ![r.low, r.mid, r.high].every(isNum) || r.mid <= 0) return;
        const [low, high] = [Math.max(0, Math.min(r.low, r.high)), Math.max(r.low, r.high)];
        rows.push({ id, label, group, low, mid: r.mid, high, note });
      };
      const s = d.stats;
      push('w52', '52-week trading range', 'market', isNum(s.low52) ? { low: s.low52, mid: (s.low52 + s.high52) / 2, high: s.high52 } : null);
      push('street', `Analyst price targets${isNum(A.n) ? ` (${A.n})` : ''}`, 'market', isNum(A.targetLow) ? { low: A.targetLow, mid: A.targetMedian ?? A.targetMean, high: A.targetHigh } : null);
      if (dcfRes) {
        const { w } = waccNow();
        const m = model.dcf;
        const at = (o) => runDcf(o)?.perShare;
        push('dcfG', 'DCF — perpetual growth', 'intrinsic', { low: at({ terminal: 'gordon', wacc: w + 0.01, g: (m.g ?? 0.02) - 0.005 }), mid: at({ terminal: 'gordon' }), high: at({ terminal: 'gordon', wacc: w - 0.01, g: (m.g ?? 0.02) + 0.005 }) }, 'WACC ±1%, growth ±0.5%');
        push('dcfX', 'DCF — exit multiple', 'intrinsic', { low: at({ terminal: 'exit', wacc: w + 0.01, exitMultiple: (m.exitMultiple ?? 10) * 0.85 }), mid: at({ terminal: 'exit' }), high: at({ terminal: 'exit', wacc: w - 0.01, exitMultiple: (m.exitMultiple ?? 10) * 1.15 }) }, 'WACC ±1%, multiple ±15%');
      }
      if (ddmRes) push('ddm', 'Dividend discount (2-stage)', 'intrinsic', ddmRes, 'cost of equity ±1%');
      for (const [k, label, metric, kind] of MULTIPLES) {
        const q = st[k];
        if (q) push(k, `Comps — ${label}`, 'relative', { low: impliedFromMultiple(kind, metric, q.q1), mid: impliedFromMultiple(kind, metric, q.median), high: impliedFromMultiple(kind, metric, q.q3) }, `${q.n} peers, 25th–75th pct`);
      }
      push('dealEbitda', 'Precedents — EV/EBITDA', 'relative', dealRes.dealEbitda);
      push('dealSales', 'Precedents — EV/Sales', 'relative', dealRes.dealSales);
      push('dealPremium', 'Precedents — premium paid', 'relative', dealRes.dealPremium);
      push('premium', 'Assumed takeover premium', 'relative', dealRes.premium);
      return rows;
    }
    function drawField() {
      const rows = fieldRows();
      lastRows = rows;
      const shown = rows.filter((r) => !model.hidden[r.id]);
      const fair = V.blend(shown.map((r) => ({ ...r, weight: model.weights[r.id] || 0 })));
      drawYou(rows, fair);
      if (!shown.length) {
        ffBox.innerHTML = '<div class="empty">No valuation ranges yet.</div>';
        return;
      }
      const W = Math.max(320, ffBox.clientWidth || ffP.body.clientWidth || 700);
      const narrow = W < 560;
      const labelW = narrow ? 92 : 200;
      const rowH = 28;
      const top = 22;
      const H = top + shown.length * rowH + 42;
      const vals = [...shown.flatMap((r) => [r.low, r.high]), d.price, ...(fair ? [fair.low, fair.high] : [])];
      let lo = Math.min(...vals);
      let hi = Math.max(...vals);
      const pad = (hi - lo) * 0.08 || hi * 0.1;
      lo = Math.max(0, lo - pad);
      hi += pad;
      const ticks = niceTicks(lo, hi, narrow ? 4 : 7);
      const x0 = labelW + 8;
      const x1 = W - 14;
      const X = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
      const yOf = (i) => top + i * rowH;
      const f = (v) => px(v);
      let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Football field of valuation ranges for ${esc(sym)}">`;
      const axisY = top + shown.length * rowH + 2;
      for (const t of ticks) svg += `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 4}" y2="${axisY}" stroke="var(--line)" /><text x="${X(t)}" y="${axisY + 13}" fill="var(--muted)" font-size="10" text-anchor="middle">${esc(f(t))}</text>`;
      if (fair) svg += `<rect x="${X(fair.low)}" y="${top - 4}" width="${Math.max(1, X(fair.high) - X(fair.low))}" height="${shown.length * rowH + 4}" fill="var(--text)" fill-opacity=".06" />`;
      shown.forEach((r, i) => {
        const y = yOf(i);
        const c = GROUPS[r.group].color;
        const w = model.weights[r.id] || 0;
        svg += `<g><title>${esc(r.label)}: ${f(r.low)} – ${f(r.high)}, mid ${f(r.mid)} (${pctf(V.upside(r.mid, d.price), 1, { sign: true })} vs price)${r.note ? ' · ' + esc(r.note) : ''}${w ? ` · weight ${w}` : ' · not in your blend'}</title>
          <text x="${labelW}" y="${y + 15}" fill="${w ? 'var(--text)' : 'var(--muted)'}" font-size="11" text-anchor="end">${esc(narrow ? SHORT[r.id] || r.label : r.label)}</text>
          <rect x="${X(r.low)}" y="${y + 6}" width="${Math.max(2, X(r.high) - X(r.low))}" height="13" rx="2" fill="${c}" fill-opacity="${w ? 0.9 : 0.4}" />
          <line x1="${X(r.mid)}" x2="${X(r.mid)}" y1="${y + 3}" y2="${y + 22}" stroke="var(--text)" stroke-width="2" />
          ${narrow ? '' : `<text x="${X(r.low) - 4}" y="${y + 16}" fill="var(--text-2)" font-size="10" text-anchor="end">${esc(f(r.low))}</text><text x="${X(r.high) + 4}" y="${y + 16}" fill="var(--text-2)" font-size="10">${esc(f(r.high))}</text>`}</g>`;
      });
      const pxX = X(d.price);
      const anchorAt = (x) => (x < x0 + 60 ? 'start' : x > x1 - 60 ? 'end' : 'middle');
      svg += `<line x1="${pxX}" x2="${pxX}" y1="${top - 8}" y2="${axisY}" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="4 3" /><text x="${pxX}" y="${top - 10}" fill="var(--amber)" font-size="10.5" text-anchor="${anchorAt(pxX)}">Price ${esc(f(d.price))}</text>`;
      if (fair) {
        const fx = X(fair.mid);
        svg += `<line x1="${fx}" x2="${fx}" y1="${top - 4}" y2="${axisY + 18}" stroke="var(--text)" stroke-width="2" /><text x="${fx}" y="${H - 4}" fill="var(--text)" font-size="10.5" font-weight="700" text-anchor="${anchorAt(fx)}">Your value ${esc(f(fair.mid))}</text>`;
      }
      ffBox.innerHTML = resolveVars(svg + '</svg>');
      ffP.setFoot(`Bars: low–high of each method; white tick = mid value; dashed line = current price; shaded band & solid line = your weighted fair value. Hover a bar for details. Faded bars have weight 0.`);
    }

    // ================= your fair value =================
    const notes = h('textarea', { class: 'in', rows: '4', style: { width: '100%', resize: 'vertical' }, placeholder: 'Your thesis: why the market is wrong (or right), key risks, what would change your mind…', 'aria-label': 'Valuation notes' });
    notes.value = model.notes || '';
    notes.addEventListener('input', () => {
      model.notes = notes.value;
      persist();
    });
    const youTiles = h('div');
    const youOut = h('div');
    youP.body.append(youTiles, youOut, h('div', { class: 'cw-sec' }, 'Notes'), notes, h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => {
      if (!confirm(`Reset all ${sym} assumptions to the values from the data? Your deals and notes are kept.`)) return;
      model = { ...defaultsFrom(d), deals: model.deals, notes: model.notes, comps: model.comps };
      youSig = '';
      drawInputs();
      recalc();
    } }, 'Reset assumptions'), h('span', { class: 'muted' }, 'Saved automatically on this computer')));
    let youSig = '';
    function drawYou(rows, fair) {
      const up = fair ? V.upside(fair.mid, d.price) : NaN;
      const vsStreet = fair && isNum(A.targetMean) ? V.upside(fair.mid, A.targetMean) : NaN;
      youTiles.innerHTML = `<div class="tiles">${[
        tile('Your fair value', fair ? px(fair.mid) : DASH, fair ? `range ${px(fair.low)} – ${px(fair.high)}` : 'give at least one method a weight', fair ? cls(up) : ''),
        tile('Upside / downside', fair ? pctf(up, 1, { sign: true }) : DASH, `vs ${px(d.price)} today`, fair ? cls(up) : ''),
        tile('vs analysts', isNum(vsStreet) ? pctf(vsStreet, 1, { sign: true }) : DASH, isNum(A.targetMean) ? `mean target ${px(A.targetMean)}` : 'no analyst target'),
      ].join('')}</div>`;
      // Same methods as before: update the numbers in place so a weight being typed keeps focus.
      const sig = rows.map((r) => r.id).join();
      if (sig === youSig) {
        for (const r of rows) {
          const tr = youOut.querySelector(`tr[data-id="${r.id}"]`);
          if (!tr) continue;
          tr.children[2].textContent = px(r.mid);
          tr.children[3].className = `r ${cls(V.upside(r.mid, d.price))}`;
          tr.children[3].textContent = pctf(V.upside(r.mid, d.price), 0, { sign: true });
        }
        return;
      }
      youSig = sig;
      const tbl = `<table class="t compact"><thead><tr><th title="Show on the chart">Show</th><th>Method</th><th class="r">Mid</th><th class="r">vs price</th><th class="r" title="Weight in your fair value (0 = reference only)">Weight</th></tr></thead><tbody>${rows
        .map((r) => `<tr data-id="${r.id}"><td><input type="checkbox" data-show ${model.hidden[r.id] ? '' : 'checked'} aria-label="Show ${esc(r.label)}"></td><td><span class="cw-dot" style="background:${resolveVars(GROUPS[r.group].color)};margin-right:4px"></span>${esc(r.label)}</td><td class="r">${px(r.mid)}</td><td class="r ${cls(V.upside(r.mid, d.price))}">${pctf(V.upside(r.mid, d.price), 0, { sign: true })}</td><td class="r"><input class="in num" data-w type="number" min="0" step="0.5" value="${model.weights[r.id] || 0}" style="width:52px" aria-label="Weight for ${esc(r.label)}"></td></tr>`)
        .join('')}</tbody></table>`;
      youOut.innerHTML = `<div style="margin-top:6px">${tbl}</div><p class="note">Fair value = weighted average of the methods' mid values (ranges likewise). Weights are yours: e.g. 2 on the method you trust most, 0 to keep a bar as reference only.</p>`;
    }
    youOut.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      if (e.target.matches('[data-w]')) {
        model.weights[tr.dataset.id] = Math.max(0, Number(e.target.value) || 0);
        clearTimeout(youOut._t);
        youOut._t = setTimeout(() => {
          drawField();
          persist();
        }, 300);
      }
    });
    youOut.addEventListener('change', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && e.target.matches('[data-show]')) {
        model.hidden[tr.dataset.id] = !e.target.checked;
        drawField();
        persist();
      }
    });

    function drawInputs() {
      drawDcfInputs();
      drawDdmIn();
      drawDealsIn();
      drawCompsIn();
    }
    drawInputs();
    recalc();
    loadPeers();
    // Redraw the chart when the panel is resized (phone rotation, window resize).
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = ffP.body.clientWidth;
      if (Math.abs(w - lastW) > 20) {
        lastW = w;
        drawField();
      }
    });
    ro.observe(ffP.body);
    ctx.onDestroy(() => ro.disconnect());
    if (d.errors.length) toast(`Some data unavailable: ${d.errors.join('; ')}`, true);
  },
};
