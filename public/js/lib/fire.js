// FIRE (Financial Independence, Retire Early) and savings math.
// All projections are in "today's dollars" using real (inflation-adjusted) returns
// unless noted otherwise.
import { mulberry32, gaussian, percentile } from './stats.js';

export const realReturn = (nominal, inflation) => (1 + nominal) / (1 + inflation) - 1;

export const fiNumber = (annualSpending, withdrawalRate) => (withdrawalRate > 0 ? annualSpending / withdrawalRate : Infinity);

export const savingsRate = (income, spending) => (income > 0 ? (income - spending) / income : 0);

// Future value of a lump sum plus level annual contributions (end of year).
export function futureValue(pv, annualContribution, rate, years) {
  if (Math.abs(rate) < 1e-12) return pv + annualContribution * years;
  const g = (1 + rate) ** years;
  return pv * g + annualContribution * ((g - 1) / rate);
}

// Years needed for pv + contributions growing at `rate` to reach `target` (closed form).
export function yearsToTarget(pv, annualContribution, rate, target) {
  if (pv >= target) return 0;
  if (Math.abs(rate) < 1e-12) return annualContribution > 0 ? (target - pv) / annualContribution : Infinity;
  const num = target * rate + annualContribution;
  const den = pv * rate + annualContribution;
  if (den <= 0 || num / den <= 0) return Infinity;
  const n = Math.log(num / den) / Math.log(1 + rate);
  return n >= 0 ? n : Infinity;
}

// Amount needed today so that, with no further contributions, the portfolio
// grows to the FI number by the target age.
export const coastFiNumber = (fi, rate, years) => fi / (1 + rate) ** Math.max(0, years);

// Level monthly saving required to reach `goal` from `current` in `years` at `annualRate`.
export function requiredMonthlySaving(goal, current, years, annualRate) {
  const n = Math.round(years * 12);
  if (n <= 0) return Math.max(0, goal - current);
  const r = (1 + annualRate) ** (1 / 12) - 1;
  const fvCurrent = current * (1 + r) ** n;
  if (fvCurrent >= goal) return 0;
  if (Math.abs(r) < 1e-12) return (goal - fvCurrent) / n;
  return ((goal - fvCurrent) * r) / ((1 + r) ** n - 1);
}

// Monthly compound-growth schedule (nominal) for the savings calculator.
export function compoundSchedule({ initial = 0, monthly = 0, annualRate = 0.07, years = 10, inflation = 0 }) {
  const r = (1 + annualRate) ** (1 / 12) - 1;
  const rows = [];
  let bal = initial;
  let contributed = initial;
  for (let y = 1; y <= Math.round(years); y++) {
    for (let m = 0; m < 12; m++) {
      bal = bal * (1 + r) + monthly;
      contributed += monthly;
    }
    rows.push({ year: y, balance: bal, contributed, growth: bal - contributed, real: bal / (1 + inflation) ** y });
  }
  return rows;
}

/**
 * Deterministic FIRE plan, year by year, in today's dollars.
 * p: { age, assets, income, spending, annualSavings?, nominalReturn, inflation,
 *      withdrawalRate, retirementSpending?, retireAge?, otherIncome, otherIncomeAge,
 *      incomeGrowth (real), endAge }
 */
export function firePlan(p) {
  const r = realReturn(p.nominalReturn, p.inflation);
  const spendNow = p.spending;
  const retireSpend = p.retirementSpending ?? spendNow;
  const fi = fiNumber(retireSpend, p.withdrawalRate);
  const baseSavings = p.annualSavings ?? Math.max(0, p.income - p.spending);
  const endAge = p.endAge ?? 95;
  const rows = [];
  let bal = p.assets;
  let fiAge = null;
  let retired = false;
  let depletedAge = null;
  for (let age = p.age; age <= endAge; age++) {
    const t = age - p.age;
    const otherIncome = age >= (p.otherIncomeAge ?? 200) ? p.otherIncome || 0 : 0;
    // FI is reached when the portfolio can fund spending net of other income at the withdrawal rate.
    const need = Math.max(0, retireSpend - otherIncome);
    if (fiAge === null && bal >= need / p.withdrawalRate) fiAge = age;
    const shouldRetire = p.retireAge != null ? age >= p.retireAge : fiAge !== null;
    if (shouldRetire) retired = true;
    const start = bal;
    let contribution = 0;
    let withdrawal = 0;
    if (!retired) {
      contribution = baseSavings * (1 + (p.incomeGrowth || 0)) ** t;
      bal = bal * (1 + r) + contribution;
    } else {
      withdrawal = need;
      bal = (bal - withdrawal) * (1 + r);
      if (bal <= 0) {
        if (depletedAge === null) depletedAge = age;
        bal = 0;
      }
    }
    rows.push({ age, year: new Date().getFullYear() + t, start, contribution, withdrawal, growth: bal - start - contribution + withdrawal, end: bal, phase: retired ? 'retired' : 'saving', fiTarget: need / p.withdrawalRate });
  }
  const yrs = yearsToTarget(p.assets, baseSavings, r, fi);
  return {
    realReturn: r,
    fiNumber: fi,
    leanFi: fiNumber(retireSpend * 0.7, p.withdrawalRate),
    fatFi: fiNumber(retireSpend * 1.5, p.withdrawalRate),
    savingsRate: savingsRate(p.income, p.spending),
    annualSavings: baseSavings,
    yearsToFi: fiAge !== null ? fiAge - p.age : yrs,
    fiAge: fiAge ?? (Number.isFinite(yrs) ? p.age + Math.ceil(yrs) : null),
    depletedAge,
    progress: fi > 0 ? p.assets / fi : 0,
    coastFi: p.retireAge ? coastFiNumber(fi, r, p.retireAge - p.age) : coastFiNumber(fi, r, 65 - p.age),
    rows,
  };
}

/**
 * Monte Carlo FIRE: random real annual returns (lognormal); retirement at `retireAge`
 * (or the deterministic FI age). Success = money lasts until endAge.
 */
export function fireMonteCarlo(p, { sims = 2000, volatility = 0.15, seed = 99 } = {}) {
  const plan = firePlan(p);
  const retireAge = p.retireAge ?? plan.fiAge ?? 65;
  const r = realReturn(p.nominalReturn, p.inflation);
  const mu = Math.log(1 + r) - (volatility * volatility) / 2;
  const rng = mulberry32(seed);
  const endAge = p.endAge ?? 95;
  const ages = [];
  for (let a = p.age; a <= endAge; a++) ages.push(a);
  const cols = ages.map(() => new Float64Array(sims));
  const retireSpend = p.retirementSpending ?? p.spending;
  const baseSavings = p.annualSavings ?? Math.max(0, p.income - p.spending);
  let successes = 0;
  const atRetire = new Float64Array(sims);
  for (let s = 0; s < sims; s++) {
    let bal = p.assets;
    let ok = true;
    ages.forEach((age, i) => {
      const g = Math.exp(mu + volatility * gaussian(rng)) - 1;
      const other = age >= (p.otherIncomeAge ?? 200) ? p.otherIncome || 0 : 0;
      if (age < retireAge) bal = bal * (1 + g) + baseSavings * (1 + (p.incomeGrowth || 0)) ** (age - p.age);
      else {
        if (age === retireAge) atRetire[s] = bal;
        bal = (bal - Math.max(0, retireSpend - other)) * (1 + g);
        if (bal <= 0) {
          bal = 0;
          ok = false;
        }
      }
      cols[i][s] = bal;
    });
    if (ok) successes++;
  }
  const bands = cols.map((c, i) => {
    const sorted = Float64Array.from(c).sort();
    return { age: ages[i], p10: percentile(sorted, 0.1), p25: percentile(sorted, 0.25), p50: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), p90: percentile(sorted, 0.9) };
  });
  return { retireAge, successRate: successes / sims, bands, medianAtRetirement: percentile(Float64Array.from(atRetire).sort(), 0.5) };
}

// Sensitivity grid: years to FI across savings rates and real returns.
export function sensitivityGrid({ income, assets, withdrawalRate, retirementSpending, savingsRates = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], returns = [0.03, 0.05, 0.07] }) {
  return savingsRates.map((sr) => ({
    savingsRate: sr,
    years: returns.map((r) => {
      const spend = retirementSpending ?? income * (1 - sr);
      return yearsToTarget(assets, income * sr, r, fiNumber(spend, withdrawalRate));
    }),
  }));
}
