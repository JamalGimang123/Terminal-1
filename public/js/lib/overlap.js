// ETF overlap & look-through exposure math.
// A holding is { name, ticker, cusip, isin, weight } with weight in percent of fund NAV.

const US_TICKER = /^[A-Z]{1,5}(-[A-C])?$/;

// Union-find over security identifiers so that the same security is matched
// across funds whichever identifiers each issuer publishes (CUSIP, ISIN, ticker).
export function resolveKeys(funds) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const add = (x) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a, b) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const idsOf = (h) => {
    const ids = [];
    if (h.cusip && !/^0+$/.test(h.cusip)) ids.push('C:' + h.cusip.toUpperCase());
    if (h.isin) {
      ids.push('I:' + h.isin.toUpperCase());
      if (h.isin.startsWith('US') && h.isin.length === 12) ids.push('C:' + h.isin.slice(2, 11).toUpperCase());
    }
    if (h.ticker && US_TICKER.test(h.ticker)) ids.push('T:' + h.ticker);
    if (!ids.length) ids.push('N:' + String(h.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim());
    return ids;
  };
  for (const f of funds) for (const h of f.holdings) {
    const ids = idsOf(h);
    ids.forEach(add);
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }
  return (h) => find(idsOf(h)[0]);
}

// Collapse a fund's holdings to canonical keys (a fund may list a security twice).
export function keyedHoldings(fund, keyOf) {
  const m = new Map();
  for (const h of fund.holdings) {
    const k = keyOf(h);
    const prev = m.get(k);
    if (prev) prev.weight += h.weight;
    else m.set(k, { key: k, name: h.name, ticker: h.ticker || '', weight: h.weight });
  }
  return m;
}

export function overlapPair(a, b, keyOf = resolveKeys([a, b])) {
  const A = keyedHoldings(a, keyOf);
  const B = keyedHoldings(b, keyOf);
  const common = [];
  let weightOverlap = 0;
  for (const [k, ha] of A) {
    const hb = B.get(k);
    if (!hb) continue;
    const min = Math.min(ha.weight, hb.weight);
    weightOverlap += min;
    common.push({ key: k, name: ha.name, ticker: ha.ticker || hb.ticker, wA: ha.weight, wB: hb.weight, min });
  }
  common.sort((x, y) => y.min - x.min);
  const onlyA = [...A.values()].filter((h) => !B.has(h.key)).sort((x, y) => y.weight - x.weight);
  const onlyB = [...B.values()].filter((h) => !A.has(h.key)).sort((x, y) => y.weight - x.weight);
  const sumCommonA = common.reduce((s, c) => s + c.wA, 0);
  const sumCommonB = common.reduce((s, c) => s + c.wB, 0);
  return {
    weightOverlap, // % of NAV held in common (sum of min weights)
    commonCount: common.length,
    countA: A.size,
    countB: B.size,
    pctCountA: A.size ? common.length / A.size : 0, // share of A's holdings also in B
    pctCountB: B.size ? common.length / B.size : 0,
    pctWeightA: sumCommonA, // % of A's NAV invested in securities B also owns
    pctWeightB: sumCommonB,
    common,
    onlyA,
    onlyB,
  };
}

export function overlapMatrix(funds) {
  const keyOf = resolveKeys(funds);
  return funds.map((a, i) => funds.map((b, j) => (i === j ? { weightOverlap: 100, commonCount: a.holdings.length, self: true } : overlapPair(a, b, keyOf))));
}

// Combined look-through exposure of a portfolio of funds (allocations sum to 1 or are relative).
export function lookThrough(funds, allocations) {
  const total = allocations.reduce((s, x) => s + (x > 0 ? x : 0), 0) || 1;
  const keyOf = resolveKeys(funds);
  const agg = new Map();
  funds.forEach((f, i) => {
    const alloc = (allocations[i] > 0 ? allocations[i] : 0) / total;
    for (const h of keyedHoldings(f, keyOf).values()) {
      const e = agg.get(h.key) || { key: h.key, name: h.name, ticker: h.ticker, weight: 0, sources: {} };
      e.weight += alloc * h.weight;
      e.sources[f.symbol] = (e.sources[f.symbol] || 0) + alloc * h.weight;
      if (!e.ticker && h.ticker) e.ticker = h.ticker;
      agg.set(h.key, e);
    }
  });
  const rows = [...agg.values()].sort((a, b) => b.weight - a.weight);
  const top10 = rows.slice(0, 10).reduce((s, r) => s + r.weight, 0);
  const hhi = rows.reduce((s, r) => s + (r.weight / 100) ** 2, 0);
  return { rows, uniqueCount: rows.length, top10Weight: top10, effectiveN: hhi ? 1 / hhi : 0 };
}
