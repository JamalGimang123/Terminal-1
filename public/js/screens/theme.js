// THEME — customize every color of the terminal, with presets, contrast checks and a live preview.
import { h, panel, toast, downloadFile } from '../dom.js';
import { esc, price, pct, signed, displayTz, setDisplayTz, tzLabel } from '../fmt.js';
import { lineChart, columnChart, sparkline, perfColor, divergingColor, HEX } from '../charts.js';
import { state, update } from '../state.js';
import { VARS, PRESETS, DEFAULT_THEME, normalizeTheme, applyTheme, checkVar } from '../theme.js';

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
    const colorsP = panel({ title: 'Colors', bodyCls: 'flush' });
    const presetsP = panel({ title: 'Presets' });
    const displayP = panel({ title: 'Display' });
    const previewP = panel({ title: 'Preview' });
    const shareP = panel({ title: 'Save, share & reset' });
    left.append(colorsP.el);
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
        html += `<tr data-k="${key}"><td>${esc(label)}</td><td><input class="swatch-in" type="color" value="${theme.vars[key]}" aria-label="${esc(label)}"></td>
          <td><input class="in hex" value="${theme.vars[key]}" maxlength="7" style="width:84px" aria-label="${esc(label)} hex"></td><td>${badge}</td>
          <td class="r">${changed ? `<button class="btn sm" data-reset title="Back to ${esc(theme.base)} value">↺</button>` : ''}</td></tr>`;
      }
      tbl.innerHTML = html + '</tbody>';
      colorsP.body.innerHTML = '';
      colorsP.body.append(tbl);
      colorsP.setFoot('Tip: pick a preset first, then fine-tune. “low” means the color may be hard to read on its background.');
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
      // refresh badges & preview without rebuilding the inputs being edited
      clearTimeout(drawTimer);
      drawTimer = setTimeout(() => {
        refreshBadges();
        drawPreview();
        drawPresets();
      }, 120);
    });
    colorsP.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-reset]');
      if (!btn) return;
      const key = btn.closest('tr').dataset.k;
      const vars = { ...theme.vars, [key]: PRESETS[theme.base][key] };
      const same = Object.keys(vars).every((k) => vars[k] === PRESETS[theme.base][k]);
      set(vars, same ? theme.base : undefined);
      drawAll();
    });
    let drawTimer = null;
    function refreshBadges() {
      for (const tr of colorsP.body.querySelectorAll('tr[data-k]')) {
        const c = checkVar(theme.vars, tr.dataset.k);
        tr.children[3].innerHTML = c ? `<span class="cbadge ${c.ok ? 'ok' : 'low'}" title="vs ${esc(c.against)} — needs ${c.min}:1">${c.ratio.toFixed(1)}:1 ${c.ok ? '✓' : 'low'}</span>` : '';
      }
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
    }
    drawAll();
  },
};
