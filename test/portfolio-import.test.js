import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importRows, parseNumber, parseDate, toCSV } from '../public/js/screens/portfolio.js';
import { converter, factorSeries, fxSymbolsFor, ratesFromQuotes, fmtMoney, lotCostInBase, bondPricePct } from '../public/js/valuation.js';

test('number parsing handles $, commas and Indonesian thousands dots', () => {
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber('$172.30'), 172.3);
  assert.equal(parseNumber('Rp 9.250'), 9250);
  assert.equal(parseNumber('1.234.567,89'), 1234567.89);
  assert.equal(parseNumber('58,10'), 58.1);
  assert.equal(parseNumber('245.10'), 245.1);
  assert.ok(Number.isNaN(parseNumber('')));
});

test('date parsing', () => {
  assert.equal(parseDate('2024-03-15'), '2024-03-15');
  assert.equal(parseDate('15/03/2024'), '2024-03-15'); // day > 12 -> D/M/Y
  assert.equal(parseDate('2024-3-5'), '2024-03-05');
  assert.equal(parseDate(''), '');
});

test('the shipped example CSV imports cleanly', () => {
  const lots = importRows(fs.readFileSync(new URL('../public/examples/portfolio-example.csv', import.meta.url), 'utf8'));
  assert.equal(lots.length, 9);
  const bbca = lots.find((l) => l.symbol === 'BBCA.JK');
  assert.deepEqual([bbca.shares, bbca.costBasis, bbca.purchaseDate, bbca.account], [500, 9250, '2024-02-12', 'IDX Broker']);
  assert.equal(bbca.fxRate, undefined);
  assert.equal(lots.find((l) => l.symbol === 'BTC-USD').shares, 0.05);
  assert.equal(lots.find((l) => l.symbol === 'VTI').fxRate, 15618);
  const fr = lots.find((l) => l.symbol === 'FR0106');
  assert.deepEqual([fr.assetClass, fr.shares, fr.costBasis, fr.bond.kind, fr.bond.coupon, fr.bond.freq, fr.bond.maturity, fr.bond.tradable, fr.bond.taxRate], ['Bond', 50_000_000, 0.975, 'fixed', 7.125, 2, '2040-08-15', true, 10]);
  const sbr = lots.find((l) => l.symbol === 'SBR015T2');
  assert.deepEqual([sbr.costBasis, sbr.bond.kind, sbr.bond.spread, sbr.bond.floor, sbr.bond.freq, sbr.bond.tradable, sbr.bond.maturity], [1, 'floating', 1, 6.75, 12, false, '2028-10-10']);
});

test('bond rows: published SBR terms fill gaps, export round-trips', () => {
  const [fr] = importRows('symbol;shares;costBasis;coupon;maturity\nFR0100;100000000;98,125;6,625;2034-02-15\n');
  assert.deepEqual([fr.costBasis, fr.bond.coupon], [0.98125, 6.625]);
  const [lot] = importRows('symbol,shares\nsbr15t2,5000000\n');
  assert.equal(lot.symbol, 'SBR015T2');
  assert.deepEqual([lot.costBasis, lot.bond.kind, lot.bond.spread, lot.bond.floor, lot.bond.maturity], [1, 'floating', 1, 6.75, '2028-10-10']);
  const back = importRows(toCSV([lot, { id: 'x', symbol: 'VTI', shares: 2, costBasis: 250, purchaseDate: '2024-03-15', account: 'IRA', assetClass: 'ETF', notes: '', fxRate: 15618 }]));
  assert.deepEqual(back.map((l) => [l.symbol, l.shares, l.costBasis, l.fxRate, l.bond?.floor]), [['SBR015T2', 5_000_000, 1, undefined, 6.75], ['VTI', 2, 250, 15618, undefined]]);
});

test('Indonesian broker export: semicolons, lots, exchange column', () => {
  const csv = 'Kode Saham;Lot;Harga Rata-rata;Tanggal;Bursa\nBBRI;12;Rp 4.150;20/01/2025;IDX\n';
  const [lot] = importRows(csv);
  assert.equal(lot.symbol, 'BBRI.JK');
  assert.equal(lot.shares, 1200);
  assert.equal(lot.costBasis, 4150);
  assert.equal(lot.purchaseDate, '2025-01-20');
});

test('currency conversion to USD and IDR bases', () => {
  const rates = ratesFromQuotes({ 'IDR=X': { price: 16000 }, 'GBP=X': { price: 0.8 }, AAPL: { price: 200 } });
  assert.deepEqual(rates, { USD: 1, IDR: 16000, GBP: 0.8 });
  const toUsd = converter(rates, 'USD');
  assert.equal(toUsd(1_600_000, 'IDR'), 100);
  assert.equal(toUsd(800, 'GBp'), 10); // pence
  assert.equal(toUsd(5, 'USD'), 5);
  assert.equal(toUsd(5, 'EUR'), null); // no rate -> null, never a wrong number
  const toIdr = converter(rates, 'IDR');
  assert.equal(toIdr(100, 'USD'), 1_600_000);
  assert.equal(toIdr(9250, 'IDR'), 9250);
  assert.deepEqual(fxSymbolsFor(['USD', 'IDR', 'GBp'], 'USD').sort(), ['GBP=X', 'IDR=X']);
  assert.deepEqual(fxSymbolsFor(['USD'], 'IDR'), ['IDR=X']);
  assert.deepEqual(factorSeries('USD', 'IDR', { 'IDR=X': [15000, 16000] }, 2), [15000, 16000]);
  assert.deepEqual(factorSeries('IDR', 'USD', { 'IDR=X': [16000, 16000] }, 2), [1 / 16000, 1 / 16000]);
  assert.equal(fmtMoney(1234567, 'IDR'), 'Rp 1,234,567');
  assert.equal(fmtMoney(-12.5, 'USD'), '−$12.50');
});

test('purchase-date FX rate fixes the cost basis so P&L includes currency moves', () => {
  const rates = { USD: 1, IDR: 18000 }; // today: Rp 18,000 per USD
  const toIdr = converter(rates, 'IDR');
  const lot = { shares: 10, costBasis: 100, fxRate: 15000 }; // $1,000 bought at Rp 15,000
  assert.deepEqual(lotCostInBase(lot, 'USD', 'IDR', toIdr), { cost: 15_000_000, historical: true });
  // same price today: value Rp 18M vs cost Rp 15M -> Rp 3M gain entirely from the rupiah weakening
  assert.equal(toIdr(10 * 100, 'USD') - lotCostInBase(lot, 'USD', 'IDR', toIdr).cost, 3_000_000);
  // without a rate: cost converted at today's rate -> no FX effect
  assert.deepEqual(lotCostInBase({ shares: 10, costBasis: 100 }, 'USD', 'IDR', toIdr), { cost: 18_000_000, historical: false });
  // IDR stock viewed in USD
  const idr = { shares: 500, costBasis: 9000, fxRate: 15000 };
  assert.deepEqual(lotCostInBase(idr, 'IDR', 'USD', converter(rates, 'USD')), { cost: 300, historical: true });
  assert.deepEqual(lotCostInBase(lot, 'USD', 'USD', null), { cost: 1000, historical: true });
});

test('bond prices: manual > PHEI (tradable) > par', () => {
  assert.equal(bondPricePct({ tradable: false }).price, 100);
  assert.equal(bondPricePct({ tradable: true }, { price: 99.5, prevPrice: 99.4 }).price, 99.5);
  assert.equal(bondPricePct({ tradable: false }, { price: 99.5 }).price, 100);
  assert.equal(bondPricePct({ tradable: true, price: 101 }, { price: 99.5 }).price, 101);
});
