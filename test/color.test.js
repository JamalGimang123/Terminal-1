import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/js/lib/color.js';
import { PRESETS } from '../public/js/theme.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const series = (v) => ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((k) => v[k]);

test('hex <-> HSL round trip', () => {
  assert.deepEqual(C.hexToHsl('#ff0000'), [0, 1, 0.5]);
  assert.equal(C.hslToHex(120, 1, 0.25), '#008000');
  for (const hex of ['#3987e5', '#d95926', '#0b0e12', '#ffffff', '#7d848e']) assert.equal(C.hslToHex(...C.hexToHsl(hex)), hex);
});

test('OKLab / OKLCH conversions', () => {
  close(C.oklch('#ffffff')[0], 1, 1e-4);
  close(C.oklch('#000000')[0], 0, 1e-6);
  const [L, Ch, H] = C.oklch('#3987e5');
  assert.equal(C.oklchToHex(L, Ch, H), '#3987e5');
  // Out-of-gamut chroma is reduced, lightness and hue kept.
  const hex = C.oklchToHex(0.6, 0.4, 145);
  close(C.oklch(hex)[0], 0.6, 0.01);
  close(C.oklch(hex)[2], 145, 2);
});

test('contrast and color-vision distances', () => {
  close(C.contrast('#000000', '#ffffff'), 21, 1e-9);
  assert.equal(C.deltaE('#3987e5', '#3987e5'), 0);
  // Classic red/green pair: obvious for normal vision, nearly merged for deuteranopes.
  assert.ok(C.deltaE('#d62728', '#2ca02c') > 25);
  assert.ok(C.deltaE('#d62728', '#2ca02c', 'deutan') < C.deltaE('#d62728', '#2ca02c') / 2);
  assert.equal(C.simulateHex('#808080', 'protan'), '#808080'); // grays are unchanged
});

test('built-in chart series pass the palette checks on their panels', () => {
  for (const name of ['Amber Terminal', 'Paper (light)']) {
    const v = PRESETS[name];
    const r = C.checkPalette(series(v), v.panel);
    assert.notEqual(r.status, 'fail', `${name}: ${r.issues.map((i) => i.text).join('; ')}`);
    assert.ok(r.worstNormal.normal >= 15);
  }
});

test('red-green neighbours fail; reordering fixes it', () => {
  const bad = ['#d62728', '#2ca02c', '#1f77b4', '#ff7f0e'];
  assert.equal(C.checkPalette(bad, '#0b0e12').status, 'fail');
  const fixed = C.bestOrder(bad);
  assert.equal(fixed[0], bad[0]);
  assert.deepEqual([...fixed].sort(), [...bad].sort());
  assert.ok(C.checkPalette(fixed, '#0b0e12').worstCvd.cvd > C.checkPalette(bad, '#0b0e12').worstCvd.cvd);
});

test('harmony palettes', () => {
  assert.deepEqual(C.harmonyHues(10, 'complementary', 4), [10, 190, 100, 280]); // extra series fill the gaps
  assert.deepEqual(C.harmonyHues(0, 'triadic', 3), [0, 120, 240]);
  for (const [scheme, surface] of [['triadic', '#0b0e12'], ['even', '#fcfcfb'], ['tetradic', '#0b0e12']]) {
    const p = C.harmonyPalette('#ffa028', scheme, surface);
    assert.equal(p.length, 8);
    for (const hex of p) assert.ok(C.contrast(hex, surface) >= 3, `${scheme} ${hex} contrast`);
  }
  // Evenly spaced hues, best order: passes outright on a dark panel.
  const even = C.bestOrder(C.harmonyPalette('#3987e5', 'even', '#0b0e12'));
  assert.notEqual(C.checkPalette(even, '#0b0e12').status, 'fail');
});
