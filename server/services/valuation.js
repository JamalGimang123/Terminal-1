// Inputs for the VAL screen: analyst views (Yahoo Finance; Nasdaq for US cross-check),
// reported financials (Yahoo Finance fundamentals; covers US and IDX listings), beta vs the
// home market index, dividend history, a risk-free rate and trading multiples of peers.
import { yahooQuoteSummary, yahooTimeseries, yahooPeers, flattenYahoo } from '../providers/yahoo.js';
import { getQuotes } from './quotes.js';
import { getHistory } from './history.js';
import { treasuryCurve } from '../providers/macro.js';
import { pheiData, interpolate } from '../providers/bonds.js';
import { getJSON, browserHeaders, HttpError } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { classify, normalizeSymbol } from '../lib/symbols.js';
import * as S from '../../public/js/lib/stats.js';

// Income & cash-flow items (annual + trailing twelve months) and balance-sheet items (annual + latest quarter).
const FLOW = ['TotalRevenue', 'EBIT', 'EBITDA', 'NetIncomeCommonStockholders', 'ReconciledDepreciation', 'CapitalExpenditure', 'OperatingCashFlow', 'FreeCashFlow', 'InterestExpense', 'CashDividendsPaid', 'DilutedEPS', 'DilutedAverageShares', 'ChangeInWorkingCapital', 'PretaxIncome', 'TaxProvision'];
const ANNUAL_ONLY = ['TaxRateForCalcs'];
const BAL = ['TotalDebt', 'CashAndCashEquivalents', 'CashCashEquivalentsAndShortTermInvestments', 'StockholdersEquity', 'MinorityInterest', 'OrdinarySharesNumber'];

// Home-market index for beta.
const BENCH = [[/\.JK$/, '^JKSE'], [/\.T$/, '^N225'], [/\.L$/, '^FTSE'], [/\.HK$/, '^HSI'], [/\.SI$/, '^STI'], [/\.AX$/, '^AXJO'], [/\.TO$/, '^GSPTSE'], [/\.(DE|F)$/, '^GDAXI'], [/\.PA$/, '^FCHI'], [/\.KS$/, '^KS11'], [/\.NS$/, '^NSEI'], [/\.BO$/, '^BSESN']];
export const benchmarkFor = (sym) => BENCH.find(([re]) => re.test(sym))?.[1] || 'SPY';

const last = (rows) => rows?.at(-1)?.value ?? null;
const byDate = (rows) => Object.fromEntries((rows || []).map((r) => [r.date, r.value]));

export function normalizeFinancials(ts) {
  const A = ts.annual;
  const dates = [...new Set(Object.values(A).flatMap((rows) => rows.map((r) => r.date)))].sort().slice(-6);
  const col = Object.fromEntries([...FLOW, ...ANNUAL_ONLY, ...BAL].map((k) => [k, byDate(A[k])]));
  const pos = (v) => (v == null ? null : Math.abs(v));
  const annual = dates
    .map((d) => {
      const g = (k) => col[k][d] ?? null;
      const taxRate = g('TaxRateForCalcs') ?? (g('PretaxIncome') > 0 && g('TaxProvision') != null ? g('TaxProvision') / g('PretaxIncome') : null);
      return {
        date: d,
        revenue: g('TotalRevenue'),
        ebit: g('EBIT'),
        ebitda: g('EBITDA'),
        netIncome: g('NetIncomeCommonStockholders'),
        da: g('ReconciledDepreciation'),
        capex: pos(g('CapitalExpenditure')),
        ocf: g('OperatingCashFlow'),
        fcf: g('FreeCashFlow'),
        interestExpense: pos(g('InterestExpense')),
        dividendsPaid: pos(g('CashDividendsPaid')),
        eps: g('DilutedEPS'),
        shares: g('DilutedAverageShares') ?? g('OrdinarySharesNumber'),
        changeInWc: g('ChangeInWorkingCapital'),
        taxRate,
        totalDebt: g('TotalDebt'),
        cash: g('CashCashEquivalentsAndShortTermInvestments') ?? g('CashAndCashEquivalents'),
        equity: g('StockholdersEquity'),
      };
    })
    .filter((r) => r.revenue != null || r.netIncome != null);
  const T = ts.trailing;
  const la = annual.at(-1) || {};
  const ttm = {
    date: T.TotalRevenue?.at(-1)?.date || la.date || null,
    revenue: last(T.TotalRevenue) ?? la.revenue ?? null,
    ebit: last(T.EBIT) ?? la.ebit ?? null,
    ebitda: last(T.EBITDA) ?? la.ebitda ?? null,
    netIncome: last(T.NetIncomeCommonStockholders) ?? la.netIncome ?? null,
    da: last(T.ReconciledDepreciation) ?? la.da ?? null,
    capex: pos(last(T.CapitalExpenditure) ?? la.capex ?? null),
    ocf: last(T.OperatingCashFlow) ?? la.ocf ?? null,
    fcf: last(T.FreeCashFlow) ?? la.fcf ?? null,
    interestExpense: pos(last(T.InterestExpense) ?? la.interestExpense ?? null),
    dividendsPaid: pos(last(T.CashDividendsPaid) ?? la.dividendsPaid ?? null),
    eps: last(T.DilutedEPS) ?? la.eps ?? null,
  };
  // Latest balance sheet: the most recent quarter, else the last annual report.
  const Q = ts.quarterly;
  const qd = [...new Set(BAL.flatMap((k) => (Q[k] || []).map((r) => r.date)))].sort().at(-1);
  const qv = (k) => (Q[k] || []).find((r) => r.date === qd)?.value ?? null;
  const balance = qd
    ? { date: qd, totalDebt: qv('TotalDebt'), cash: qv('CashCashEquivalentsAndShortTermInvestments') ?? qv('CashAndCashEquivalents'), equity: qv('StockholdersEquity'), minority: qv('MinorityInterest'), shares: qv('OrdinarySharesNumber') }
    : { date: la.date || null, totalDebt: la.totalDebt ?? null, cash: la.cash ?? null, equity: la.equity ?? null, minority: last(A.MinorityInterest), shares: last(A.OrdinarySharesNumber) };
  return { annual, ttm, balance, currency: ts.currency };
}

// Beta from weekly returns over two years (raw and Blume-adjusted 0.67·raw + 0.33).
export function weeklyBeta(stock, bench) {
  const al = S.alignSeries({ s: stock, b: bench });
  const pick = (arr) => arr.filter((_, i) => (arr.length - 1 - i) % 5 === 0);
  const rs = S.toReturns(pick(al.prices.s));
  const rb = S.toReturns(pick(al.prices.b));
  if (rs.length < 30) return null;
  const raw = S.beta(rs, rb);
  return Number.isFinite(raw) ? { raw, adjusted: 0.67 * raw + 0.33, weeks: rs.length, r2: S.correlation(rs, rb) ** 2 } : null;
}

// Dividends per share by calendar year (complete years only) and their growth.
export function dividendHistory(divs, now = new Date()) {
  const thisYear = now.getUTCFullYear();
  const byYear = new Map();
  for (const d of divs || []) {
    const y = new Date(d.t).getUTCFullYear();
    if (y < thisYear) byYear.set(y, (byYear.get(y) || 0) + d.amount);
  }
  const years = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, dps]) => ({ year, dps }));
  const cagr = (n) => {
    const a = years.at(-1 - n);
    const b = years.at(-1);
    return a && b && a.dps > 0 && years.length > n ? (b.dps / a.dps) ** (1 / n) - 1 : null;
  };
  const yearAgo = now.getTime() - 365 * 86400e3;
  return { years: years.slice(-10), ttm: (divs || []).filter((d) => d.t >= yearAgo).reduce((s, d) => s + d.amount, 0), cagr3: cagr(3), cagr5: cagr(5) };
}

async function nasdaqAnalysts(sym) {
  const H = browserHeaders({ Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' });
  const get = (path) => getJSON(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(sym)}/${path}`, { headers: H, timeout: 12000 }).then((j) => j?.data);
  const [tp, rt, ef] = await Promise.allSettled([get('targetprice'), get('ratings'), get('earnings-forecast')]);
  const c = tp.status === 'fulfilled' ? tp.value?.consensusOverview : null;
  if (!c && rt.status !== 'fulfilled') throw new HttpError('Nasdaq analyst data unavailable', { status: 502 });
  const yearly = ef.status === 'fulfilled' ? ef.value?.yearlyForecast?.rows || [] : [];
  return {
    source: 'Nasdaq (Zacks consensus)',
    targetLow: c?.lowPriceTarget ?? null,
    targetHigh: c?.highPriceTarget ?? null,
    targetMean: c?.priceTarget ?? null,
    buy: c?.buy ?? null,
    hold: c?.hold ?? null,
    sell: c?.sell ?? null,
    meanRating: rt.status === 'fulfilled' ? rt.value?.meanRatingType || null : null,
    summary: rt.status === 'fulfilled' ? rt.value?.ratingsSummary || '' : '',
    brokers: rt.status === 'fulfilled' ? rt.value?.brokerNames || [] : [],
    epsYearly: yearly.map((r) => ({ fiscalEnd: r.fiscalEnd, eps: r.consensusEPSForecast, high: r.highEPSForecast, low: r.lowEPSForecast, n: r.noOfEstimates })),
  };
}

async function riskFree(currency) {
  if (currency === 'IDR') {
    try {
      const ph = await pheiData();
      const y = interpolate(ph.curve.map((p) => ({ years: p.years, yield: p.yield })), 10);
      if (y != null) return { rate: y, label: 'Indonesia 10-year government yield (PHEI IGSYC)', asOf: ph.asOf };
    } catch {
      /* fall through to US */
    }
  }
  const t = await treasuryCurve();
  return { rate: t.latest.yields['10 Yr'], label: currency === 'USD' ? 'US 10-year Treasury yield' : 'US 10-year Treasury yield (replace with your local 10-year government yield)', asOf: t.latest.date };
}

// Units of the price currency per 1 unit of the reporting currency (e.g. ADRs reporting in TWD).
async function fxFactor(from, to) {
  if (!from || !to || from === to) return 1;
  const minor = { GBp: ['GBP', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };
  const [toC, toDiv] = minor[to] || [to, 1];
  const [fromC, fromDiv] = minor[from] || [from, 1];
  const syms = [toC, fromC].filter((c) => c !== 'USD').map((c) => `${c}=X`);
  const { quotes } = syms.length ? await getQuotes(syms) : { quotes: {} };
  const perUsd = (c) => (c === 'USD' ? 1 : quotes[`${c}=X`]?.price);
  if (!perUsd(toC) || !perUsd(fromC)) return null;
  return ((perUsd(toC) / perUsd(fromC)) * toDiv) / fromDiv;
}

function scaleMoney(obj, f, keys) {
  if (!obj || f === 1) return obj;
  const out = { ...obj };
  for (const k of keys) if (out[k] != null) out[k] *= f;
  return out;
}

export async function valuationData(rawSym) {
  const sym = normalizeSymbol(rawSym);
  if (!sym || /[=^]|-USD$/.test(sym)) throw new HttpError('Valuation works for individual stocks (e.g. AAPL, BBCA.JK)', { status: 400 });
  return cached(`val:${sym}`, 30 * 60e3, async () => {
    const bench = benchmarkFor(sym);
    const keys = [...FLOW.flatMap((k) => [`annual${k}`, `trailing${k}`]), ...ANNUAL_ONLY.map((k) => `annual${k}`), ...BAL.flatMap((k) => [`annual${k}`, `quarterly${k}`])];
    const [qs, ts, peers, q, h2, hb, h10, nas] = await Promise.allSettled([
      cached(`yqs:${sym}`, 3600e3, () => yahooQuoteSummary(sym, ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'recommendationTrend', 'upgradeDowngradeHistory', 'earningsTrend', 'assetProfile'])),
      cached(`yts:${sym}`, 12 * 3600e3, () => yahooTimeseries(sym, keys)),
      cached(`ypeers:${sym}`, 24 * 3600e3, () => yahooPeers(sym)),
      getQuotes([sym]),
      getHistory(sym, '2y'),
      getHistory(bench, '2y'),
      getHistory(sym, '10y'),
      classify(sym) === 'us' ? cached(`nqan:${sym}`, 3600e3, () => nasdaqAnalysts(sym)) : Promise.reject(new Error('US listings only')),
    ]);
    if (qs.status === 'rejected' && ts.status === 'rejected') throw new HttpError(`No fundamentals for ${sym}: ${qs.reason.message}`, { status: qs.reason.status || 502 });
    const r = qs.status === 'fulfilled' ? qs.value : {};
    const price = flattenYahoo(r.price);
    const sd = flattenYahoo(r.summaryDetail);
    const ks = flattenYahoo(r.defaultKeyStatistics);
    const fd = flattenYahoo(r.financialData);
    if (/^(ETF|MUTUALFUND|INDEX|CURRENCY|CRYPTOCURRENCY|FUTURE)$/.test(price?.quoteType || '')) {
      throw new HttpError(`${sym} is ${price.quoteType === 'ETF' ? 'an ETF' : `a ${price.quoteType.toLowerCase()}`}: valuation is for individual companies${price.quoteType === 'ETF' || price.quoteType === 'MUTUALFUND' ? ' — see OVLP for what the fund holds' : ''}.`, { status: 400 });
    }
    const quote = q.status === 'fulfilled' ? q.value.quotes[sym] : null;
    const currency = price?.currency || quote?.currency || 'USD';
    const finCurrency = fd?.financialCurrency || (ts.status === 'fulfilled' ? ts.value.currency : null) || currency;
    const warnings = [];
    let fin = ts.status === 'fulfilled' ? normalizeFinancials(ts.value) : null;
    if (!fin?.annual.length) warnings.push('No reported financial statements found — enter the DCF inputs yourself.');
    const f = await fxFactor(finCurrency, currency).catch(() => null);
    if (f == null) warnings.push(`Financials are in ${finCurrency} but no ${finCurrency}/${currency} rate was available.`);
    else if (f !== 1 && fin) {
      const money = ['revenue', 'ebit', 'ebitda', 'netIncome', 'da', 'capex', 'ocf', 'fcf', 'interestExpense', 'dividendsPaid', 'eps', 'totalDebt', 'cash', 'equity', 'minority'];
      fin = { ...fin, annual: fin.annual.map((x) => scaleMoney(x, f, money)), ttm: scaleMoney(fin.ttm, f, money), balance: scaleMoney(fin.balance, f, money), convertedFrom: finCurrency, fxRate: f };
      warnings.push(`Financials are reported in ${finCurrency} and converted to ${currency} at today's rate. For depositary receipts (ADRs) check that the share count matches the listing.`);
    }
    const betaInfo = h2.status === 'fulfilled' && hb.status === 'fulfilled' ? weeklyBeta({ dates: h2.value.points.map((p) => p.d), close: h2.value.points.map((p) => p.a ?? p.c) }, { dates: hb.value.points.map((p) => p.d), close: hb.value.points.map((p) => p.a ?? p.c) }) : null;
    const divs = h10.status === 'fulfilled' ? dividendHistory(h10.value.dividends) : null;
    const rf = await riskFree(currency).catch((e) => ({ rate: null, label: `unavailable (${e.message})` }));
    const trend = (r.recommendationTrend?.trend || []).map((t) => ({ period: t.period, strongBuy: t.strongBuy, buy: t.buy, hold: t.hold, sell: t.sell, strongSell: t.strongSell }));
    const yearAgo = Date.now() / 1000 - 365 * 86400;
    const actions = (r.upgradeDowngradeHistory?.history || [])
      .filter((a) => a.epochGradeDate >= yearAgo)
      .slice(0, 40)
      .map((a) => ({ date: new Date(a.epochGradeDate * 1000).toISOString().slice(0, 10), firm: a.firm, toGrade: a.toGrade, fromGrade: a.fromGrade, action: a.action, ptAction: a.priceTargetAction || null, target: a.currentPriceTarget || null, priorTarget: a.priorPriceTarget || null }));
    const estimates = (r.earningsTrend?.trend || []).map((t) => ({ period: t.period, end: t.endDate, eps: t.earningsEstimate?.avg?.raw ?? null, low: t.earningsEstimate?.low?.raw ?? null, high: t.earningsEstimate?.high?.raw ?? null, n: t.earningsEstimate?.numberOfAnalysts?.raw ?? null, growth: t.growth?.raw ?? null, revenue: t.revenueEstimate?.avg?.raw ?? null, revenueGrowth: t.revenueEstimate?.growth?.raw ?? null }));
    const lastPrice = quote?.price ?? price?.regularMarketPrice ?? fd?.currentPrice ?? null;
    const shares = ks?.sharesOutstanding ?? fin?.balance?.shares ?? null;
    const industry = r.assetProfile?.industry || '';
    const sector = r.assetProfile?.sector || '';
    const financialCo = /bank|insurance|capital markets|credit services|asset management|mortgage/i.test(industry) || /financial/i.test(sector);
    if (financialCo) warnings.push('Financial company: cash-flow (FCFF) DCF and EV multiples do not fit banks and insurers well — lean on the dividend model, P/E and P/B.');
    return {
      symbol: sym,
      name: price?.longName || price?.shortName || quote?.name || sym,
      currency,
      financialCurrency: finCurrency,
      price: lastPrice,
      change: quote?.change ?? null,
      changePct: quote?.changePct ?? null,
      quoteSource: quote?.source || 'Yahoo Finance',
      sector,
      industry,
      country: r.assetProfile?.country || '',
      financialCo,
      stats: {
        marketCap: price?.marketCap ?? sd?.marketCap ?? (shares && lastPrice ? shares * lastPrice : null),
        enterpriseValue: ks?.enterpriseValue ?? null,
        sharesOutstanding: shares,
        trailingPE: sd?.trailingPE ?? null,
        forwardPE: sd?.forwardPE ?? ks?.forwardPE ?? null,
        priceToBook: ks?.priceToBook ?? null,
        bookValue: ks?.bookValue ?? null,
        trailingEps: ks?.trailingEps ?? null,
        forwardEps: ks?.forwardEps ?? null,
        pegRatio: ks?.pegRatio ?? null,
        evToEbitda: ks?.enterpriseToEbitda ?? null,
        evToRevenue: ks?.enterpriseToRevenue ?? null,
        dividendRate: sd?.dividendRate ?? null,
        dividendYield: sd?.dividendYield ?? null,
        payoutRatio: sd?.payoutRatio ?? null,
        low52: sd?.fiftyTwoWeekLow ?? quote?.low52 ?? null,
        high52: sd?.fiftyTwoWeekHigh ?? quote?.high52 ?? null,
        roe: fd?.returnOnEquity ?? null,
        revenueGrowth: fd?.revenueGrowth ?? null,
        earningsGrowth: fd?.earningsGrowth ?? null,
        operatingMargin: fd?.operatingMargins ?? null,
        ebitdaMargin: fd?.ebitdaMargins ?? null,
        yahooBeta: sd?.beta ?? ks?.beta ?? null,
      },
      analysts: {
        source: 'Yahoo Finance',
        targetLow: fd?.targetLowPrice ?? null,
        targetHigh: fd?.targetHighPrice ?? null,
        targetMean: fd?.targetMeanPrice ?? null,
        targetMedian: fd?.targetMedianPrice ?? null,
        n: fd?.numberOfAnalystOpinions ?? null,
        recommendationKey: fd?.recommendationKey ?? null,
        recommendationMean: fd?.recommendationMean ?? null,
        trend,
        actions,
        estimates,
      },
      nasdaq: nas.status === 'fulfilled' ? nas.value : null,
      financials: fin,
      beta: betaInfo ? { ...betaInfo, benchmark: bench } : null,
      dividends: divs,
      riskFree: rf,
      peers: (peers.status === 'fulfilled' ? peers.value : []).filter((p) => p !== sym).slice(0, 8),
      warnings,
      errors: [qs, ts].filter((x) => x.status === 'rejected').map((x) => x.reason.message),
      asOf: new Date().toISOString(),
    };
  });
}

// Trading multiples for a list of peers (ratios, so peers may report in other currencies).
export async function peerMultiples(symbols) {
  const syms = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].slice(0, 12);
  const results = await Promise.allSettled(syms.map((s) => cached(`ypeer:${s}`, 6 * 3600e3, () => yahooQuoteSummary(s, ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile']))));
  const peers = [];
  const errors = {};
  results.forEach((res, i) => {
    if (res.status === 'rejected') {
      errors[syms[i]] = res.reason.message;
      return;
    }
    const price = flattenYahoo(res.value.price);
    const sd = flattenYahoo(res.value.summaryDetail);
    const ks = flattenYahoo(res.value.defaultKeyStatistics);
    const fd = flattenYahoo(res.value.financialData);
    const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);
    // When a company reports in another currency than it trades in (e.g. PGAS.JK reports in USD),
    // Yahoo's EV and book multiples mix the two currencies: drop them.
    const mixed = !!(fd?.financialCurrency && price?.currency && fd.financialCurrency !== price.currency);
    peers.push({
      symbol: syms[i],
      name: price?.shortName || price?.longName || syms[i],
      industry: res.value.assetProfile?.industry || '',
      currency: price?.currency || null,
      price: price?.regularMarketPrice ?? fd?.currentPrice ?? null,
      marketCap: price?.marketCap ?? sd?.marketCap ?? null,
      pe: pos(sd?.trailingPE),
      fwdPe: pos(sd?.forwardPE ?? ks?.forwardPE),
      evEbitda: mixed ? null : pos(ks?.enterpriseToEbitda),
      evSales: mixed ? null : pos(ks?.enterpriseToRevenue),
      pb: mixed ? null : pos(ks?.priceToBook),
      note: mixed ? `reports in ${fd.financialCurrency}, trades in ${price.currency}: EV and P/B multiples left out` : '',
      divYield: sd?.dividendYield ?? null,
      roe: fd?.returnOnEquity ?? null,
      revenueGrowth: fd?.revenueGrowth ?? null,
      operatingMargin: fd?.operatingMargins ?? null,
    });
  });
  return { peers, errors, source: 'Yahoo Finance' };
}
