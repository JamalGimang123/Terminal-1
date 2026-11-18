// Theme: every color in the app is a CSS variable; a theme is a map of overrides.
import { invalidateThemeCache } from './charts.js';

// [group, key, label, check] — check: 'text' (≥4.5:1 vs panel), 'mark' (≥3:1 vs panel),
// 'onaccent' (≥4.5:1 vs accent), 'heat' (heat text ≥3:1 vs heat colors), null (no check)
export const VARS = [
  ['Surfaces', 'bg', 'Page background', null],
  ['Surfaces', 'bar', 'Top bar, keys & status bar', null],
  ['Surfaces', 'panel', 'Panel background', null],
  ['Surfaces', 'hdr-1', 'Panel header (top)', null],
  ['Surfaces', 'hdr-2', 'Panel header (bottom)', null],
  ['Surfaces', 'panel-2', 'Buttons & row hover', null],
  ['Surfaces', 'panel-3', 'Selected row', null],
  ['Surfaces', 'input-bg', 'Input fields', null],
  ['Surfaces', 'tip-bg', 'Tooltips & popups', null],
  ['Surfaces', 'blue-hdr', 'Active function key', null],
  ['Lines', 'line', 'Grid lines & dividers', null],
  ['Lines', 'line-2', 'Borders', null],
  ['Lines', 'axis', 'Chart axes', null],
  ['Text', 'text', 'Primary text', 'text'],
  ['Text', 'text-2', 'Secondary text', 'text'],
  ['Text', 'muted', 'Labels & muted text', 'text'],
  ['Text', 'link', 'Links', 'text'],
  ['Accent', 'amber', 'Accent (titles, tickers)', 'text'],
  ['Accent', 'amber-2', 'Accent bright (input text)', 'text'],
  ['Accent', 'amber-dim', 'Accent dim (outlines)', null],
  ['Accent', 'on-accent', 'Text on accent', 'onaccent'],
  ['Market colors', 'up', 'Up / gain', 'text'],
  ['Market colors', 'down', 'Down / loss', 'text'],
  ['Market colors', 'flat', 'Unchanged', 'text'],
  ['Market colors', 'warn', 'Warning / delayed', 'text'],
  ['Chart series', 's1', 'Series 1', 'mark'],
  ['Chart series', 's2', 'Series 2', 'mark'],
  ['Chart series', 's3', 'Series 3', 'mark'],
  ['Chart series', 's4', 'Series 4', 'mark'],
  ['Chart series', 's5', 'Series 5', 'mark'],
  ['Chart series', 's6', 'Series 6', 'mark'],
  ['Chart series', 's7', 'Series 7', 'mark'],
  ['Chart series', 's8', 'Series 8', 'mark'],
  ['Heatmaps', 'heat-up', 'Heat tile — gain', null],
  ['Heatmaps', 'heat-down', 'Heat tile — loss', null],
  ['Heatmaps', 'heat-mid', 'Heat tile — flat', null],
  ['Heatmaps', 'heat-text', 'Text on heat cells', 'heat'],
  ['Heatmaps', 'div-pos', 'Correlation +1', null],
  ['Heatmaps', 'div-mid', 'Correlation 0', null],
  ['Heatmaps', 'div-neg', 'Correlation −1', null],
  ['Heatmaps', 'seq-lo', 'Scale low', null],
  ['Heatmaps', 'seq-hi', 'Scale high', null],
];

const AMBER = {
  bg: '#000000', bar: '#050608', panel: '#0b0e12', 'hdr-1': '#141b24', 'hdr-2': '#10161e', 'panel-2': '#11161d', 'panel-3': '#18202a', 'input-bg': '#000000', 'tip-bg': '#05070a', 'blue-hdr': '#10233b',
  line: '#1d242d', 'line-2': '#2a333e', axis: '#3a4450',
  text: '#ebe8e3', 'text-2': '#b4b8be', muted: '#7d848e', link: '#6fb3ff',
  amber: '#ffa028', 'amber-2': '#ffbf5e', 'amber-dim': '#8a5a1a', 'on-accent': '#000000',
  up: '#2fd36b', down: '#ff5c5c', flat: '#b4b8be', warn: '#fab219',
  s1: '#3987e5', s2: '#d95926', s3: '#199e70', s4: '#c98500', s5: '#d55181', s6: '#0ca30c', s7: '#9085e9', s8: '#e66767',
  'heat-up': '#148c46', 'heat-down': '#be3232', 'heat-mid': '#282c32', 'heat-text': '#ffffff',
  'div-pos': '#3987e5', 'div-mid': '#383835', 'div-neg': '#e66767', 'seq-lo': '#18202a', 'seq-hi': '#3987e5',
};

export const PRESETS = {
  'Amber Terminal': AMBER,
  'Green Phosphor': {
    ...AMBER, bg: '#000000', bar: '#020603', panel: '#050c07', 'hdr-1': '#0b1a10', 'hdr-2': '#08130c', 'panel-2': '#0a160e', 'panel-3': '#0f2316', 'input-bg': '#000000', 'tip-bg': '#030805', 'blue-hdr': '#0d2a17',
    line: '#12251a', 'line-2': '#1c3a27', axis: '#2b5139', text: '#d6ffe2', 'text-2': '#9fd8b1', muted: '#6a9a7a', link: '#7fe0ff',
    amber: '#39ff88', 'amber-2': '#8dffbb', 'amber-dim': '#1f7a45', up: '#39ff88', down: '#ff6b6b', flat: '#9fd8b1', 'seq-lo': '#0f2316',
  },
  'Midnight Blue': {
    ...AMBER, bg: '#060a14', bar: '#050914', panel: '#0c1324', 'hdr-1': '#16223d', 'hdr-2': '#111a31', 'panel-2': '#121c33', 'panel-3': '#1a2744', 'input-bg': '#050913', 'tip-bg': '#070c18', 'blue-hdr': '#1d3263',
    line: '#1a2540', 'line-2': '#26365a', axis: '#3a4d75', text: '#e6ecf7', 'text-2': '#aeb9cf', muted: '#7d89a3', link: '#8cc4ff',
    amber: '#4fc3f7', 'amber-2': '#9bdcfb', 'amber-dim': '#235f7c', 'heat-mid': '#232c40', 'div-mid': '#353b48', 'seq-lo': '#1a2744',
  },
  'Colorblind-safe': {
    ...AMBER, up: '#4aa3ff', down: '#ff9f1c', 'heat-up': '#1f6fc4', 'heat-down': '#c4651f', 'div-pos': '#3987e5', 'div-neg': '#d95926',
  },
  'High Contrast': {
    ...AMBER, bg: '#000000', bar: '#000000', panel: '#000000', 'hdr-1': '#1a1a1a', 'hdr-2': '#111111', 'panel-2': '#1a1a1a', 'panel-3': '#2a2a2a', 'blue-hdr': '#003a80',
    line: '#3a3a3a', 'line-2': '#5a5a5a', axis: '#7a7a7a', text: '#ffffff', 'text-2': '#e0e0e0', muted: '#b0b0b0', link: '#80c8ff',
    amber: '#ffb000', 'amber-2': '#ffd060', 'amber-dim': '#a06e00', up: '#3dff7a', down: '#ff5c5c',
  },
  'Paper (light)': {
    bg: '#f3f2ee', bar: '#e8e6e0', panel: '#fcfcfb', 'hdr-1': '#eeece6', 'hdr-2': '#e6e4dd', 'panel-2': '#f1f0ec', 'panel-3': '#e6e4de', 'input-bg': '#ffffff', 'tip-bg': '#ffffff', 'blue-hdr': '#dbe7f8',
    line: '#e1e0d9', 'line-2': '#c9c7bf', axis: '#a8a69d',
    text: '#0b0b0b', 'text-2': '#52514e', muted: '#6b6963', link: '#1c5cab',
    amber: '#b35900', 'amber-2': '#8f4700', 'amber-dim': '#d9a066', 'on-accent': '#ffffff',
    up: '#0a7a32', down: '#c62828', flat: '#52514e', warn: '#8a5d00',
    // light-surface steps darkened to clear 3:1 (validated: adjacent CVD ΔE ≥ 7.7, normal-vision ≥ 16.8)
    s1: '#2a78d6', s2: '#d9531e', s3: '#138a62', s4: '#a87400', s5: '#c94f80', s6: '#007a00', s7: '#6250d6', s8: '#d93a3a',
    'heat-up': '#1f8f4e', 'heat-down': '#c93a3a', 'heat-mid': '#8c8a84', 'heat-text': '#ffffff',
    'div-pos': '#2a78d6', 'div-mid': '#8c8a84', 'div-neg': '#d93a3a', 'seq-lo': '#cfd9e6', 'seq-hi': '#1c5cab',
  },
};

export const DEFAULT_THEME = { preset: 'Amber Terminal', vars: { ...AMBER }, fontSize: 12 };

// ---- contrast (WCAG 2.x) --------------------------------------------------------
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Returns { ratio, min, ok, against } for a variable in a theme, or null if not checked.
export function checkVar(vars, key) {
  const def = VARS.find((v) => v[1] === key);
  if (!def?.[3]) return null;
  if (def[3] === 'onaccent') {
    const r = contrast(vars[key], vars.amber);
    return { ratio: r, min: 4.5, ok: r >= 4.5, against: 'accent' };
  }
  if (def[3] === 'heat') {
    const r = Math.min(contrast(vars[key], vars['heat-up']), contrast(vars[key], vars['heat-down']), contrast(vars[key], vars['heat-mid']));
    return { ratio: r, min: 3, ok: r >= 3, against: 'heat tiles' };
  }
  const min = def[3] === 'text' ? 4.5 : 3;
  const r = contrast(vars[key], vars.panel);
  return { ratio: r, min, ok: r >= min, against: 'panel' };
}

// ---- apply ---------------------------------------------------------------------------
export function normalizeTheme(t) {
  // `base` = the preset a custom theme started from (used by per-color reset).
  const baseName = PRESETS[t?.base] ? t.base : PRESETS[t?.preset] ? t.preset : 'Amber Terminal';
  const vars = { ...PRESETS[baseName] };
  for (const [k, v] of Object.entries(t?.vars || {})) if (k in AMBER && /^#[0-9a-f]{6}$/i.test(v)) vars[k] = v.toLowerCase();
  const fontSize = Math.min(16, Math.max(10, Number(t?.fontSize) || 12));
  return { preset: t?.preset && PRESETS[t.preset] ? t.preset : 'Custom', base: baseName, vars, fontSize };
}

export function applyTheme(t) {
  const theme = normalizeTheme(t);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(`--${k}`, v);
  root.style.setProperty('--fs', `${theme.fontSize}px`);
  const light = lum(theme.vars.bg) > 0.4;
  root.style.colorScheme = light ? 'light' : 'dark';
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', light ? 'light' : 'dark');
  invalidateThemeCache();
  return theme;
}
