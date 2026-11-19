// THEME — customize every color of the terminal: color wheel with harmonies, presets,
// contrast and color-blindness checks, and a live preview.
import { h, panel, toast, downloadFile } from '../dom.js';
import { esc, price, pct, signed, displayTz, setDisplayTz, tzLabel } from '../fmt.js';
import { lineChart, columnChart, sparkline, perfColor, divergingColor, HEX } from '../charts.js';
import { state, update } from '../state.js';
import { VARS, PRESETS, DEFAULT_THEME, normalizeTheme, applyTheme, checkVar } from '../theme.js';
import * as CL from '../lib/color.js';

const SERIES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const WHEEL = 240; // CSS px
const RAD = 110;
const MARKS = [...SERIES.map((k, i) => [k, String(i + 1)]), ['amber', 'A'], ['up', '+'], ['down', '−']];
const VISION = [['', 'Normal vision'], ['protan', 'Protanopia'], ['deutan', 'Deuteranopia']];

export default {
  id: 'cfg',
  title: 'Theme',
  async mount(root) {
    let theme = normalizeTheme(state().settings.theme || DEFAULT_THEME);
    let saveTimer = null;
    const persist = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => update((d) => (d.settings.theme = theme)), 300);
    };

    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'THEME · COLORS & DISPLAY'), h('span', { class: 'sub' }, 'Changes apply instantly across every screen and are saved on this computer')));
    const left = h('div', { class: 'stack-col c7' });
    const right = h('div', { class: 'stack-col c5' });
    root.append(h('div', { class: 'grid' }, left, right));
    const wheelP = panel({ title: 'Color wheel' });
    const colorsP = panel({ title: 'Colors', bodyCls: 'flush scroll h520' });
    const presetsP = panel({ title: 'Presets' });
    const displayP = panel({ title: 'Display' });
    const previewP = panel({ title: 'Preview' });
    const shareP = panel({ title: 'Save, share & reset' });
    left.append(wheelP.el, colorsP.el);
    right.append(presetsP.el, displayP.el, previewP.el, shareP.el);

    function set(vars, preset) {
      theme = normalizeTheme({ preset: preset ?? 'Custom', base: preset ?? theme.base, vars, fontSize: theme.fontSize });
      applyTheme(theme);
      persist();
    }

    // ---- presets ----
    function drawPresets() {
      presetsP.body.innerHTML = '';
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' } });
      for (const [name, v] of Object.entries(PRESETS)) {
        const strip = ['bg', 'panel', 'amber', 'text', 'up', 'down', 's1', 's2', 's3'].map((k) => `<i style="background:${v[k]}"></i>`).join('');
        grid.append(
          h('button', { class: `btn preset ${theme.preset === name ? 'on' : ''}`, onclick: () => {
            set({ ...v }, name);
            drawAll();
          } }, h('span', {}, name), h('span', { class: 'strip', html: strip })),
        );
      }
      presetsP.body.append(grid);
      presetsP.meta.textContent = theme.preset === 'Custom' ? `custom (based on ${theme.base})` : `using ${theme.preset}`;
    }

    // ---- color editors ----
    function drawColors() {
      const base = PRESETS[theme.base];
      const tbl = h('table', { class: 't compact' });
      let group = '';
      let html = '<thead><tr><th>Element</th><th>Color</th><th>Hex</th><th title="Contrast against what it sits on (WCAG): text needs 4.5:1, chart marks 3:1">Contrast</th><th></th></tr></thead><tbody>';
      for (const [g, key, label] of VARS) {
        if (g !== group) {
          group = g;
          html += `<tr class="tgroup"><td colspan="5">${esc(g)}</td></tr>`;
        }
        const c = checkVar(theme.vars, key);
        const badge = c ? `<span class="cbadge ${c.ok ? 'ok' : 'low'}" title="vs ${esc(c.against)} — needs ${c.min}:1">${c.ratio.toFixed(1)}:1 ${c.ok ? '✓' : 'low'}</span>` : '';
        const changed = theme.vars[key] !== base[key];
        html += `<tr data-k="${key}" class="${key === target ? 'sel' : ''}" style="cursor:pointer" title="Click to edit on the color wheel"><td>${esc(label)}</td><td><input class="swatch-in" type="color" value="${theme.vars[key]}" aria-label="${esc(label)}"></td>
          <td><input class="in hex" value="${theme.vars[key]}" maxlength="7" style="width:84px" aria-label="${esc(label)} hex"></td><td>${badge}</td>
          <td class="r">${changed ? `<button class="btn sm" data-reset title="Back to ${esc(theme.base)} value">↺</button>` : ''}</td></tr>`;
      }
      tbl.innerHTML = html + '</tbody>';
      colorsP.body.innerHTML = '';
      colorsP.body.append(tbl);
      colorsP.setFoot('Tip: pick a preset first, then fine-tune. Click a row to edit it on the color wheel. “low” means the color may be hard to read on its background.');
    }
    colorsP.body.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-k]');
      if (!tr) return;
      const key = tr.dataset.k;
      let v = e.target.value.trim();
      if (e.target.classList.contains('hex')) {
        if (!v.startsWith('#')) v = '#' + v;
        if (!/^#[0-9a-f]{6}$/i.test(v)) return;
        tr.querySelector('.swatch-in').value = v.toLowerCase();
      } else tr.querySelector('.hex').value = v;
      set({ ...theme.vars, [key]: v.toLowerCase() });
      if (key === target) syncWheel();
      else drawMarkers();
      scheduleRefresh();
    });
    colorsP.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-reset]');
      if (!btn) {
        const tr = e.target.closest('tr[data-k]');
        if (tr && !e.target.closest('input')) {
          setTarget(tr.dataset.k);
          wheelP.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      const key = btn.closest('tr').dataset.k;
      const vars = { ...theme.vars, [key]: PRESETS[theme.base][key] };
      const same = Object.keys(vars).every((k) => vars[k] === PRESETS[theme.base][k]);
      set(vars, same ? theme.base : undefined);
      drawAll();
    });
    let drawTimer = null;
    // Refresh badges, preview, presets and checks without rebuilding inputs being edited.
    function scheduleRefresh() {
      clearTimeout(drawTimer);
      drawTimer = setTimeout(() => {
        refreshBadges();
        drawPreview();
        drawPresets();
        drawHarmony();
        drawChecks();
      }, 120);
    }
    function refreshBadges() {
      for (const tr of colorsP.body.querySelectorAll('tr[data-k]')) {
        const c = checkVar(theme.vars, tr.dataset.k);
        tr.children[3].innerHTML = c ? `<span class="cbadge ${c.ok ? 'ok' : 'low'}" title="vs ${esc(c.against)} — needs ${c.min}:1">${c.ratio.toFixed(1)}:1 ${c.ok ? '✓' : 'low'}</span>` : '';
      }
    }

    // ---- color wheel ----
    let target = 'amber';
    let light = CL.hexToHsl(theme.vars[target])[2];
    let scheme = 'triadic';
    let tidy = true;
    let undo = null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = h('canvas', { width: WHEEL * dpr, height: WHEEL * dpr, style: { width: `${WHEEL}px`, height: `${WHEEL}px`, display: 'block' } });
    const overlay = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    const box = h('div', { class: 'cw-box', role: 'slider', 'aria-label': 'Color wheel: drag to pick hue (angle) and saturation (distance from center)', tabindex: '0' }, canvas, overlay);
    const targetSel = h('select', { class: 'in', 'aria-label': 'Color being edited' });
    {
      let og = null;
      let g = '';
      for (const [grp, key, label] of VARS) {
        if (grp !== g) {
          g = grp;
          og = h('optgroup', { label: grp });
          targetSel.append(og);
        }
        og.append(h('option', { value: key }, label));
      }
    }
    targetSel.value = target;
    targetSel.addEventListener('change', () => setTarget(targetSel.value));
    const bigSw = h('span', { class: 'cw-big' });
    const hexIn = h('input', { class: 'in hex', maxlength: '7', style: { width: '84px' }, 'aria-label': 'Hex value' });
    hexIn.addEventListener('input', () => {
      let v = hexIn.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (CL.isHex(v)) pick(v.toLowerCase(), true);
    });
    const lightIn = h('input', { type: 'range', min: '0', max: '100', step: '1', style: { flex: '1', minWidth: '120px' }, 'aria-label': 'Lightness' });
    const lightVal = h('b', { class: 'amber' });
    lightIn.addEventListener('input', () => {
      light = Number(lightIn.value) / 100;
      paintWheel();
      const [hh, ss] = CL.hexToHsl(theme.vars[target]);
      pick(CL.hslToHex(hh, ss, light));
    });
    const readout = h('div', { class: 'note' });
    const schemeSel = h('select', { class: 'in', 'aria-label': 'Harmony' }, ...Object.entries(CL.SCHEMES).map(([k, v]) => h('option', { value: k }, v.label)));
    schemeSel.value = scheme;
    schemeSel.addEventListener('change', () => {
      scheme = schemeSel.value;
      drawMarkers();
      drawHarmony();
    });
    const tidyIn = h('input', { type: 'checkbox', checked: true });
    tidyIn.addEventListener('change', () => {
      tidy = tidyIn.checked;
      drawHarmony();
    });
    const harmonyBox = h('div');
    const checkBox = h('div');
    wheelP.body.append(
      h('div', { class: 'cw-wrap' },
        box,
        h('div', { class: 'cw-side' },
          h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Editing'), targetSel),
          h('div', { class: 'row' }, bigSw, hexIn, readout),
          h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Lightness'), lightIn, lightVal),
          h('div', { class: 'note' }, 'Drag on the wheel: angle = hue, distance from the center = saturation. Numbered dots are chart series 1–8, A the accent, + / − up and down.'),
          h('div', { class: 'cw-sec' }, 'Harmony from this color'),
          h('div', { class: 'row' }, schemeSel, h('label', { class: 'row', style: { gap: '4px' }, title: 'Arrange the series so neighbours stay distinguishable, including for color-blind readers' }, tidyIn, h('span', {}, 'order for best distinctness'))),
          harmonyBox,
        ),
      ),
      checkBox,
    );

    function paintWheel() {
      const ctx = canvas.getContext('2d');
      const n = WHEEL * dpr;
      const c = n / 2;
      const r = RAD * dpr;
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x + 0.5 - c;
          const dy = y + 0.5 - c;
          const d = Math.hypot(dx, dy);
          if (d > r + 1) continue;
          const hue = (Math.atan2(dx, -dy) * 180) / Math.PI;
          const [R, G, B] = CL.hslToRgb(hue, Math.min(1, d / r), light);
          const i = (y * n + x) * 4;
          img.data[i] = R;
          img.data[i + 1] = G;
          img.data[i + 2] = B;
          img.data[i + 3] = Math.max(0, Math.min(1, r + 0.5 - d)) * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      lightIn.value = String(Math.round(light * 100));
      lightVal.textContent = `${Math.round(light * 100)}%`;
    }
    const posOf = (hex) => {
      const [hh, ss] = CL.hexToHsl(hex);
      const a = (hh * Math.PI) / 180;
      return [WHEEL / 2 + Math.sin(a) * ss * RAD, WHEEL / 2 - Math.cos(a) * ss * RAD];
    };
    function drawMarkers() {
      const c = WHEEL / 2;
      const [baseHue] = CL.hexToHsl(theme.vars[target]);
      const offs = CL.SCHEMES[scheme].offsets.slice(0, scheme === 'analogous' || scheme === 'even' ? 3 : 4);
      const spokes = offs.map((o) => {
        const a = ((baseHue + o) * Math.PI) / 180;
        return `<line x1="${c}" y1="${c}" x2="${c + Math.sin(a) * (RAD + 6)}" y2="${c - Math.cos(a) * (RAD + 6)}" stroke="var(--text)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      });
      const dots = MARKS.filter(([k]) => k !== target).map(([k, label]) => {
        const [x, y] = posOf(theme.vars[k]);
        return `<g><title>${esc(VARS.find((v) => v[1] === k)[2])} ${theme.vars[k]}</title><circle cx="${x}" cy="${y}" r="7.5" fill="${theme.vars[k]}" stroke="#000" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="7.5" fill="none" stroke="#fff" stroke-width="1"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9" font-weight="700" fill="${CL.contrast(theme.vars[k], '#000000') > 7 ? '#000' : '#fff'}">${label}</text></g>`;
      });
      const [tx, ty] = posOf(theme.vars[target]);
      overlay.innerHTML = `<svg width="${WHEEL}" height="${WHEEL}" viewBox="0 0 ${WHEEL} ${WHEEL}" aria-hidden="true">${spokes.join('')}${dots.join('')}
        <circle cx="${tx}" cy="${ty}" r="11" fill="${theme.vars[target]}" stroke="#000" stroke-width="4"/><circle cx="${tx}" cy="${ty}" r="11" fill="none" stroke="#fff" stroke-width="2"/></svg>`;
    }
    function syncWheel() {
      const hex = theme.vars[target];
      const [hh, ss, ll] = CL.hexToHsl(hex);
      if (Math.abs(ll - light) > 0.005) {
        light = ll;
        paintWheel();
      }
      bigSw.style.background = hex;
      if (document.activeElement !== hexIn) hexIn.value = hex;
      const c = checkVar(theme.vars, target);
      readout.innerHTML = `H ${Math.round(hh)}° · S ${Math.round(ss * 100)}% · L ${Math.round(ll * 100)}%${c ? ` · <span class="cbadge ${c.ok ? 'ok' : 'low'}" title="vs ${esc(c.against)} — needs ${c.min}:1">${c.ratio.toFixed(1)}:1 ${c.ok ? '✓' : 'low'}</span>` : ''}`;
      drawMarkers();
    }
    function setTarget(key) {
      target = key;
      targetSel.value = key;
      light = CL.hexToHsl(theme.vars[key])[2];
      paintWheel();
      syncWheel();
      for (const tr of colorsP.body.querySelectorAll('tr[data-k]')) tr.classList.toggle('sel', tr.dataset.k === key);
      drawHarmony();
    }
    // Set the target color (from the wheel, the slider or the hex box).
    function pick(hex, fromHexBox = false) {
      if (hex === theme.vars[target]) return;
      set({ ...theme.vars, [target]: hex });
      const tr = colorsP.body.querySelector(`tr[data-k="${target}"]`);
      if (tr) {
        tr.querySelector('.swatch-in').value = hex;
        tr.querySelector('.hex').value = hex;
      }
      if (!fromHexBox) hexIn.value = hex;
      syncWheel();
      scheduleRefresh();
    }
    let dragging = false;
    const fromPointer = (e) => {
      const r = box.getBoundingClientRect();
      const dx = e.clientX - r.left - WHEEL / 2;
      const dy = e.clientY - r.top - WHEEL / 2;
      const d = Math.hypot(dx, dy);
      if (!dragging && d > RAD + 4) return;
      const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      pick(CL.hslToHex(hue, Math.min(1, d / RAD), light));
    };
    box.addEventListener('pointerdown', (e) => {
      const r = box.getBoundingClientRect();
      if (Math.hypot(e.clientX - r.left - WHEEL / 2, e.clientY - r.top - WHEEL / 2) > RAD + 4) return;
      dragging = true;
      box.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    box.addEventListener('pointermove', (e) => dragging && fromPointer(e));
    box.addEventListener('pointerup', () => (dragging = false));
    box.addEventListener('pointercancel', () => (dragging = false));
    box.addEventListener('keydown', (e) => {
      // Arrow keys: ←/→ hue, ↑/↓ saturation.
      const [hh, ss] = CL.hexToHsl(theme.vars[target]);
      const step = e.shiftKey ? 10 : 2;
      const next = { ArrowLeft: [hh - step, ss], ArrowRight: [hh + step, ss], ArrowUp: [hh, Math.min(1, ss + step / 100)], ArrowDown: [hh, Math.max(0, ss - step / 100)] }[e.key];
      if (!next) return;
      e.preventDefault();
      pick(CL.hslToHex(next[0], next[1], light));
    });

    // Swatch rows: the palette as seen with normal vision and two kinds of color blindness.
    const strip = (colors) =>
      `<div class="cw-strip" style="grid-template-columns:96px repeat(${colors.length},1fr)">${VISION.map(([kind, label]) => `<span class="muted">${label}</span>${colors.map((c, i) => `<i style="background:${kind ? CL.simulateHex(c, kind) : c}" title="Series ${i + 1} ${c}">${kind ? '' : i + 1}</i>`).join('')}`).join('')}</div>`;
    const verdict = (r) => {
      const tag = { pass: ['ok', 'PASS'], warn: ['low', 'CHECK'], fail: ['bad', 'FAIL'] }[r.status];
      const nums = r.worstNormal ? ` · closest neighbours ΔE ${r.worstNormal.normal.toFixed(0)} normal / ${r.worstCvd.cvd.toFixed(0)} color-blind` : '';
      return `<div class="row" style="margin-top:4px"><span class="cbadge ${tag[0]}">${tag[1]}</span><span class="note" style="margin:0">${r.status === 'pass' ? 'Neighbouring series are easy to tell apart, also for color-blind readers, and clear 3:1 contrast' : esc(r.issues[0].text)}${nums}</span></div>`;
    };
    let proposal = [];
    function drawHarmony() {
      const base = theme.vars[target];
      proposal = CL.harmonyPalette(base, scheme, theme.vars.panel);
      if (tidy) proposal = CL.bestOrder(proposal);
      const r = CL.checkPalette(proposal, theme.vars.panel);
      harmonyBox.innerHTML = strip(proposal) + verdict(r);
      harmonyBox.append(
        h('div', { class: 'row', style: { marginTop: '6px' } },
          h('button', { class: 'btn primary', onclick: () => {
            undo = SERIES.map((k) => theme.vars[k]);
            const vars = { ...theme.vars };
            SERIES.forEach((k, i) => (vars[k] = proposal[i]));
            set(vars);
            drawAll();
            toast('Chart series updated — Undo is next to the button');
          } }, 'Apply to chart series 1–8'),
          undo ? h('button', { class: 'btn', onclick: () => {
            const vars = { ...theme.vars };
            SERIES.forEach((k, i) => (vars[k] = undo[i]));
            undo = null;
            set(vars);
            drawAll();
          } }, 'Undo') : null,
        ),
        h('div', { class: 'note' }, 'Series get the scheme’s hues at even perceived lightness, adjusted to stay readable on your panel color. Up/down and the accent are not changed.'),
      );
    }
    function drawChecks() {
      const cur = SERIES.map((k) => theme.vars[k]);
      const r = CL.checkPalette(cur, theme.vars.panel);
      const ud = [CL.deltaE(theme.vars.up, theme.vars.down), Math.min(CL.deltaE(theme.vars.up, theme.vars.down, 'protan'), CL.deltaE(theme.vars.up, theme.vars.down, 'deutan'))];
      checkBox.innerHTML = `<div class="cw-sec">Check: your current chart series</div>${strip(cur)}${verdict(r)}
        ${r.issues.length > 1 ? `<ul class="note" style="margin:4px 0 0 16px;padding:0">${r.issues.slice(1, 5).map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul>` : ''}
        <div class="row" style="margin-top:6px"><span class="muted">Up vs down</span><i class="cw-dot" style="background:${theme.vars.up}"></i><i class="cw-dot" style="background:${theme.vars.down}"></i>
        <span class="note" style="margin:0">ΔE ${ud[0].toFixed(0)} normal · ${ud[1].toFixed(0)} color-blind ${ud[1] >= CL.LIMITS.cvdTarget ? '<span class="cbadge ok">✓</span>' : '<span class="cbadge low" title="Gains and losses also show ▲/▼ and +/− signs">close</span> — the “Colorblind-safe” preset uses blue/orange'}</span></div>`;
      checkBox.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => {
        const best = CL.bestOrder(cur);
        if (best.every((c, i) => c === cur[i])) return toast('Already in the most distinguishable order');
        undo = cur;
        const vars = { ...theme.vars };
        SERIES.forEach((k, i) => (vars[k] = best[i]));
        set(vars);
        drawAll();
        toast('Series reordered for distinctness');
      } }, 'Reorder my series for best distinctness')));
      wheelP.setFoot('ΔE = color difference (OKLab ×100). Neighbouring series should be ≥ 15 apart for normal vision and ≥ 8 when simulated for protanopia/deuteranopia (Machado et al. 2009); marks need 3:1 contrast on the panel.');
    }

    // ---- display ----
    function drawDisplay() {
      const val = h('b', { class: 'amber' }, `${theme.fontSize}px`);
      const range = h('input', { type: 'range', min: '10', max: '16', step: '1', value: String(theme.fontSize), style: { width: '200px' }, 'aria-label': 'Base font size' });
      range.addEventListener('input', () => {
        theme.fontSize = Number(range.value);
        val.textContent = `${theme.fontSize}px`;
        applyTheme(theme);
        persist();
      });
      const tzSel = h('select', { class: 'in' }, ...[['America/New_York', 'New York (ET) — US market time'], ['Asia/Jakarta', 'Jakarta (WIB) — Indonesian market time'], ['local', "This computer's time zone"]].map(([v, l]) => h('option', { value: v, selected: displayTz === v }, l)));
      tzSel.addEventListener('change', () => {
        setDisplayTz(tzSel.value);
        update((d) => (d.settings.timeZone = tzSel.value));
        toast(`Timestamps now shown in ${tzLabel()}`);
      });
      displayP.body.innerHTML = '';
      displayP.body.append(
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Base font size'), range, val),
        h('div', { class: 'note' }, 'Default is 12px — the dense terminal look. Increase for readability.'),
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'muted' }, 'Timestamps'), tzSel),
        h('div', { class: 'note' }, 'Used for news times, quote times, intraday charts and calendars. The world clocks at the top always show each city.'),
      );
    }

    // ---- preview ----
    function drawPreview() {
      const rows = [
        ['BBCA.JK', 'Bank Central Asia', 5750, 250, 4.55],
        ['AAPL', 'Apple Inc.', 350.37, -2.41, -0.68],
        ['^JKSE', 'Jakarta Composite', 5247.88, -72.9, -1.37],
      ];
      const t = Array.from({ length: 60 }, (_, i) => i);
      const wave = (k, a) => t.map((i) => 100 + a * Math.sin(i / 7 + k) + i * 0.4 * (k - 1));
      previewP.body.innerHTML = `
        <table class="t compact"><thead><tr><th>Ticker</th><th>Name</th><th class="r">Last</th><th class="r">Chg</th><th class="r">%Chg</th><th class="r">Trend</th></tr></thead><tbody>
        ${rows.map(([s, n, p, c, cp], i) => `<tr class="${i === 1 ? 'sel' : ''}"><td class="sym">${s}</td><td class="nm">${n}</td><td class="r b">${price(p)}</td><td class="r ${c >= 0 ? 'up' : 'down'}">${signed(c)}</td><td class="r ${cp >= 0 ? 'up' : 'down'}">${cp >= 0 ? '▲' : '▼'} ${pct(cp)}</td><td class="r">${sparkline(wave(i, 3), { w: 60, h: 16 })}</td></tr>`).join('')}
        </tbody></table>
        <div class="row" style="margin:6px 0"><span class="tag live">REAL-TIME</span><span class="tag delayed">DELAYED</span><span class="tag amber">YOU HOLD 40</span><button class="btn">Button</button><button class="btn primary">Primary</button><a href="#/cfg">a link</a><span class="muted">muted text</span><span class="dim">secondary</span></div>
        <div class="heat" style="margin-bottom:6px">${[2.4, 0.6, 0, -0.9, -2.8].map((v) => `<div class="cell" style="background:${perfColor(v)};min-height:40px"><span class="a">${v > 0 ? 'Gain' : v < 0 ? 'Loss' : 'Flat'}</span><span class="p">${pct(v)}</span></div>`).join('')}</div>
        <div class="row" style="gap:2px;margin-bottom:6px">${[-1, -0.5, 0, 0.5, 1].map((v) => `<span class="heatcell" style="flex:1;text-align:center;padding:3px;background:${divergingColor(v)}">${v.toFixed(1)}</span>`).join('')}</div>`;
      const lc = h('div');
      const cc = h('div');
      previewP.body.append(lc, cc);
      lineChart(lc, { x: t, xType: 'number', xFmt: (v) => `d${v}`, series: [0, 1, 2].map((k) => ({ name: `Series ${k + 1}`, values: wave(k, 6), color: HEX[k] })), height: 150, yFmt: (v) => v.toFixed(0) });
      columnChart(cc, { labels: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], series: [{ name: 'Series colors', values: [8, 7, 6, 5, 4, 3, 2, 1], colors: HEX }], height: 110, yFmt: (v) => v.toFixed(0) });
    }

    // ---- share ----
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const t = JSON.parse(await f.text());
        theme = applyTheme(normalizeTheme(t));
        persist();
        drawAll();
        toast(`Loaded theme from ${f.name}`);
      } catch (err) {
        toast(`Could not read theme: ${err.message}`, true);
      }
    });
    shareP.body.append(
      fileIn,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => downloadFile('finterm-theme.json', JSON.stringify(theme, null, 2), 'application/json') }, 'Export theme'),
        h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import theme'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn danger', onclick: () => {
          theme = applyTheme(DEFAULT_THEME);
          persist();
          drawAll();
          toast('Theme reset to Amber Terminal');
        } }, 'Reset to default'),
      ),
      h('p', { class: 'note' }, 'Your theme is saved automatically with your portfolio data (data/user/portfolio.json) and in this browser.'),
    );

    function drawAll() {
      drawPresets();
      drawColors();
      drawDisplay();
      drawPreview();
      light = CL.hexToHsl(theme.vars[target])[2];
      paintWheel();
      syncWheel();
      drawHarmony();
      drawChecks();
    }
    drawAll();
  },
};
