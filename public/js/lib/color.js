// Color math for the THEME color wheel: HSL <-> hex, OKLab/OKLCH, WCAG contrast,
// color-vision-deficiency simulation and palette checks. Pure functions (no DOM).
//
// Palette checks follow a standard data-visualisation recipe:
// - distances are Euclidean in OKLab ×100 ("ΔE");
// - neighbouring chart series need ΔE ≥ 15 for normal vision, and ≥ 8 (target) / ≥ 6 (floor)
//   under protanopia & deuteranopia simulated with Machado, Oliveira & Fernandes (2009), severity 1;
// - marks need ≥ 3:1 contrast against the panel; lightness should sit in a mid band
//   (OKLCH L 0.43–0.77 on light surfaces, 0.48–0.67 on dark) with chroma ≥ 0.10.

export const LIMITS = { normal: 15, cvdTarget: 8, cvdFloor: 6, contrast: 3, chroma: 0.1, band: { light: [0.43, 0.77], dark: [0.48, 0.67] } };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}
export const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

// HSL with h in degrees [0, 360), s and l in [0, 1].
export function rgbToHsl([r, g, b]) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
export const hexToHsl = (hex) => rgbToHsl(hexToRgb(hex));
export const hslToHex = (h, s, l) => rgbToHex(hslToRgb(h, s, l));

// ---- OKLab ------------------------------------------------------------------------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const linOf = (hex) => hexToRgb(hex).map((v) => toLin(v / 255));

function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function linFromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
export const oklab = (hex) => oklabFromLin(linOf(hex));
export function oklch(hex) {
  const [L, a, b] = oklab(hex);
  return [L, Math.hypot(a, b), (((Math.atan2(b, a) * 180) / Math.PI) % 360 + 360) % 360];
}
// OKLCH -> hex, reducing chroma until the color fits in sRGB (keeps lightness and hue).
export function oklchToHex(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const fits = (c) => linFromOklab([L, c * Math.cos(rad), c * Math.sin(rad)]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let c = C;
  if (!fits(c)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return rgbToHex(linFromOklab([L, c * Math.cos(rad), c * Math.sin(rad)]).map((v) => fromLin(clamp01(v)) * 255));
}

// ---- contrast & vision simulation -------------------------------------------------
export function luminance(hex) {
  const [r, g, b] = linOf(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
function simulateLin(hex, kind) {
  const v = linOf(hex);
  if (!kind) return v;
  return MACHADO[kind].map((row) => clamp01(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
}
// How a color looks with a color-vision deficiency (for swatch previews).
export const simulateHex = (hex, kind) => rgbToHex(simulateLin(hex, kind).map((v) => fromLin(v) * 255));

// ΔE: Euclidean distance in OKLab ×100; `kind` simulates protan / deutan / tritan vision.
export function deltaE(a, b, kind) {
  const p = oklabFromLin(simulateLin(a, kind));
  const q = oklabFromLin(simulateLin(b, kind));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---- palette checks -----------------------------------------------------------------
export const modeOf = (surface) => (luminance(surface) > 0.4 ? 'light' : 'dark');

/**
 * Check a categorical palette (chart series in order) against a surface.
 * Neighbouring series are compared (lines, bars and stacks put neighbours side by side).
 * Returns per-slot and per-pair numbers plus an overall 'pass' | 'warn' | 'fail'.
 */
export function checkPalette(colors, surface) {
  const mode = modeOf(surface);
  const [lo, hi] = LIMITS.band[mode];
  const slots = colors.map((hex) => {
    const [L, C] = oklch(hex);
    const ratio = contrast(hex, surface);
    return { hex, L, C, contrast: ratio, inBand: L >= lo - 1e-9 && L <= hi + 1e-9, chromaOk: C >= LIMITS.chroma, contrastOk: ratio >= LIMITS.contrast };
  });
  const pairs = [];
  for (let i = 0; i + 1 < colors.length; i++) {
    const [a, b] = [colors[i], colors[i + 1]];
    const protan = deltaE(a, b, 'protan');
    const deutan = deltaE(a, b, 'deutan');
    pairs.push({ i, j: i + 1, normal: deltaE(a, b), protan, deutan, cvd: Math.min(protan, deutan), tritan: deltaE(a, b, 'tritan') });
  }
  const worst = (k) => (pairs.length ? pairs.reduce((m, p) => (p[k] < m[k] ? p : m)) : null);
  const wn = worst('normal');
  const wc = worst('cvd');
  const issues = [];
  if (wn && wn.normal < LIMITS.normal) issues.push({ level: 'fail', text: `Series ${wn.i + 1} and ${wn.j + 1} look too similar (ΔE ${wn.normal.toFixed(1)}, needs ${LIMITS.normal})` });
  if (wc && wc.cvd < LIMITS.cvdFloor) issues.push({ level: 'fail', text: `Series ${wc.i + 1} and ${wc.j + 1} merge for color-blind readers (ΔE ${wc.cvd.toFixed(1)}, needs ${LIMITS.cvdTarget})` });
  else if (wc && wc.cvd < LIMITS.cvdTarget) issues.push({ level: 'warn', text: `Series ${wc.i + 1} and ${wc.j + 1} are close for color-blind readers (ΔE ${wc.cvd.toFixed(1)}, target ${LIMITS.cvdTarget}) — OK only with labels` });
  slots.forEach((s, i) => {
    if (!s.contrastOk) issues.push({ level: 'warn', text: `Series ${i + 1} has low contrast on the panel (${s.contrast.toFixed(1)}:1, needs 3:1)` });
    if (!s.chromaOk) issues.push({ level: 'warn', text: `Series ${i + 1} is nearly gray (chroma ${s.C.toFixed(2)})` });
    else if (!s.inBand) issues.push({ level: 'warn', text: `Series ${i + 1} is ${s.L < lo ? 'darker' : 'lighter'} than the recommended band (L ${s.L.toFixed(2)}, ${lo}–${hi})` });
  });
  const status = issues.some((x) => x.level === 'fail') ? 'fail' : issues.length ? 'warn' : 'pass';
  return { mode, slots, pairs, worstNormal: wn, worstCvd: wc, issues, status };
}

// ---- harmonies ----------------------------------------------------------------------
// Hue offsets on the wheel. The first entries are the scheme itself; with fewer hues than
// series, extra series fill in between the scheme's hues.
export const SCHEMES = {
  complementary: { label: 'Complementary', offsets: [0, 180] },
  split: { label: 'Split-complementary', offsets: [0, 150, 210] },
  triadic: { label: 'Triadic', offsets: [0, 120, 240] },
  tetradic: { label: 'Tetradic (square)', offsets: [0, 90, 180, 270] },
  analogous: { label: 'Analogous', offsets: [0, 30, -30, 60, -60, 90, -90, 120] },
  even: { label: 'Evenly spaced (8 hues)', offsets: [0, 135, 270, 45, 180, 315, 90, 225] },
};

export function harmonyHues(baseHue, scheme, n = 8) {
  const offs = SCHEMES[scheme]?.offsets || SCHEMES.even.offsets;
  const k = offs.length;
  const rounds = Math.ceil(n / k);
  const gap = k > 1 ? Math.min(...offs.slice(1).map((o, i) => Math.abs(o - offs[i]))) : 360;
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / k);
    const shift = r ? (r * Math.min(gap, 360 / k)) / rounds : 0;
    return (((baseHue + offs[i % k] + shift) % 360) + 360) % 360;
  });
}

// Chart palette from a base color and a scheme: hues from the wheel, lightness and chroma
// normalised in OKLCH so every series has a similar visual weight and clears 3:1 contrast.
export function harmonyPalette(baseHex, scheme, surface, n = 8) {
  const mode = modeOf(surface);
  const [lo, hi] = LIMITS.band[mode];
  const [h, s] = hexToHsl(baseHex);
  const Ls = mode === 'dark' ? [0.66, 0.53] : [0.47, 0.62];
  return harmonyHues(h, scheme, n).map((hue, i) => {
    const okHue = oklch(hslToHex(hue, Math.max(0.6, s), 0.5))[2];
    let L = Ls[i % 2];
    let hex = oklchToHex(L, 0.16, okHue);
    // Nudge lightness until the mark clears 3:1 on the panel (within the band).
    for (let t = 0; t < 12 && contrast(hex, surface) < LIMITS.contrast; t++) {
      L = mode === 'dark' ? Math.min(hi, L + 0.02) : Math.max(lo, L - 0.02);
      hex = oklchToHex(L, 0.16, okHue);
    }
    return hex;
  });
}

// Reorder series so neighbours are as distinct as possible (normal and color-blind vision).
// Score = min over neighbours of min(CVD ΔE / 8, normal ΔE / 15); keeps series 1 in place.
export function bestOrder(colors) {
  const n = colors.length;
  if (n < 3 || n > 9) return colors.slice();
  const score = colors.map((a) => colors.map((b) => (a === b ? 0 : Math.min(Math.min(deltaE(a, b, 'protan'), deltaE(a, b, 'deutan')) / LIMITS.cvdTarget, deltaE(a, b) / LIMITS.normal))));
  let best = null;
  let bestScore = -1;
  let bestSum = -1;
  const used = new Array(n).fill(false);
  const path = [0];
  used[0] = true;
  const walk = (minSoFar, sum) => {
    if (minSoFar < bestScore) return; // can't beat the best
    if (path.length === n) {
      if (minSoFar > bestScore || (minSoFar === bestScore && sum > bestSum)) {
        bestScore = minSoFar;
        bestSum = sum;
        best = path.slice();
      }
      return;
    }
    const last = path[path.length - 1];
    for (let j = 1; j < n; j++) {
      if (used[j]) continue;
      used[j] = true;
      path.push(j);
      walk(Math.min(minSoFar, score[last][j]), sum + score[last][j]);
      path.pop();
      used[j] = false;
    }
  };
  walk(Infinity, 0);
  return best.map((i) => colors[i]);
}
