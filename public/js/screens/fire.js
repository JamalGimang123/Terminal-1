// FIRE — financial independence planner, Monte Carlo success odds, sensitivity, savings goals, emergency fund.
import { api } from '../api.js';
import { h, panel } from '../dom.js';
import { esc, num, money, pctf, years, DASH } from '../fmt.js';
import { lineChart, HEX, compactNum, sequentialColor } from '../charts.js';
import { state, saveInputs, savedInputs } from '../state.js';
import * as F from '../lib/fire.js';

const DEF = {
  age: 30, assets: 50000, income: 90000, spending: 50000, savings: '', nominalReturn: 7, inflation: 2.5, swr: 4,
  retirementSpending: '', retireAge: '', otherIncome: 0, otherIncomeAge: 67, incomeGrowth: 1, endAge: 95, vol: 15,
  goal: 30000, goalCurrent: 5000, goalYears: 3, goalReturn: 4.5, efMonthly: 3500, efMonths: 6,
};

const FIELDS = [
  ['age', 'Current age', 1],
  ['assets', 'Invested assets $', 'any'],
  ['income', 'Annual take-home income $', 'any'],
  ['spending', 'Annual spending $', 'any'],
  ['savings', 'Annual savings $', 'any', 'blank = income − spending'],
  ['nominalReturn', 'Expected return % (nominal)', 'any', 'average annual return, before inflation'],
  ['inflation', 'Inflation %', 'any'],
  ['swr', 'Safe withdrawal rate %', 'any', '4% = the classic “Trinity” rule'],
  ['retirementSpending', 'Retirement spending $/yr', 'any', 'blank = current spending'],
  ['retireAge', 'Planned retirement age', 1, 'blank = as soon as FI'],
  ['otherIncome', 'Pension / Social Security $/yr', 'any', "today's dollars"],
  ['otherIncomeAge', '…starting at age', 1],
  ['incomeGrowth', 'Real savings growth %/yr', 'any'],
  ['endAge', 'Plan until age', 1],
  ['vol', 'Return volatility %', 'any', 'for Monte Carlo (stocks ≈ 15–18%)'],
];

export default {
  id: 'fire',
  title: 'FIRE & Savings',
  async mount(root, _p, ctx) {
    const v = { ...DEF, ...(savedInputs('fire') || {}) };
    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'FIRE · FINANCIAL INDEPENDENCE & SAVINGS'), h('span', { class: 'sub' }, "All projections in today's dollars (real returns) unless noted")));
    const left = h('div', { class: 'stack-col c3' });
    const right = h('div', { class: 'stack-col c9' });
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
    const inP = P('Your Numbers', left);
    const tilesP = P('FIRE Summary', right);
    const chartP = P('Projection — Portfolio by Age', right);
    const sensP = P('Years to FI — Savings Rate × Real Return', 'c6', { bodyCls: 'flush' });
    const tableP = P('Year-by-Year Plan', 'c6', { bodyCls: 'flush scroll h420' });
    const goalP = P('Savings Goal Calculator', 'c6');
    const efP = P('Emergency Fund', 'c6');

    // ---- inputs ----
    const inputs = {};
    const form = h('div', { class: 'form', style: { gridTemplateColumns: '1fr 1fr' } });
    for (const [k, label, step, hint] of FIELDS) {
      const el = h('input', { class: 'in num', type: 'number', step: String(step), value: v[k] === '' ? '' : String(v[k]) });
      el.addEventListener('input', () => {
        v[k] = el.value === '' ? '' : Number(el.value);
        schedule();
      });
      inputs[k] = el;
      form.append(h('label', { title: hint || '' }, label, el, hint ? h('span', { class: 'hint' }, hint) : null));
    }
    const usePort = h('button', { class: 'btn sm', onclick: async () => {
      const st = state();
      const syms = [...new Set(st.positions.map((p) => p.symbol))];
      const { quotes } = await api.quotes(syms);
      const total = st.positions.reduce((s, p) => s + (quotes[p.symbol]?.price ?? p.costBasis) * p.shares, 0) + st.cash.reduce((s, c) => s + c.amount, 0);
      v.assets = Math.round(total);
      inputs.assets.value = String(v.assets);
      schedule();
    } }, 'Use my PORT value');
    inP.body.append(form, h('div', { class: 'row', style: { marginTop: '6px' } }, usePort));
    inP.setFoot('Inputs are saved locally.');

    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(compute, 250);
    };
    const n = (x, d = 0) => (x === '' || x == null || !Number.isFinite(Number(x)) ? d : Number(x));

    function params() {
      return {
        age: n(v.age, 30),
        assets: n(v.assets),
        income: n(v.income),
        spending: n(v.spending),
        annualSavings: v.savings === '' ? undefined : n(v.savings),
        nominalReturn: n(v.nominalReturn, 7) / 100,
        inflation: n(v.inflation, 2.5) / 100,
        withdrawalRate: Math.max(0.005, n(v.swr, 4) / 100),
        retirementSpending: v.retirementSpending === '' ? undefined : n(v.retirementSpending),
        retireAge: v.retireAge === '' ? undefined : n(v.retireAge),
        otherIncome: n(v.otherIncome),
        otherIncomeAge: n(v.otherIncomeAge, 67),
        incomeGrowth: n(v.incomeGrowth) / 100,
        endAge: Math.min(110, Math.max(n(v.age, 30) + 1, n(v.endAge, 95))),
      };
    }

    function compute() {
      if (!ctx.alive) return;
      saveInputs('fire', v);
      const p = params();
      const plan = F.firePlan(p);
      const mc = F.fireMonteCarlo(p, { sims: 2000, volatility: n(v.vol, 15) / 100 });
      const tile = (l, val, s, cls = '', hero = false) => `<div class="tile ${hero ? 'hero' : ''}"><div class="l">${l}</div><div class="v ${cls}">${val}</div><div class="s">${s || '&nbsp;'}</div></div>`;
      const coastAge = p.retireAge ?? 65;
      const isCoast = p.assets >= plan.coastFi;
      tilesP.body.innerHTML = `<div class="tiles">${[
        tile('FI number', money(plan.fiNumber, 0), `${money(p.retirementSpending ?? p.spending, 0)}/yr ÷ ${num(p.withdrawalRate * 100, 2)}%`, '', true),
        tile('Years to FI', plan.fiAge != null ? years(plan.fiAge - p.age) : 'not reached', plan.fiAge != null ? `FI at age ${plan.fiAge} (${new Date().getFullYear() + plan.fiAge - p.age})` : 'increase savings or returns', plan.fiAge != null ? 'up' : 'down', true),
        tile('Progress', pctf(plan.progress, 1), `${money(p.assets, 0)} of ${money(plan.fiNumber, 0)}`),
        tile('Savings rate', pctf(plan.savingsRate, 1), `${money(plan.annualSavings, 0)}/yr · ${money(plan.annualSavings / 12, 0)}/mo`),
        tile('Real return', pctf(plan.realReturn, 2), `${num(p.nominalReturn * 100, 1)}% nominal − ${num(p.inflation * 100, 1)}% inflation`),
        tile(`Coast FI (by ${coastAge})`, money(plan.coastFi, 0), isCoast ? 'reached — growth alone gets you there' : `${money(plan.coastFi - p.assets, 0)} to go`, isCoast ? 'up' : ''),
        tile('Lean FI (70% spend)', money(plan.leanFi, 0), ''),
        tile('Fat FI (150% spend)', money(plan.fatFi, 0), ''),
        tile('Monte Carlo success', pctf(mc.successRate, 0), `retire at ${mc.retireAge}, last to ${p.endAge} · σ ${num(n(v.vol, 15), 0)}%`, mc.successRate >= 0.85 ? 'up' : mc.successRate >= 0.6 ? 'warn' : 'down'),
        tile('Median at retirement', money(mc.medianAtRetirement, 0), `age ${mc.retireAge}, today's $`),
        tile('Money lasts to', plan.depletedAge ? `age ${plan.depletedAge}` : `${p.endAge}+`, plan.depletedAge ? 'deterministic plan runs out' : 'deterministic plan', plan.depletedAge ? 'down' : 'up'),
      ].join('')}</div>`;

      // chart
      const ages = plan.rows.map((r) => r.age);
      const box = h('div');
      chartP.body.innerHTML = '';
      chartP.body.append(box);
      lineChart(box, {
        x: ages,
        xType: 'number',
        xFmt: (a) => String(Math.round(a)),
        tipXFmt: (a) => `Age ${a}`,
        bands: [
          { lo: mc.bands.map((b) => b.p10), hi: mc.bands.map((b) => b.p90), color: HEX[0], opacity: 0.14, name: 'MC 10th–90th pct' },
          { lo: mc.bands.map((b) => b.p25), hi: mc.bands.map((b) => b.p75), color: HEX[0], opacity: 0.26, name: 'MC 25th–75th pct' },
        ],
        series: [
          { name: 'Plan (expected return)', values: plan.rows.map((r) => r.end), color: 'var(--amber)', width: 2 },
          { name: 'Monte Carlo median', values: mc.bands.map((b) => b.p50), color: HEX[0], width: 1.6 },
        ],
        refY: { value: plan.fiNumber, label: `FI number ${money(plan.fiNumber, 0)}` },
        height: 320,
        // Keep the plan readable: the axis follows the plan, the median and the 25–75% band (wider bands are clipped).
        yRange: [0, 1.12 * Math.max(plan.fiNumber, ...plan.rows.map((r) => r.end), ...mc.bands.map((b) => b.p75))],
        yFmt: (x) => '$' + compactNum(x),
        tipFmt: (x) => money(x, 0),
        tipExtra: (i) => `<div class="muted">${plan.rows[i].phase === 'saving' ? `saving ${money(plan.rows[i].contribution, 0)}` : `withdrawing ${money(plan.rows[i].withdrawal, 0)}`}</div>`,
      });
      chartP.setFoot(`Retirement ${p.retireAge ? `at age ${p.retireAge} (planned)` : 'when FI is reached'} · withdrawals = retirement spending − other income · Monte Carlo: 2,000 lognormal paths, ${num(n(v.vol, 15), 0)}% volatility · upper band clipped to keep the plan readable`);

      // sensitivity
      const rets = [0.02, 0.03, 0.04, 0.05, 0.06, 0.07];
      const rates = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
      const grid_ = F.sensitivityGrid({ income: p.income, assets: p.assets, withdrawalRate: p.withdrawalRate, savingsRates: rates, returns: rets });
      const maxY = 50;
      sensP.body.innerHTML = `<table class="t"><thead><tr><th>Savings rate ↓ / real return →</th>${rets.map((r) => `<th class="r">${(r * 100).toFixed(0)}%</th>`).join('')}</tr></thead><tbody>${grid_
        .map((row) => `<tr><td class="amber">${(row.savingsRate * 100).toFixed(0)}% <span class="muted">(spend ${money(p.income * (1 - row.savingsRate), 0)})</span></td>${row.years
          .map((y) => `<td class="r" style="background:${Number.isFinite(y) ? sequentialColor(1 - Math.min(y, maxY) / maxY) : 'transparent'};color:#fff">${Number.isFinite(y) ? y.toFixed(1) : '∞'}</td>`)
          .join('')}</tr>`)
        .join('')}</tbody></table>`;
      sensP.setFoot(`Assumes retirement spending equals what you spend at that savings rate (${money(p.income, 0)} income, ${money(p.assets, 0)} start). Brighter = sooner.`);

      // table
      tableP.body.innerHTML = `<table class="t compact"><thead><tr><th>Age</th><th>Year</th><th>Phase</th><th class="r">Start</th><th class="r">Saved</th><th class="r">Withdrawn</th><th class="r">Growth</th><th class="r">End</th></tr></thead><tbody>${plan.rows
        .map((r) => `<tr class="${r.age === plan.fiAge ? 'sel' : ''}"><td class="amber">${r.age}</td><td class="muted">${r.year}</td><td class="${r.phase === 'saving' ? 'dim' : 'up'}">${r.phase}</td><td class="r">${money(r.start, 0)}</td><td class="r">${r.contribution ? money(r.contribution, 0) : DASH}</td><td class="r">${r.withdrawal ? money(r.withdrawal, 0) : DASH}</td><td class="r ${r.growth >= 0 ? 'up' : 'down'}">${money(r.growth, 0)}</td><td class="r b">${money(r.end, 0)}</td></tr>`)
        .join('')}</tbody></table>`;

      drawGoal();
      drawEF();
    }

    // ---- savings goal ----
    const goalForm = h('div', { class: 'form' });
    const goalOut = h('div');
    for (const [k, label] of [['goal', 'Goal amount $'], ['goalCurrent', 'Already saved $'], ['goalYears', 'Years to goal'], ['goalReturn', 'Return %/yr (e.g. HYSA 4.5)']]) {
      const el = h('input', { class: 'in num', type: 'number', step: 'any', value: String(v[k]) });
      el.addEventListener('input', () => {
        v[k] = Number(el.value) || 0;
        saveInputs('fire', v);
        drawGoal();
      });
      goalForm.append(h('label', {}, label, el));
    }
    goalP.body.append(goalForm, goalOut);
    function drawGoal() {
      const pmt = F.requiredMonthlySaving(v.goal, v.goalCurrent, v.goalYears, v.goalReturn / 100);
      const sched = F.compoundSchedule({ initial: v.goalCurrent, monthly: pmt, annualRate: v.goalReturn / 100, years: Math.max(1, Math.round(v.goalYears)), inflation: n(v.inflation, 2.5) / 100 });
      goalOut.innerHTML = `<div class="tiles" style="margin:6px 0"><div class="tile hero"><div class="l">Save each month</div><div class="v amber">${money(pmt, 0)}</div><div class="s">${money(pmt * 12, 0)} per year</div></div>
        <div class="tile"><div class="l">You contribute</div><div class="v">${money(v.goalCurrent + pmt * 12 * v.goalYears, 0)}</div><div class="s">growth adds ${money(Math.max(0, v.goal - v.goalCurrent - pmt * 12 * v.goalYears), 0)}</div></div>
        <div class="tile"><div class="l">Goal in today's $</div><div class="v">${money(v.goal / (1 + n(v.inflation, 2.5) / 100) ** v.goalYears, 0)}</div><div class="s">after ${num(n(v.inflation, 2.5), 1)}% inflation</div></div></div>`;
      const box = h('div');
      goalOut.append(box);
      lineChart(box, { x: [0, ...sched.map((r) => r.year)], xType: 'number', xFmt: (x) => `${x}y`, tipXFmt: (x) => `Year ${x}`, series: [{ name: 'Balance', values: [v.goalCurrent, ...sched.map((r) => r.balance)], color: HEX[0], area: true }, { name: 'Contributed', values: [v.goalCurrent, ...sched.map((r) => r.contributed)], color: HEX[1] }], height: 160, yMin: 0, yFmt: (x) => '$' + compactNum(x), tipFmt: (x) => money(x, 0) });
    }

    // ---- emergency fund ----
    const efForm = h('div', { class: 'form' });
    const efOut = h('div');
    for (const [k, label] of [['efMonthly', 'Essential monthly expenses $'], ['efMonths', 'Months of cover wanted']]) {
      const el = h('input', { class: 'in num', type: 'number', step: 'any', value: String(v[k]) });
      el.addEventListener('input', () => {
        v[k] = Number(el.value) || 0;
        saveInputs('fire', v);
        drawEF();
      });
      efForm.append(h('label', {}, label, el));
    }
    efP.body.append(efForm, efOut);
    function drawEF() {
      const cash = state().cash.reduce((s, c) => s + c.amount, 0);
      const target = v.efMonthly * v.efMonths;
      const cover = v.efMonthly ? cash / v.efMonthly : 0;
      const pctDone = target ? Math.min(1, cash / target) : 0;
      efOut.innerHTML = `<div class="tiles" style="margin-top:6px">
        <div class="tile"><div class="l">Target fund</div><div class="v">${money(target, 0)}</div><div class="s">${v.efMonths} × ${money(v.efMonthly, 0)}</div></div>
        <div class="tile"><div class="l">Cash in PORT</div><div class="v">${money(cash, 0)}</div><div class="s">${num(cover, 1)} months of cover</div></div>
        <div class="tile"><div class="l">${cash >= target ? 'Surplus' : 'Shortfall'}</div><div class="v ${cash >= target ? 'up' : 'down'}">${money(Math.abs(cash - target), 0)}</div><div class="s">${pctf(pctDone, 0)} funded</div></div></div>
        <div style="margin-top:8px" title="${pctf(pctDone, 0)} funded"><div class="rangebar" style="height:10px"><div style="height:100%;width:${(pctDone * 100).toFixed(1)}%;background:${cash >= target ? 'var(--up)' : 'var(--amber)'};border-radius:3px"></div></div></div>
        <p class="note">Common guidance: 3–6 months of essential expenses (more if income is variable or you are the sole earner). Track savings balances under PORT → + Cash.</p>`;
    }

    compute();
  },
};
