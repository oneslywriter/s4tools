'use strict';
// Learn: teach s4tools a MIDI controller. Right-click a control > Learn from controller for one, or the header's
// Learn button for many in a row (click a control here, move one there). Learned controls live in Control maps.
(function (S4) {
  const h = S4.h;
  const MODES = [
    { value: 'abs', label: 'Absolute' },
    { value: 'rel1', label: 'Relative 1', hint: "2's complement" },
    { value: 'rel2', label: 'Relative 2', hint: 'offset 64' },
    { value: 'rel3', label: 'Relative 3', hint: 'sign bit' },
  ];

  const L = S4.listen = {
    active: false,
    target: null,
    pending: null,
    pick: {},
    ccHeld: {},
    data: Object.assign(
      { current: 'Default', presets: { Default: [] }, opts: { soft: true, playNotes: false, pc: true } },
      S4.store.get('mappings', {})),
  };
  if (!L.data.presets[L.data.current]) L.data.presets[L.data.current] = [];
  Object.defineProperty(L, 'maps', { get: () => L.data.presets[L.data.current] });

  const save = () => { S4.store.set('mappings', L.data); S4.emit('mappings'); L.refreshDecor(); };

  const srcLabel = s => `${s.type === 'cc' ? 'CC' : 'NOTE'} ${s.num} · CH ${s.ch}`;
  const sameSrc = (a, b) => a.type === b.type && a.ch === b.ch && a.num === b.num && (a.dev || '') === (b.dev || '');
  const decodeRel = (mode, v) => mode === 'rel1' ? (v < 64 ? v : v - 128) : mode === 'rel2' ? v - 64 : (v & 64 ? -(v & 63) : v & 63);

  // Guess the encoder type from the values seen while learning.
  function detectMode(vals) {
    if (vals.length < 3) return 'abs';
    let repeats = 0;
    for (let i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) repeats++;
    if (repeats < (vals.length - 1) * 0.5) return 'abs';
    if (vals.every(v => (v >= 1 && v <= 15) || v >= 113)) return 'rel1';
    if (vals.every(v => v >= 49 && v <= 79)) return 'rel2';
    if (vals.every(v => (v >= 1 && v <= 15) || (v >= 65 && v <= 79))) return 'rel3';
    return 'abs';
  }

  // ---------- learning ----------
  L.toggle = function (on) {
    L.active = on == null ? !L.active : on;
    if (!L.active) { L.target = null; L.once = false; if (L.pending) clearTimeout(L.pending.timer); L.pending = null; }
    document.body.classList.toggle('listening', L.active);
    renderBar();
    L.refreshDecor();
    S4.emit('listen', L.active);
  };

  // one control, straight away (right-click > Learn from controller); learning ends with it
  L.learnOne = function (id) {
    if (!L.active) L.toggle(true);
    L.once = true;
    L.select(id);
  };

  L.select = function (id) {
    L.target = id;
    renderBar();
    L.refreshDecor();
  };

  L.unmap = function (id) {
    const n = L.maps.length;
    L.data.presets[L.data.current] = L.maps.filter(m => m.target !== id);
    if (L.maps.length !== n) { save(); S4.toast(`${S4.ctl.info(id).label}: forgotten`); }
  };

  let decorQueued = false;
  L.refreshDecor = function () {
    if (decorQueued) return;
    decorQueued = true;
    // once the current render is done (a microtask, so a hidden page decorates too)
    Promise.resolve().then(() => { decorQueued = false; decorate(); });
  };
  function decorate() {
    const by = new Map();
    L.maps.forEach(m => { const a = by.get(m.target) || []; a.push(m); by.set(m.target, a); });
    document.querySelectorAll('[data-target]').forEach(el => {
      const ms = by.get(el.dataset.target);
      if (ms) el.dataset.map = ms.map(m => (m.src.type === 'cc' ? 'CC' : 'N') + m.src.num).join(' ');
      else delete el.dataset.map;
      el.classList.toggle('learn-sel', L.active && el.dataset.target === L.target);
      el.classList.toggle('learn-wait', !!(L.active && L.pending && el.dataset.target === L.pending.target));
    });
  }

  function renderBar() {
    const bar = document.getElementById('listenBar');
    if (!bar) return;
    bar.hidden = !L.active;
    bar.innerHTML = '';
    if (!L.active) return;
    const info = L.target ? S4.ctl.info(L.target) : null;
    const existing = L.target ? L.maps.filter(m => m.target === L.target) : [];
    bar.append(...[
      h('span', { class: 'lb-dot' }),
      h('span', { class: 'lb-text' }, L.target
        ? ['Move a knob or press a pad on your controller for ', h('b', null, info.label)]
        : 'Click something here, then move a knob or press a pad on your controller. Esc when you are done.'),
      existing.length ? h('span', { class: 'lb-cur' }, 'now: ' + existing.map(m => srcLabel(m.src)).join(', ')) : null,
      h('span', { class: 'sp' }),
      existing.length ? S4.btn('Forget', () => { L.unmap(L.target); renderBar(); }, 'sm') : null,
      S4.btn(L.once ? 'Cancel' : 'Done', () => L.toggle(false), 'sm'),
    ].filter(Boolean));
  }

  // ---------- incoming controller MIDI ----------
  S4.on('ctrl-midi', (port, d) => {
    const s = d[0] & 0xF0, ch = (d[0] & 15) + 1;
    let type, num, val, on;
    if (s === 0xB0) { type = 'cc'; num = d[1]; val = d[2]; }
    else if (s === 0x90 && d[2] > 0) { type = 'note'; num = d[1]; val = d[2]; on = true; }
    else if (s === 0x80 || s === 0x90) { type = 'note'; num = d[1]; val = 0; on = false; }
    else if (s === 0xC0) { if (L.data.opts.pc) S4.ctl.launch(d[1] + 1); return; }
    else return;

    const ms = L.maps.filter(m => m.src.type === type && m.src.ch === ch && m.src.num === num && (!m.src.dev || m.src.dev === port.name));
    if (L.active && L.target) {
      // Already learned for this control: let it play the target so the mapping can be heard (learning one
      // control from its right-click menu learns it again instead, so that ends as expected).
      const done = !L.once && ms.find(m => m.target === L.target);
      if (done && !(L.pending && L.pending.key === port.name + '|' + ch + '|' + num)) { apply(done, type, val, on); return; }
      if (type === 'note') { if (on) commit({ type, ch, num, dev: port.name }, L.target, 'abs'); return; }
      learnCC(port, ch, num, val);
      return;
    }
    if (!ms.length) {
      if (type === 'note' && L.data.opts.playNotes) {
        const tch = S4.state.sel.track + 1;
        if (on) S4.midi.noteOn(tch, num, val); else S4.midi.noteOff(tch, num);
      }
      return;
    }
    ms.forEach(m => apply(m, type, val, on));
  });

  function learnCC(port, ch, num, val) {
    const key = port.name + '|' + ch + '|' + num;
    if (!L.pending || L.pending.key !== key) {
      if (L.pending) clearTimeout(L.pending.timer);
      L.pending = { key, src: { type: 'cc', ch, num, dev: port.name }, target: L.target, vals: [], t0: performance.now() };
      // Decide after ~0.45 s, but wait up to 1.5 s for a few values so a
      // slowly turned endless encoder is not mistaken for an absolute knob.
      const decide = () => {
        const p = L.pending;
        if (!p) return;
        if (p.vals.length < 4 && performance.now() - p.t0 < 1500) { p.timer = setTimeout(decide, 150); return; }
        L.pending = null;
        commit(p.src, p.target, detectMode(p.vals));
      };
      L.pending.timer = setTimeout(decide, 450);
      L.refreshDecor();
    }
    L.pending.vals.push(val);
  }

  function commit(src, target, mode) {
    const info = S4.ctl.info(target);
    L.data.presets[L.data.current] = L.maps.filter(m => m.target !== target && !sameSrc(m.src, src));
    const m = { id: S4.uid(), src, target, mode, inv: false, min: 0, max: 127, btn: 'toggle' };
    L.maps.push(m);
    save();
    if (L.once) L.toggle(false); else renderBar();
    S4.toast(`${srcLabel(src)} now moves ${info.label}` + (mode !== 'abs' ? ` (${MODES.find(x => x.value === mode).label.toLowerCase()})` : ''));
  }

  function apply(m, type, val, on) {
    const info = S4.ctl.info(m.target);
    const lo = Math.min(m.min, m.max), hi = Math.max(m.min, m.max);
    if (info.kind === 'cont') {
      const cur = S4.ctl.get(m.target);
      const src = 'map:' + m.id;
      if (type === 'note') {
        if (m.btn === 'gate') S4.ctl.set(m.target, on ? (m.inv ? lo : hi) : (m.inv ? hi : lo), { src });
        else if (on) S4.ctl.set(m.target, cur >= (lo + hi) / 2 ? lo : hi, { src });
        return;
      }
      if (m.mode === 'abs') {
        const x = m.inv ? 127 - val : val;
        const v = Math.round(lo + ((hi - lo) * x) / 127);
        if (L.data.opts.soft) {
          const ps = L.pick[m.id] || (L.pick[m.id] = { picked: false, last: null });
          if (!ps.picked) {
            const crossed = ps.last != null && ((ps.last <= cur && v >= cur) || (ps.last >= cur && v <= cur));
            ps.last = v;
            if (Math.abs(v - cur) > 2 && !crossed) { catchHint(m.target, v, cur); return; }
            ps.picked = true;
          }
        }
        S4.ctl.set(m.target, v, { src });
      } else {
        const d = decodeRel(m.mode, val) * (m.inv ? -1 : 1);
        S4.ctl.set(m.target, S4.clamp(cur + d, lo, hi), { src });
      }
      return;
    }
    // button targets
    let pressed = on;
    if (type === 'cc') {
      pressed = val >= 64;
      if (m.btn !== 'gate' && pressed === !!L.ccHeld[m.id]) return;
      L.ccHeld[m.id] = pressed;
    }
    if (m.btn === 'gate' && info.toggle) S4.ctl.press(m.target, pressed, { gate: true });
    else S4.ctl.press(m.target, pressed);
  }

  // Catch: a learned knob lets go whenever its target moves from somewhere else, and takes over again once it
  // reaches the value.
  S4.on('val', (id, src) => {
    if (typeof src === 'string' && src.startsWith('map:')) return;
    L.maps.forEach(m => { if (m.target === id && L.pick[m.id]) L.pick[m.id].picked = false; });
  });

  let hintTimer;
  function catchHint(target, v, cur) {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => S4.toast(`Catch: turn the knob to ${cur} to take over ${S4.ctl.info(target).label} (it is at ${v})`), 60);
  }

  // right-click any control: learn it, forget it, or open Control maps
  document.addEventListener('contextmenu', e => {
    const el = e.target.closest('[data-target]');
    if (!el || el.closest('.modal-back, .menu, .pop, #listenBar')) return;
    e.preventDefault();
    const id = el.dataset.target, ms = L.maps.filter(m => m.target === id);
    S4.menu(el, [
      { head: S4.ctl.info(id).label },
      { label: 'Learn from controller', hint: ms.length ? 'replaces ' + srcLabel(ms[0].src) : '', action: () => L.learnOne(id) },
      ms.length ? { label: 'Forget ' + ms.map(m => srcLabel(m.src)).join(', '), danger: true, action: () => L.unmap(id) } : null,
      { sep: true },
      { label: 'Control maps…', action: () => L.openPanel() },
    ].filter(Boolean));
  });

  // ---------- clicks pick the control while learning ----------
  function mappable(e) {
    if (!L.active) return null;
    const el = e.target.closest('[data-target]');
    if (!el || el.closest('.modal-back, .menu, #listenBar')) return null;
    return el;
  }
  document.addEventListener('pointerdown', e => {
    const el = mappable(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    L.select(el.dataset.target);
  }, true);
  document.addEventListener('click', e => { if (mappable(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('dblclick', e => { if (mappable(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('keydown', e => {
    if (!L.active) return;
    if (e.key === 'Escape' && !document.querySelector('.modal-back, .menu')) { L.toggle(false); e.preventDefault(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && L.target && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      L.unmap(L.target); renderBar(); e.preventDefault();
    }
  }, true);
  S4.on('mappings', renderBar);

  // ---------- control maps: named sets of learned controls (stored as "presets") ----------
  L.presetMenu = function (anchor) {
    const names = Object.keys(L.data.presets);
    S4.menu(anchor, [
      { head: 'Control maps' },
      ...names.map(n => ({ label: n, checked: n === L.data.current, hint: String(L.data.presets[n].length), action: () => { L.data.current = n; L.pick = {}; save(); } })),
      { sep: true },
      { label: 'Edit this map…', action: () => L.openPanel() },
      { label: 'New map…', action: () => newPreset(false) },
      { label: 'Copy this map…', action: () => newPreset(true) },
      { label: 'Rename…', action: renamePreset },
      { label: 'Delete', disabled: names.length < 2, danger: true, action: deletePreset },
      { sep: true },
      { label: 'Save maps to a file', action: exportPresets },
      { label: 'Load maps from a file…', action: importPresets },
    ]);
  };
  function newPreset(dup) {
    const name = (prompt(dup ? 'Name of the copy:' : 'Name of the new map:', dup ? L.data.current + ' copy' : 'My controller') || '').trim();
    if (!name) return;
    if (L.data.presets[name]) return S4.toast('There is already a map with that name', 'err');
    L.data.presets[name] = dup ? JSON.parse(JSON.stringify(L.maps)).map(m => Object.assign(m, { id: S4.uid() })) : [];
    L.data.current = name;
    save();
  }
  function renamePreset() {
    const old = L.data.current;
    const name = (prompt('New name for this map:', old) || '').trim();
    if (!name || name === old) return;
    if (L.data.presets[name]) return S4.toast('There is already a map with that name', 'err');
    L.data.presets[name] = L.data.presets[old];
    delete L.data.presets[old];
    L.data.current = name;
    save();
  }
  function deletePreset() {
    const names = Object.keys(L.data.presets);
    if (names.length < 2 || !confirm(`Delete the map "${L.data.current}"?`)) return;
    delete L.data.presets[L.data.current];
    L.data.current = Object.keys(L.data.presets)[0];
    save();
  }
  function exportPresets() {
    const blob = new Blob([JSON.stringify({ format: 's4tools-mappings', version: 1, presets: L.data.presets, opts: L.data.opts }, null, 2)], { type: 'application/json' });
    S4.download(blob, 's4tools-control-maps.json');
  }
  async function importPresets() {
    const [file] = await S4.pickFiles({ accept: '.json,application/json' });
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!j.presets) throw new Error('there are no maps in that file');
      let n = 0;
      for (const [name, maps] of Object.entries(j.presets)) {
        let nm = name;
        while (L.data.presets[nm]) nm += ' (imported)';
        L.data.presets[nm] = maps;
        n++;
      }
      save();
      S4.toast(`${n} map${n === 1 ? '' : 's'} loaded`);
    } catch (e) {
      S4.toast('Nothing loaded: ' + e.message, 'err');
    }
  }

  // ---------- the Control maps panel ----------
  L.openPanel = function () {
    const body = h('div', { class: 'maps' });
    const render = () => {
      body.innerHTML = '';
      const list = h('div', { class: 'map-list' });
      if (!L.maps.length) list.append(h('div', { class: 'map-empty' }, 'Nothing learned in this map yet. Right-click a control in Live and choose Learn from controller, then move a knob on your controller.'));
      L.maps.forEach(m => list.append(row(m)));
      body.append(
        h('div', { class: 'map-presets' },
          h('span', { class: 'lbl' }, 'Map'),
          h('button', { class: 'btn sm', onclick: e => L.presetMenu(e.currentTarget) }, L.data.current, S4.icon('chev')),
          h('span', { class: 'sp' }),
          h('span', { class: 'dim' }, `${L.maps.length} learned control${L.maps.length === 1 ? '' : 's'}`)),
        list,
        h('div', { class: 'map-opts' },
          h('div', { class: 'map-opts-head' },
            h('span', { class: 'lbl' }, 'How learned controls behave'),
            h('span', { class: 'sp' }),
            h('button', { class: 'btn sm danger', disabled: !L.maps.length || null, onclick: () => { if (confirm('Forget every control in this map?')) { L.data.presets[L.data.current] = []; save(); } } }, 'Forget all')),
          opt('Catch', 'A knob only takes over once it reaches the value on screen, so nothing jumps.', 'soft'),
          opt('Play notes on the S-4', 'Keys and pads that aren\'t learned play the track picked on screen (handy for POLY).', 'playNotes'),
          opt('Scenes from program changes', 'A program change from your controller picks the S-4\'s scene: program 1 is scene 1.', 'pc')));
    };
    const opt = (title, desc, key) => h('div', { class: 'map-opt' },
      h('div', null, h('div', { class: 'mo-title' }, title), h('div', { class: 'mo-desc' }, desc)),
      S4.onoff(L.data.opts[key], v => { L.data.opts[key] = v; save(); }));

    const row = m => {
      const info = S4.ctl.info(m.target);
      const cont = info.kind === 'cont';
      const upd = () => { save(); };
      const ctrls = h('div', { class: 'map-ctrls' });
      if (m.src.type === 'cc' && cont) {
        const modeBtn = h('button', { class: 'btn sm mode', onclick: e => S4.menu(e.currentTarget, MODES.map(x => ({ label: x.label, hint: x.hint, checked: x.value === m.mode, value: x.value })), v => { m.mode = v; upd(); render(); }) },
          MODES.find(x => x.value === m.mode).label, S4.icon('chev'));
        ctrls.append(modeBtn);
      } else {
        ctrls.append(S4.seg([{ label: 'Toggle', value: 'toggle' }, { label: 'Hold', value: 'gate' }], m.btn, v => { m.btn = v; upd(); }, 'mini'));
      }
      if (cont) {
        const inv = h('button', { class: 'btn sm inv' + (m.inv ? ' on' : ''), title: 'Turn the other way', onclick: () => { m.inv = !m.inv; inv.classList.toggle('on', m.inv); upd(); } }, 'Invert');
        ctrls.append(inv, rangeBar(m, upd));
      }
      return h('div', { class: 'map-row' },
        h('div', { class: 'map-src' }, h('div', { class: 'ms-main' }, srcLabel(m.src)), h('div', { class: 'ms-dev' }, m.src.dev || 'any controller')),
        h('span', { class: 'map-arrow' }, '→'),
        h('div', { class: 'map-tgt' }, info.label),
        ctrls,
        h('button', { class: 'ib', title: 'Forget', onclick: () => { L.data.presets[L.data.current] = L.maps.filter(x => x !== m); save(); render(); } }, S4.icon('x')));
    };

    const off = S4.on('mappings', render);
    render();
    S4.modal('Control maps', body, { cls: 'wide', onClose: off });
  };

  // Two-handle range (min..max) for a mapping.
  function rangeBar(m, onChange) {
    const fill = h('div', { class: 'rb-fill' });
    const txt = h('span', { class: 'rb-txt' });
    const bar = h('div', { class: 'rb-bar' }, fill);
    const el = h('div', { class: 'rangebar', title: 'How far it reaches: drag either end, double-click for all of it' }, txt, bar);
    const upd = () => {
      const a = Math.min(m.min, m.max), b = Math.max(m.min, m.max);
      fill.style.left = (a / 127) * 100 + '%';
      fill.style.width = ((b - a) / 127) * 100 + '%';
      txt.textContent = a === 0 && b === 127 ? 'all' : `${a}–${b}`;
    };
    bar.addEventListener('pointerdown', e => {
      const r = bar.getBoundingClientRect();
      const at = x => S4.clamp(Math.round(((x - r.left) / r.width) * 127), 0, 127);
      const v = at(e.clientX);
      const key = Math.abs(v - m.min) <= Math.abs(v - m.max) ? 'min' : 'max';
      m[key] = v; upd();
      S4.capture(bar, e.pointerId);
      const move = ev => { m[key] = at(ev.clientX); upd(); };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); onChange(); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => { m.min = 0; m.max = 127; upd(); onChange(); });
    upd();
    return el;
  }
})(window.S4);
