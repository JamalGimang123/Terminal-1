// Dialogs for adding/editing portfolio lots: stocks/ETFs/crypto (with the exchange rate on the
// purchase date) and bonds (Indonesian SBN or any fixed/floating coupon bond).
import { api } from './api.js';
import { h, modal, toast } from './dom.js';
import { esc, num } from './fmt.js';
import { update, uid } from './state.js';
import { sbnInfo, addYears, couponOn, knownSeries } from './lib/bonds.js';

const today = () => new Date().toISOString().slice(0, 10);
const ccyGuess = (sym) => (/\.JK$|^\^JK/.test(sym) ? 'IDR' : /\.[A-Z]{1,4}$/.test(sym) ? 'local' : 'USD');
const ACCOUNTS = '<datalist id="acct-list"><option>Taxable</option><option>Roth IRA</option><option>Traditional IRA</option><option>401(k)</option><option>IDX Broker</option><option>Bank (SBN)</option><option>Crypto</option></datalist>';

function save(lot, isEdit, m) {
  update((d) => {
    const i = d.positions.findIndex((p) => p.id === lot.id);
    if (i >= 0) d.positions[i] = lot;
    else d.positions.push(lot);
  });
  toast(`${isEdit ? 'Updated' : 'Added'} ${lot.symbol}`);
  m.close();
}

// ---- stocks, ETFs, crypto ----------------------------------------------------------------
export function addPositionDialog(symbol, defaults = {}) {
  if (defaults.bond || defaults.assetClass === 'Bond' || sbnInfo(symbol)) return bondDialog(symbol, defaults);
  const f = h('form', { class: 'form' });
  f.innerHTML = `
    <label>Symbol<input class="in" name="symbol" required value="${esc(symbol || '')}" placeholder="AAPL, BBCA.JK, BTC-USD"></label>
    <label>Shares / units<input class="in num" name="shares" type="number" step="any" required value="${esc(defaults.shares ?? '')}"></label>
    <label><span>Price per share <span class="ccy">(USD)</span></span><input class="in num" name="costBasis" type="number" step="any" min="0" required value="${esc(defaults.costBasis ?? '')}"></label>
    <label><span>Total paid <span class="ccy">(USD)</span></span><input class="in num" name="total" type="number" step="any" min="0" value="${defaults.shares && defaults.costBasis ? +(defaults.shares * defaults.costBasis).toFixed(2) : ''}"><span class="hint">fills price per share</span></label>
    <label>Purchase date<input class="in" name="purchaseDate" type="date" max="${today()}" value="${esc(defaults.purchaseDate || '')}"></label>
    <fieldset class="fx" style="grid-column:1/-1;border:1px solid var(--line-2);padding:6px 8px;margin:0">
      <legend class="amber" style="font-size:10.5px;padding:0 4px">EXCHANGE RATE ON PURCHASE DATE — rupiah per 1 US dollar</legend>
      <div class="form">
        <label>USD/IDR rate you paid<input class="in num" name="fxRate" type="number" step="any" min="0" value="${esc(defaults.fxRate ?? '')}" placeholder="e.g. 15618"><span class="hint fxsrc">optional · makes P&amp;L include rupiah moves</span></label>
        <label>…or total paid in IDR<input class="in num" name="idrPaid" type="number" step="any" min="0" placeholder="from your bank / app"><span class="hint">sets the rate for you</span></label>
        <label>&nbsp;<button type="button" class="btn" data-lookup>Look up rate for date</button><span class="hint">ECB reference rate</span></label>
      </div>
      <div class="note fxout"></div>
    </fieldset>
    <label>Account<input class="in" name="account" list="acct-list" value="${esc(defaults.account || 'Taxable')}">${ACCOUNTS}</label>
    <label>Asset class<select class="in" name="assetClass">${['Equity', 'ETF', 'Fund', 'Crypto', 'Commodity', 'Bond', 'Other'].map((c) => `<option ${c === (defaults.assetClass || 'Equity') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label style="grid-column:1/-1">Notes<input class="in" name="notes" value="${esc(defaults.notes || '')}"></label>
    <div class="row end" style="grid-column:1/-1"><button class="btn primary" type="submit">${defaults.id ? 'Save lot' : 'Add position'}</button></div>`;
  const m = modal(defaults.id ? `Edit lot · ${symbol}` : 'Add position', f);
  const $ = (n) => f.elements[n];
  const ccy = () => ccyGuess($('symbol').value.trim().toUpperCase());
  const refresh = () => {
    const c = ccy();
    f.querySelectorAll('.ccy').forEach((s) => (s.textContent = c === 'local' ? '(local currency)' : `(${c})`));
    f.querySelector('.fx').hidden = !(c === 'USD' || c === 'IDR');
    const n = Number($('shares').value);
    const px = Number($('costBasis').value);
    const r = Number($('fxRate').value);
    const out = f.querySelector('.fxout');
    if (n > 0 && px > 0 && r > 0) {
      out.innerHTML = c === 'USD'
        ? `Cost in rupiah at that rate: <b class="amber">Rp ${num(n * px * r, 0)}</b> — today's value uses today's rate, so the difference shows up as FX P&amp;L.`
        : `Cost in dollars at that rate: <b class="amber">$${num((n * px) / r, 2)}</b>.`;
    } else out.textContent = '';
  };
  $('symbol').addEventListener('input', refresh);
  $('shares').addEventListener('input', () => {
    const n = Number($('shares').value);
    if (n > 0 && Number($('total').value) > 0 && !Number($('costBasis').value)) $('costBasis').value = +(Number($('total').value) / n).toFixed(6);
    refresh();
  });
  $('costBasis').addEventListener('input', () => {
    const n = Number($('shares').value);
    if (n > 0) $('total').value = +(n * Number($('costBasis').value)).toFixed(2);
    refresh();
  });
  $('total').addEventListener('input', () => {
    const n = Number($('shares').value);
    if (n > 0) $('costBasis').value = +(Number($('total').value) / n).toFixed(6);
    refresh();
  });
  $('fxRate').addEventListener('input', refresh);
  $('idrPaid').addEventListener('input', () => {
    const usd = Number($('shares').value) * Number($('costBasis').value);
    const idr = Number($('idrPaid').value);
    if (usd > 0 && idr > 0 && ccy() === 'USD') {
      $('fxRate').value = +(idr / usd).toFixed(2);
      f.querySelector('.fxsrc').textContent = 'effective rate from the rupiah you paid';
    }
    refresh();
  });
  const lookup = async (quiet) => {
    const d = $('purchaseDate').value;
    if (!d) return quiet || toast('Enter the purchase date first', true);
    try {
      const r = await api.fxOn(d, 'USD', 'IDR');
      $('fxRate').value = r.rate;
      f.querySelector('.fxsrc').textContent = `ECB reference rate for ${r.date}${r.date !== d ? ' (last business day before)' : ''} — edit if your bank's rate differed`;
      refresh();
    } catch (err) {
      if (!quiet) toast(`No rate found: ${err.message}`, true);
    }
  };
  f.querySelector('[data-lookup]').addEventListener('click', () => lookup(false));
  $('purchaseDate').addEventListener('change', () => {
    if (!$('fxRate').value && (ccy() === 'USD' || ccy() === 'IDR')) lookup(true);
  });
  $('assetClass').addEventListener('change', () => {
    if ($('assetClass').value === 'Bond') {
      m.close();
      bondDialog($('symbol').value.trim().toUpperCase(), { ...defaults, account: $('account').value });
    }
  });
  refresh();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const lot = {
      id: defaults.id || uid(),
      symbol: v.symbol.trim().toUpperCase(),
      shares: Number(v.shares),
      costBasis: Number(v.costBasis),
      purchaseDate: v.purchaseDate,
      account: v.account || 'Taxable',
      assetClass: v.assetClass,
      notes: v.notes,
    };
    if (Number(v.fxRate) > 0 && !f.querySelector('.fx').hidden) lot.fxRate = Number(v.fxRate);
    if (!lot.symbol || !Number.isFinite(lot.shares) || lot.shares === 0 || !Number.isFinite(lot.costBasis)) return toast('Enter symbol, shares and price', true);
    save(lot, !!defaults.id, m);
  });
}

// ---- bonds ----------------------------------------------------------------------------------
export function bondDialog(series, defaults = {}) {
  const b = defaults.bond || {};
  const info = sbnInfo(series);
  const f = h('form', { class: 'form' });
  f.innerHTML = `
    <label>Series / name<input class="in" name="symbol" required value="${esc(info?.series || series || '')}" placeholder="SBR015T2, ORI025T3, FR0100"><span class="hint lookupinfo">Indonesian SBN codes are looked up automatically</span></label>
    <label>Currency<select class="in" name="currency">${['IDR', 'USD', 'EUR', 'SGD'].map((c) => `<option ${c === (b.currency || defaults.currency || 'IDR') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label>Nominal (face value)<input class="in num" name="nominal" type="number" step="any" min="0" required value="${esc(defaults.shares ?? '')}" placeholder="e.g. 10000000"><span class="hint">retail SBN: multiples of Rp 1,000,000</span></label>
    <label>Purchase price (% of par)<input class="in num" name="price" type="number" step="any" min="0" value="${esc(defaults.costBasis != null ? +(defaults.costBasis * 100).toFixed(4) : 100)}"><span class="hint">100 when bought at issue</span></label>
    <label>Purchase / settlement date<input class="in" name="purchaseDate" type="date" max="${today()}" value="${esc(defaults.purchaseDate || '')}"></label>
    <label>Maturity date<input class="in" name="maturity" type="date" required value="${esc(b.maturity || '')}"><span class="hint mathint"></span></label>
    <label>Coupon type<select class="in" name="kind"><option value="fixed" ${b.kind !== 'floating' ? 'selected' : ''}>Fixed</option><option value="floating" ${b.kind === 'floating' ? 'selected' : ''}>Floating (BI-Rate + spread, with floor)</option></select></label>
    <label class="k-fixed">Coupon (% per year)<input class="in num" name="coupon" type="number" step="any" value="${esc(b.kind !== 'floating' ? b.coupon ?? '' : '')}"></label>
    <label class="k-float">Spread over BI-Rate (%)<input class="in num" name="spread" type="number" step="any" value="${esc(b.spread ?? '')}" placeholder="e.g. 0.25"></label>
    <label class="k-float">Floor / minimum coupon (%)<input class="in num" name="floor" type="number" step="any" value="${esc(b.kind === 'floating' ? b.floor ?? b.coupon ?? '' : '')}" placeholder="the initial coupon"></label>
    <label>Coupons per year<select class="in" name="freq">${[[12, 'Monthly (retail SBN)'], [4, 'Quarterly'], [2, 'Semiannual (FR, PBS)'], [1, 'Annual']].map(([v, l]) => `<option value="${v}" ${Number(b.freq || 12) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Tax on coupons (%)<input class="in num" name="taxRate" type="number" step="any" min="0" value="${esc(b.taxRate ?? 10)}"><span class="hint">Indonesian SBN coupons: 10% final tax</span></label>
    <label><span>Tradable on the secondary market</span><select class="in" name="tradable"><option value="1" ${b.tradable ? 'selected' : ''}>Yes — value at market price</option><option value="0" ${!b.tradable ? 'selected' : ''}>No — value at nominal (SBR, ST)</option></select></label>
    <label>Current price % (optional)<input class="in num" name="manualPrice" type="number" step="any" min="0" value="${esc(b.price ?? '')}"><span class="hint">leave blank: PHEI fair price for listed series, else 100</span></label>
    <label class="k-usd">USD/IDR on purchase date<input class="in num" name="fxRate" type="number" step="any" min="0" value="${esc(defaults.fxRate ?? '')}"><span class="hint">for USD bonds held by a rupiah investor</span></label>
    <label>Account<input class="in" name="account" list="acct-list" value="${esc(defaults.account || 'Bank (SBN)')}">${ACCOUNTS}</label>
    <label style="grid-column:1/-1">Notes<input class="in" name="notes" value="${esc(defaults.notes || '')}"></label>
    <div class="note coupon-now" style="grid-column:1/-1"></div>
    <div class="row end" style="grid-column:1/-1"><button class="btn primary" type="submit">${defaults.id ? 'Save bond' : 'Add bond'}</button></div>`;
  const m = modal(defaults.id ? `Edit bond · ${series}` : 'Add bond', f);
  const $ = (n) => f.elements[n];
  let biRate = null;
  let biHistory = [];
  api.indonesiaMacro().then((d) => {
    biHistory = d.biRate?.decisions || [];
    biRate = biHistory[0]?.rate ?? null;
    showCoupon();
  }, () => {});
  const showCoupon = () => {
    const floating = $('kind').value === 'floating';
    f.querySelectorAll('.k-fixed').forEach((x) => (x.hidden = floating));
    f.querySelectorAll('.k-float').forEach((x) => (x.hidden = !floating));
    f.querySelector('.k-usd').hidden = $('currency').value !== 'USD';
    const out = f.querySelector('.coupon-now');
    const nominal = Number($('nominal').value) || 0;
    const tax = (Number($('taxRate').value) || 0) / 100;
    let cpn = null;
    const floor = Number($('floor').value) || 0;
    const spread = Number($('spread').value) || 0;
    let note = '';
    if (floating && biRate != null) {
      // Coupon resets every 3 months from the BI-Rate in force just before the reset.
      cpn = couponOn({ kind: 'floating', coupon: floor, floor, spread, maturity: $('maturity').value }, today(), biHistory);
      const next = biRate + spread > cpn ? ` — rises to ${num(Math.max(floor, biRate + spread), 2)}% at the next 3-month reset` : '';
      note = ` (BI-Rate + ${num(spread, 2)}% spread, floor ${num(floor, 2)}%; BI-Rate now ${num(biRate, 2)}%${next})`;
    } else if (!floating && $('coupon').value) cpn = Number($('coupon').value);
    out.innerHTML = cpn == null
      ? ''
      : `Coupon now: <b class="amber">${num(cpn, 2)}%</b>${note} · net after tax ${num(cpn * (1 - tax), 2)}%${nominal ? ` · ≈ ${$('currency').value} ${num((nominal * cpn * (1 - tax)) / 100 / Number($('freq').value), 0)} per payment` : ''}`;
  };
  ['kind', 'coupon', 'spread', 'floor', 'taxRate', 'nominal', 'freq', 'currency'].forEach((n) => $(n).addEventListener('input', showCoupon));
  ['kind', 'freq', 'currency', 'tradable', 'maturity'].forEach((n) => $(n).addEventListener('change', showCoupon));

  // Look up Indonesian series: structure from the code, coupon/maturity/price from PHEI if listed.
  const lookup = async () => {
    const code = $('symbol').value.trim().toUpperCase();
    const si = sbnInfo(code);
    const hint = f.querySelector('.lookupinfo');
    if (!si) {
      hint.textContent = 'Not an Indonesian SBN code — enter the terms manually';
      return;
    }
    $('symbol').value = si.series;
    if (!defaults.id) {
      $('freq').value = String(si.freq === 1 ? 1 : si.freq);
      $('kind').value = si.kind === 'floating' ? 'floating' : 'fixed';
      $('tradable').value = si.tradable ? '1' : '0';
      $('currency').value = 'IDR';
      const k = knownSeries(si.series);
      if (k) {
        $('kind').value = k.kind;
        $('spread').value = k.spread;
        $('floor').value = k.floor;
        $('maturity').value = k.maturity;
        f.querySelector('.mathint').textContent = 'published terms filled in — check against your confirmation';
      }
      if (!$('maturity').value && si.tenorYears && $('purchaseDate').value) $('maturity').value = addYears($('purchaseDate').value, si.tenorYears);
    }
    hint.textContent = `${si.name}${si.sharia ? ' (sharia)' : ''} · ${si.tradable ? 'tradable' : 'non-tradable'}`;
    try {
      const r = await api.bondSearch(si.series);
      if (r.row) {
        if (!$('coupon').value) $('coupon').value = r.row.coupon;
        if (!$('maturity').value && r.asOf) {
          $('maturity').value = addYears(r.asOf, r.row.ttm);
          f.querySelector('.mathint').textContent = `approx. from PHEI (${num(r.row.ttm, 2)} yrs left) — check your term sheet`;
        }
        hint.textContent += ` · PHEI fair price ${num(r.row.price, 2)}% (${r.asOf})`;
      } else if (!si.tradable && !knownSeries(si.series)) {
        hint.textContent += ' · enter spread, floor and maturity from your purchase confirmation';
      }
    } catch {
      /* lookup is a convenience */
    }
    showCoupon();
  };
  $('symbol').addEventListener('change', lookup);
  if (series && !defaults.id) lookup();
  showCoupon();

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const floating = v.kind === 'floating';
    const bond = {
      kind: floating ? 'floating' : 'fixed',
      coupon: floating ? Number(v.floor) || 0 : Number(v.coupon),
      spread: floating ? Number(v.spread) || 0 : 0,
      floor: floating ? Number(v.floor) || 0 : null,
      freq: Number(v.freq) || 12,
      maturity: v.maturity,
      taxRate: Number(v.taxRate) || 0,
      tradable: v.tradable === '1',
      currency: v.currency || 'IDR',
      reference: floating ? 'BI-Rate' : null,
    };
    if (Number(v.manualPrice) > 0) bond.price = Number(v.manualPrice);
    if (!v.symbol || !(Number(v.nominal) > 0) || !bond.maturity) return toast('Enter series, nominal and maturity', true);
    if (!floating && !Number.isFinite(bond.coupon)) return toast('Enter the coupon rate', true);
    const lot = {
      id: defaults.id || uid(),
      symbol: v.symbol.trim().toUpperCase(),
      shares: Number(v.nominal),
      costBasis: (Number(v.price) || 100) / 100,
      purchaseDate: v.purchaseDate,
      account: v.account || 'Bank (SBN)',
      assetClass: 'Bond',
      notes: v.notes,
      bond,
    };
    if (bond.currency === 'USD' && Number(v.fxRate) > 0) lot.fxRate = Number(v.fxRate);
    save(lot, !!defaults.id, m);
  });
}
