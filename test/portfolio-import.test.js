import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importRows, parseNumber, parseDate } from '../public/js/screens/portfolio.js';
import { converter, factorSeries, fxSymbolsFor, ratesFromQuotes, fmtMoney } from '../public/js/valuation.js';

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
  assert.equal(lots.length, 7);
  const bbca = lots.find((l) => l.symbol === 'BBCA.JK');
  assert.deepEqual([bbca.shares, bbca.costBasis, bbca.purchaseDate, bbca.account], [500, 9250, '2024-02-12', 'IDX Broker']);
  assert.equal(lots.find((l) => l.symbol === 'BTC-USD').shares, 0.05);
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
