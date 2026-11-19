import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, num } from '../server/lib/csv.js';
import { parseFeed, stripTags } from '../server/lib/xml.js';
import { readFirstSheet } from '../server/lib/xlsx.js';
import { parseTreasuryCSV, parseFredCSV } from '../server/providers/macro.js';
import { parseNport } from '../server/providers/sec.js';
import { parseSsgaWorkbook, normName } from '../server/services/etf.js';
import { normalizeSymbol, classify, toNasdaq, fxPair } from '../server/lib/symbols.js';
import { parseETDateTime, parseNasdaqTimestamp, mdyToISO } from '../server/lib/time.js';
import { sanitize } from '../server/store.js';

const fx = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', f);

test('CSV parser handles quotes, escaped quotes and CRLF', () => {
  assert.deepEqual(parseCSV('a,"b,c","d ""e"""\r\n1,2,3\n'), [
    ['a', 'b,c', 'd "e"'],
    ['1', '2', '3'],
  ]);
});

test('num() parses market-data strings', () => {
  assert.equal(num('$1,234.50'), 1234.5);
  assert.equal(num('-0.68%'), -0.68);
  assert.equal(num('+2.5'), 2.5);
  assert.equal(num('--'), null);
  assert.equal(num('N/A'), null);
  assert.equal(num('.'), null);
});

test('symbol normalisation and classification', () => {
  assert.equal(normalizeSymbol(' brk.b '), 'BRK-B');
  assert.equal(normalizeSymbol('VOD.L'), 'VOD.L');
  assert.equal(toNasdaq('BRK-B'), 'BRK.B');
  assert.equal(classify('^GSPC'), 'index');
  assert.equal(classify('ES=F'), 'future');
  assert.equal(classify('EURUSD=X'), 'fx');
  assert.equal(classify('BTC-USD'), 'crypto');
  assert.equal(classify('7203.T'), 'intl');
  assert.equal(classify('AAPL'), 'us');
  assert.equal(classify('BRK-B'), 'us');
  assert.deepEqual(fxPair('EURUSD=X'), ['EUR', 'USD']);
  assert.deepEqual(fxPair('JPY=X'), ['USD', 'JPY']);
});

test('Eastern-time timestamp parsing', () => {
  // 1:55 PM EST == 18:55 UTC
  assert.equal(new Date(parseNasdaqTimestamp('Nov 17, 2026 1:55 PM ET')).toISOString(), '2026-11-17T18:55:00.000Z');
  assert.equal(new Date(parseETDateTime('2026-11-17T13:56:09.0379388-05:00')).toISOString(), '2026-11-17T18:56:09.037Z');
  // No offset -> interpreted as New York time (EDT in July)
  assert.equal(new Date(parseETDateTime('2026-07-01T09:30:00')).toISOString(), '2026-07-01T13:30:00.000Z');
  assert.equal(mdyToISO('11/6/2026'), '2026-11-06');
});

test('RSS feed parsing (CNBC sample)', () => {
  const items = parseFeed(fs.readFileSync(fx('rss-sample.xml'), 'utf8'));
  assert.equal(items.length, 2);
  for (const i of items) {
    assert.ok(i.title.length > 5);
    assert.match(i.link, /^https:\/\/www\.cnbc\.com\//);
    assert.ok(i.published === null || !Number.isNaN(Date.parse(i.published)));
  }
  assert.equal(stripTags('<![CDATA[<b>Fed&amp;rates</b>]]>'), 'Fed&rates');
});

test('Treasury daily par yield curve CSV', () => {
  const rows = parseTreasuryCSV(fs.readFileSync(fx('treasury-sample.csv'), 'utf8'));
  assert.equal(rows.length, 3);
  assert.ok(rows[0].date < rows[2].date, 'sorted ascending');
  const last = rows.at(-1);
  assert.equal(typeof last.yields['10 Yr'], 'number');
  assert.equal(typeof last.yields['1.5 Month'], 'number');
});

test('FRED fredgraph CSV skips missing observations', () => {
  const pts = parseFredCSV(fs.readFileSync(fx('fred-sample.csv'), 'utf8'));
  assert.deepEqual(pts.map((p) => p.date), ['2026-11-12', '2026-11-13', '2026-11-16']);
  assert.equal(pts.at(-1).value, 5.12);
  assert.deepEqual(parseFredCSV('DATE,UNRATE\n2024-01-01,3.7\n2024-02-01,.\n'), [{ date: '2024-01-01', value: 3.7 }]);
});

test('XLSX reader + SSGA holdings parser', () => {
  const rows = readFirstSheet(fs.readFileSync(fx('ssga-sample.xlsx')));
  const r = parseSsgaWorkbook(rows);
  assert.equal(r.fundName, 'SPDR Test ETF');
  assert.equal(r.asOf, '16-Nov-2026');
  assert.equal(r.holdings.length, 4);
  assert.deepEqual(r.holdings[0], { name: 'APPLE INC', ticker: 'AAPL', cusip: '037833100', isin: '', sedol: '2046251', weight: 8.041495, shares: 180526549, sector: '', currency: 'USD', assetCat: 'EC' });
  assert.equal(r.holdings[2].name, 'AT&T INC');
  assert.equal(r.holdings[2].sedol, '2831811', 'inline strings are read');
  assert.equal(r.holdings[3].assetCat, 'CASH');
});

test('SEC N-PORT holdings parser', () => {
  const r = parseNport(fs.readFileSync(fx('nport-sample.xml'), 'utf8'));
  assert.equal(r.seriesName, 'VANGUARD 500 INDEX FUND');
  assert.equal(r.reportDate, '2026-06-30');
  assert.ok(r.netAssets > 1e12);
  assert.equal(r.holdings.length, 2);
  const h = r.holdings[0];
  assert.equal(h.cusip, '910047109');
  assert.equal(h.isin, 'US9100471096');
  assert.equal(h.assetCat, 'EC');
  assert.ok(h.weight > 0 && h.weight < 1);
});

test('company-name normalisation for ticker matching', () => {
  assert.equal(normName('Coca-Cola Co/The'), normName('COCA COLA CO'));
  assert.equal(normName('Apple Inc.'), normName('APPLE INC'));
});

test('portfolio store sanitises input', () => {
  const doc = sanitize({
    positions: [
      { symbol: 'brk.b', shares: '10', costBasis: '300.5', purchaseDate: '2024-01-02', assetClass: 'Equity' },
      { symbol: '', shares: 5 },
      { symbol: 'VOO', shares: 0 },
      { symbol: 'X', shares: 1, purchaseDate: 'not-a-date', assetClass: 'Nonsense' },
    ],
    watchlist: ['aapl', 'AAPL', ''],
  });
  assert.equal(doc.positions.length, 2);
  assert.equal(doc.positions[0].symbol, 'BRK-B');
  assert.equal(doc.positions[0].shares, 10);
  assert.equal(doc.positions[0].costBasis, 300.5);
  assert.ok(doc.positions[0].id);
  assert.equal(doc.positions[1].purchaseDate, '');
  assert.equal(doc.positions[1].assetClass, 'Equity');
  assert.deepEqual(doc.watchlist, ['AAPL']);
});

// ---- Indonesia -------------------------------------------------------------------
import { parseBiRate, parseBiPress, parseLongDate } from '../server/providers/indonesia.js';
import { currencyOf } from '../server/lib/symbols.js';

test('Bank Indonesia BI-Rate table', () => {
  const rows = parseBiRate(fs.readFileSync(fx('bi-rate-sample.html'), 'utf8'));
  assert.ok(rows.length >= 5, `rows ${rows.length}`);
  assert.equal(rows[0].date, '2026-11-18');
  assert.equal(rows[0].rate, 6);
  assert.ok(rows[0].date > rows[1].date, 'newest first');
  assert.match(rows[0].url, /^https:\/\/www\.bi\.go\.id\/en\/publikasi\//);
});

test('Bank Indonesia press release cards', () => {
  const items = parseBiPress(fs.readFileSync(fx('bi-press-sample.html'), 'utf8'));
  assert.ok(items.length >= 1);
  assert.match(items[0].title, /BI-Rate/);
  assert.equal(items[0].published, '2026-11-18T05:00:00.000Z');
  assert.ok(!/DKom/.test(items[0].summary), 'reference number stripped');
  assert.equal(parseLongDate('3 March 2025'), '2025-03-03');
  assert.equal(parseLongDate('nonsense'), null);
});

test('currency inferred from exchange suffix', () => {
  assert.equal(currencyOf('BBCA.JK'), 'IDR');
  assert.equal(currencyOf('^JKSE'), 'IDR');
  assert.equal(currencyOf('AAPL'), 'USD');
  assert.equal(currencyOf('VOD.L'), 'GBp');
  assert.equal(currencyOf('7203.T'), 'JPY');
  assert.equal(currencyOf('IDR=X'), 'IDR');
  assert.equal(currencyOf('BTC-USD'), 'USD');
});

// ---- bonds ---------------------------------------------------------------------------
import { parsePhei, idNum, interpolate } from '../server/providers/bonds.js';

test('PHEI fair-price page: curve, benchmark & retail series, corporate yields', () => {
  const d = parsePhei(fs.readFileSync(fx('phei-sample.html'), 'utf8'));
  assert.equal(d.asOf, '2026-11-18');
  assert.ok(d.curve.length >= 40, `curve ${d.curve.length}`);
  const ten = d.curve.find((p) => p.years === 10);
  assert.equal(ten.yield, 7.729);
  const fr = d.series.find((s) => s.series === 'FR0108');
  assert.deepEqual([fr.ttm, fr.yield, fr.price, fr.coupon, fr.group], [9.41, 7.7245, 91.9092, 6.5, 'SBN benchmark']);
  assert.equal(d.series.find((s) => s.series === 'PBS034').group, 'SBSN benchmark (sukuk)');
  assert.equal(d.series.find((s) => s.series === 'ORI025T3').group, 'Retail (tradable)');
  assert.ok(d.series.some((s) => s.series.startsWith('SR')));
  const c5 = d.corporate.find((r) => r.years === 5);
  assert.ok(c5.AAA > c5.IGS && c5.BBB > c5.AAA);
  assert.equal(idNum('1.234,5'), 1234.5);
  assert.equal(interpolate([{ years: 1, yield: 6 }, { years: 3, yield: 7 }], 2), 6.5);
});
