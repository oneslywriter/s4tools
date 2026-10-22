'use strict';
// Modulators, their routings and the Perform macros' routings, edited in the S-4's own format (values in
// S-4 units, s4params.js P.MOD). One editor serves the track modulators (per scene), the Mix and the Perform
// modulators.
//   modulatorN = { selected: type index, wave | random | follow | adsr: { param: { value, mode }, ...switches } }
//                ({} = the S-4's default type for the slot, at its defaults)
//   routings   = root[a][b][param][index] = { value: amount -1..1, mode: 0 bipolar | 1 unipolar }
//                (index: the modulator slot 0-3, or the macro 0-11 for macro routings)
(function (S4) {
  const h = S4.h, P = S4.params;
  const M = S4.mods = {};
  const V = (value, mode = '') => ({ value, mode });
  const r6 = x => Math.round(x * 1e6) / 1e6;
  M.TYPES = Object.keys(P.MOD); // WAVE RANDOM FOLLOW ADSR
  M.DEFAULT_SLOTS = ['RANDOM', 'RANDOM', 'WAVE', 'WAVE']; // the S-4's modulator per slot (manual)
  M.typeOf = (blk, slot) => {
    const t = blk && blk.selected != null ? M.TYPES.find(k => P.MOD[k].selected === blk.selected) : null;
    return t || M.DEFAULT_SLOTS[slot];
  };
  // a type's block at the S-4's defaults, in its key order
  function fresh(type) {
    const o = {};
    for (const sp of P.MOD[type].params) o[sp.key] = V(sp.def);
    if (type === 'WAVE') { o.shape = { value: 0 }; o.midi_trig = { value: 0 }; }
    if (type === 'RANDOM') { o.buffer = Array.from({ length: 32 }, () => r6(Math.random() * 2 - 1)); o.midi_trig = { value: 0 }; }
    if (type === 'FOLLOW') o.stereo_input = { value: 0 };
    return o;
  }
  // the values block of a live modulator block (made with the slot's type and defaults when needed)
  M.ensure = (blk, slot) => {
    const type = M.typeOf(blk, slot), key = P.MOD[type].key;
    if (blk.selected == null) blk.selected = P.MOD[type].selected;
    return blk[key] || (blk[key] = fresh(type));
  };

  // ---- routings ----
  M.routes = (root, idx) => {
    const out = [];
    for (const [a, A] of Object.entries(root || {})) {
      for (const [b, B] of Object.entries(A || {})) {
        for (const [p, X] of Object.entries(B || {})) if (X && X[idx]) out.push({ path: [a, b, p], value: X[idx].value, mode: X[idx].mode });
      }
    }
    return out;
  };
  M.setRoute = (root, path, idx, value, mode) => {
    let o = root;
    for (const k of path) o = o[k] || (o[k] = {});
    o[idx] = { value: r6(value), mode };
  };
  M.delRoute = (root, path, idx) => {
    const chain = [root];
    for (const k of path) chain.push(chain[chain.length - 1] && chain[chain.length - 1][k]);
    const leaf = chain[chain.length - 1];
    if (!leaf) return;
    delete leaf[idx];
    for (let i = path.length; i > 0 && !Object.keys(chain[i]).length; i--) delete chain[i - 1][path[i - 1]];
  };

  // ---- what can be routed to ----
  const MAT = {
    DISC: [['speed', 'SPEED'], ['tempo', 'TEMPO'], ['start', 'START'], ['length', 'LENGTH'], ['offset', 'OFFSET'], ['xfade', 'XFADE'],
      ['glide', 'GLIDE'], ['level', 'LEVEL'], ['sos', 'SOS'], ['density', 'DENSITY']],
    TAPE: [['speed', 'SPEED'], ['rotate', 'ROTATE'], ['length', 'LENGTH'], ['level', 'LEVEL'], ['sos', 'SOS'], ['xfade', 'XFADE']],
    POLY: [['pitch', 'PITCH'], ['start', 'START'], ['length', 'LENGTH'], ['level', 'LEVEL'], ['loop', 'LOOP'], ['xfade', 'XFADE'], ['attack', 'ATTACK'],
      ['decay', 'DECAY'], ['sustain', 'SUSTAIN'], ['curve', 'CURVE'], ['velocity', 'VELOCITY'], ['filter_amount', 'FLTR AMOUNT'], ['filter_shape', 'FLTR SHAPE']],
  };
  // a track's targets: its material's parameters, the effects, the sends and its modulators' values.
  // modType(n): the type in modulator slot n (1-4).
  M.trackTargets = (device, modType) => {
    const out = [];
    for (const [k, l] of MAT[device] || []) out.push({ group: device, path: ['material', device.toLowerCase(), k], label: `${device} ${l}` });
    for (const [dev, d] of Object.entries(P.DEV)) for (const sp of d.params) out.push({ group: dev, path: [d.slot, d.key, sp.key], label: `${dev} ${sp.label}` });
    for (let n = 1; n <= 4; n++) out.push({ group: 'SENDS', path: ['track_output', 'track_output', 'send' + n], label: `SEND TO T${n}` });
    for (let n = 1; n <= 4; n++) {
      const t = modType(n);
      for (const sp of P.MOD[t].params) out.push({ group: `MOD ${n}`, path: ['modulator' + n, P.MOD[t].key, sp.key], label: `MOD ${n} ${t} ${sp.label}` });
    }
    return out;
  };
  M.mixTargets = () => {
    const out = [];
    for (let t = 1; t <= 4; t++) {
      out.push({ group: `T${t}`, path: ['mix', 'mix', 'level' + t], label: `T${t} LEVEL` });
      out.push({ group: `T${t}`, path: ['mix', 'mix', 'pan' + t], label: `T${t} PAN` });
      out.push({ group: `T${t}`, path: ['mix', 'mix', 'cutoff' + t], label: `T${t} FILTER` });
    }
    out.push({ group: 'MAIN', path: ['mix', 'mix', 'compress_amount'], label: 'COMPRESSOR' });
    out.push({ group: 'MAIN', path: ['mix', 'mix', 'main_level'], label: 'MAIN LEVEL' });
    return out;
  };
  M.macroTargets = names => Array.from({ length: 8 }, (_, k) => ({ group: 'MACROS', path: ['perform', 'perform', 'macro' + (k + 1)], label: names(k) }));
  // a target's label; one not in the list (e.g. a modulator type that isn't in that slot in this scene) by its path
  const labelOf = (targets, path) => {
    const t = targets.find(x => x.path.join('.') === path.join('.'));
    if (t) return t.label;
    const name = s => String(s).replace(/_/g, ' ').toUpperCase();
    const mod = /^modulator(\d)$/.exec(path[0]);
    return mod ? `MOD ${mod[1]} ${name(path[1])} ${name(path[2])}` : `${name(path[1])} ${name(path[2])}`;
  };

  // ---- UI ----
  const modeChip = (sp, mode, onPick) => {
    const cur = P.modeOf(sp, mode);
    const b = h('button', { class: 'gridsel', title: `${sp.label} mode` }, cur ? cur.label : String(mode).toUpperCase());
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => {
      e.stopPropagation();
      S4.menu(b, sp.modes.map(x => ({ label: x.label, value: x.id, checked: x.id === mode, hint: x.curve || x.unit ? 'other units' : null })), onPick);
    });
    return h('span', null, b, ' ' + sp.label);
  };
  const routeMode = [{ label: 'UNI', value: 1 }, { label: 'BI', value: 0 }];
  // One routing per row: target, amount, unipolar / bipolar, remove.
  function routeRow(label, r, set, del) {
    return h('div', { class: 'mod-route' },
      h('span', { class: 'mr-t', title: label }, label),
      S4.fader({
        get: () => r.value, set: v => { r.value = v; set(r.value, r.mode); }, min: -1, max: 1, step: 0.002, def: 0, bi: true, label: '',
        fmt: v => (v > 0 ? '+' : '') + Math.round(v * 1000) / 10 + '%',
      }, { layout: 'row' }),
      S4.seg(routeMode, r.mode === 0 ? 0 : 1, v => { r.mode = v; set(r.value, r.mode); }, 'mini'),
      h('button', { class: 'ib sm', title: 'Remove', onclick: del }, S4.icon('x')));
  }
  // routes: { peek() -> root | null, edit() -> live root, targets() -> [{group, path, label}] }
  function routeList(routes, idx, changed, rerender, emptyNote) {
    const list = M.routes(routes.peek(), idx), targets = routes.targets();
    const add = h('button', { class: 'btn sm' }, S4.icon('plus'), 'Add a target');
    add.onclick = () => {
      const used = new Set(list.map(r => r.path.join('.')));
      const items = [];
      let g = null;
      for (const t of targets) {
        if (used.has(t.path.join('.'))) continue;
        if (t.group !== g) { items.push({ head: t.group }); g = t.group; }
        items.push({ label: t.label, value: t.path });
      }
      S4.menu(add, items, path => { M.setRoute(routes.edit(), path, idx, 0.5, 1); changed(); rerender(); });
    };
    return h('div', { class: 'mod-routes' },
      h('div', { class: 'mod-rh' }, h('span', { class: 'lbl' }, 'Goes to'), h('span', { class: 'sp' }), add),
      list.length ? list.map(r => routeRow(labelOf(targets, r.path), r,
        (v, m) => { M.setRoute(routes.edit(), r.path, idx, v, m); changed(); },
        () => { M.delRoute(routes.edit(), r.path, idx); changed(); rerender(); }))
        : h('div', { class: 'note' }, emptyNote || 'Nowhere yet.'));
  }
  M.routeList = routeList;

  /**
   * Editor for 4 modulator slots.
   * o: { sel: { n }, peek(n) -> block | null, edit(n) -> live block, routes, changed(), rerender(), note? }
   */
  M.editor = function (o) {
    const n = o.sel.n || 1;
    const blk = o.peek(n) || {}, type = M.typeOf(blk, n - 1), def = P.MOD[type];
    const vals = blk[def.key] || null;
    const modeOf = sp => (vals && vals[sp.key] && vals[sp.key].mode) || '';
    const valOf = sp => (vals && vals[sp.key] && typeof vals[sp.key].value === 'number' ? vals[sp.key].value : P.inMode(sp, modeOf(sp)).def);
    const live = () => M.ensure(o.edit(n), n - 1);
    const sw = key => !!(vals && vals[key] && vals[key].value);
    const toggle = (key, label, title) => h('button', {
      class: 'tb sm' + (sw(key) ? ' on' : ''), title,
      onclick: e => { const L = live(), v = !(L[key] && L[key].value); L[key] = { value: v ? 1 : 0 }; e.currentTarget.classList.toggle('on', v); o.changed(); },
    }, label);
    const extras = [];
    if (type === 'WAVE') {
      extras.push(S4.seg(['SINE', 'TRIANGLE', 'SQUARE'].map((l, i) => ({ label: l, value: i })), vals && vals.shape ? vals.shape.value : 0,
        v => { live().shape = { value: v }; o.changed(); }, 'mini'));
    }
    if (type === 'WAVE' || type === 'RANDOM') extras.push(toggle('midi_trig', 'MIDI TRIG', 'Starts over on each MIDI note'));
    if (type === 'FOLLOW') extras.push(toggle('stereo_input', 'STEREO', 'Follows left and right on their own'));
    const knobs = def.params.map(sp => {
      const mode = modeOf(sp), ms = P.inMode(sp, mode);
      return S4.knob(Object.assign(P.fader(ms, () => valOf(sp), v => {
        live()[sp.key] = V(ms.int ? Math.round(v) : r6(v), mode);
        o.changed();
      }), {
        label: sp.modes ? modeChip(sp, mode, id => {
          if (id === mode) return;
          live()[sp.key] = V(P.convert(sp, mode, id, valOf(sp)), id);
          o.changed();
          o.rerender();
        }) : sp.label,
      }));
    });
    return h('div', { class: 'mod-ed' },
      S4.seg([1, 2, 3, 4].map(k => ({ label: `MOD ${k}`, value: k })), n, v => { o.sel.n = v; o.rerender(); }, 'mini wide mod-slots'),
      h('div', { class: 'mod-top' },
        S4.seg(M.TYPES.map(t => ({ label: t, value: t })), type, v => {
          const b = o.edit(n);
          b.selected = P.MOD[v].selected;
          if (!b[P.MOD[v].key]) b[P.MOD[v].key] = fresh(v);
          o.changed();
          o.rerender();
        }, 'mini'),
        ...extras,
        o.note ? h('span', { class: 'lbl dimmer', title: o.note }, o.note) : null),
      h('div', { class: 'kgrid' }, knobs),
      routeList(o.routes, String(n - 1), o.changed, o.rerender));
  };
})(window.S4);
