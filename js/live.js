'use strict';
// Live: the four tracks as lanes, a tile per device with a skyline of its values; the inspector on the right holds
// the knobs of the picked tile, or the macros. Everything goes through S4.ctl, so Learn and MIDI follow along.
(function (S4) {
  const h = S4.h;
  const st = S4.state;
  let topEl, lanesEl, inspEl, sceneNo, macBtn;
  let macros = false;           // the inspector shows the macros instead of a device
  const bars = new Map();       // control id -> its skyline bar
  const SHORT = { WAVE: 'WAVE', RANDOM: 'RND', ADSR: 'ADSR', FOLLOW: 'FLW' };

  S4.live = {
    mount(el) {
      el.append(h('div', { class: 'lv' },
        topEl = h('div', { class: 'lv-top' }),
        lanesEl = h('div', { class: 'lv-lanes' }),
        inspEl = h('aside', { class: 'lv-insp' }),
        h('div', { class: 'lv-bottom' }, S4.rec.bar())));
      renderTop();
      renderAll();
      S4.on('sel', () => { macros = false; renderAll(); });
      S4.on('device', renderAll);
      S4.on('bypass', renderAll);
      S4.on('mutes', () => lanesEl.querySelectorAll('.lane').forEach((l, t) => l.classList.toggle('muted', S4.ctl.effectiveMuted(t))));
      S4.on('scene', showScene);
      S4.on('val', id => { const b = bars.get(id); if (b) b.style.height = barH(id); });
    },
  };

  const barH = id => 6 + (S4.ctl.get(id) / 127) * 94 + '%';
  const renderAll = () => { renderLanes(); renderInsp(); };

  // ---------- top row: scene, master, macros ----------
  function renderTop() {
    const nav = (id, icon, title) => {
      const b = h('button', { class: 'ib', 'data-target': id, title }, S4.icon(icon));
      b.addEventListener('click', () => S4.ctl.press(id, true));
      return b;
    };
    const pick = h('button', { class: 'scn-btn', title: 'Pick one of the 128 scenes' }, h('span', { class: 'lbl' }, 'Scene'), sceneNo = h('span', { class: 'scn-no' }), S4.icon('chev'));
    pick.addEventListener('click', () => scenePads(pick));
    macBtn = h('button', { class: 'btn', title: 'Show the twelve macros in the inspector', onclick: () => { macros = !macros; renderAll(); } }, 'Macros');
    topEl.append(
      h('div', { class: 'scn-box' }, nav('scene.prev', 'prev', 'Previous scene'), pick, nav('scene.next', 'next', 'Next scene')),
      h('div', { class: 'lv-master' }, h('span', { class: 'lbl' }, 'Master'),
        S4.knob(S4.ctlModel('master.main'), { size: 'inline' }),
        S4.knob(S4.ctlModel('master.comp'), { size: 'inline' })),
      h('span', { class: 'sp' }),
      macBtn);
    showScene();
  }
  function showScene() { sceneNo.textContent = S4.pad3(st.scene); }

  function scenePads(anchor) {
    const grid = h('div', { class: 'padgrid' });
    for (let n = 1; n <= 128; n++) {
      const p = h('button', { class: 'pad', 'data-target': 'scene.' + n, title: `Scene ${n}: program change ${n - 1}` }, n);
      p._update = () => p.classList.toggle('cur', st.scene === n);
      p.addEventListener('click', () => S4.ctl.press('scene.' + n, true));
      p._update();
      grid.append(p);
    }
    S4.popover(anchor, h('div', { class: 'scn-pop' }, grid));
    S4.listen.refreshDecor();
  }

  // ---------- lanes ----------
  function renderLanes() {
    lanesEl.innerHTML = '';
    bars.clear();
    st.tracks.forEach((tr, t) => lanesEl.append(lane(t)));
    macBtn.classList.toggle('on', macros);
    S4.listen.refreshDecor();
  }

  function lane(t) {
    const n = t + 1;
    return h('div', { class: `lane tc${t}` + (S4.ctl.effectiveMuted(t) ? ' muted' : '') },
      h('div', { class: 'lane-head' },
        h('button', { class: 'lane-name', title: `Track ${n} (key ${n})`, onclick: () => S4.ctl.select(t) }, 'T' + n),
        h('div', { class: 'lane-btns' },
          S4.tbutton(`btn.mute.${t}`, 'M', { cls: 'sq', title: `Mute track ${n}` }),
          S4.tbutton(`btn.solo.${t}`, 'S', { cls: 'sq', title: `Solo track ${n}` })),
        h('div', { class: 'lane-btns' },
          S4.tbutton(`btn.tplay.${t}`, S4.icon('play'), { cls: 'sq', title: `Start or stop track ${n} by itself` }),
          S4.tbutton(`btn.trec.${t}`, h('i', { class: 'dot' }), { cls: 'sq trec', title: `Record into track ${n}. The S-4 records only while it plays.` }),
          S4.tbutton(`btn.mon.${t}`, S4.icon('mon'), { cls: 'sq', title: `Monitor: track ${n} lets its input through` }))),
      h('div', { class: 'tiles' }, S4.SLOTS.map(s => tile(t, s)), modTile(t)),
      h('div', { class: 'lane-mix' }, ['lvl', 'pan', 'fltr'].map(k => S4.knob(S4.ctlModel(`mix.${k}.${t}`), { size: 'sm' }))));
  }

  function skyline(ids) {
    const sky = h('div', { class: 'sky' });
    ids.forEach(id => { const b = h('i'); b.style.height = barH(id); bars.set(id, b); sky.append(b); });
    return sky;
  }

  function tile(t, slot) {
    const dev = st.tracks[t].devices[slot.id], ids = S4.ctl.paramIds(t, slot.id);
    const off = S4.ctl.isBypassed(t, slot.id);
    const sel = !macros && st.sel.mod < 0 && st.sel.track === t && st.sel.slot === slot.id;
    return h('button', { class: 'tile' + (sel ? ' sel' : '') + (off || !dev ? ' off' : ''), onclick: () => S4.ctl.select(t, slot.id) },
      h('span', { class: 'tile-slot' }, slot.label),
      h('span', { class: 'tile-dev' }, dev || 'Empty', off ? h('span', { class: 'tag-off' }, 'OFF') : null),
      ids.length ? skyline(ids) : h('span', { class: 'sky-note' }, dev === 'BYPASS' ? 'live input' : 'not set'));
  }

  // the modulators' tile: one bar per modulator, its AMOUNT (or its second knob)
  function modTile(t) {
    const tr = st.tracks[t];
    const sel = !macros && st.sel.mod >= 0 && st.sel.track === t;
    const ids = [0, 1, 2, 3].map(m => {
      const i = S4.MOD_TYPES[tr.modTypes[m]].indexOf('AMOUNT');
      return `mod.${t}.${S4.modCC(m, i < 0 ? 1 : i)}`;
    });
    return h('button', {
      class: 'tile' + (sel ? ' sel' : ''),
      title: tr.modTypes.map((k, m) => `MOD ${m + 1}: ${k}`).join('\n'),
      onclick: () => S4.ctl.select(t, null, st.sel.track === t && st.sel.mod >= 0 ? st.sel.mod : 0),
    }, h('span', { class: 'tile-slot' }, 'MODS'), h('span', { class: 'tile-dev' }, tr.modTypes.map(k => SHORT[k] || k).join(' ')), skyline(ids));
  }

  // ---------- inspector ----------
  function renderInsp() {
    inspEl.innerHTML = '';
    const { track: t, slot, mod } = st.sel;
    inspEl.className = 'lv-insp' + (macros ? '' : ' tc' + t);
    if (macros) macroInsp();
    else if (mod >= 0) modInsp(t, mod);
    else devInsp(t, slot);
    S4.listen.refreshDecor();
  }

  const head = (over, name, ...tools) => h('div', { class: 'insp-head' },
    h('div', { class: 'insp-title' }, h('span', { class: 'lbl' }, over), name),
    h('span', { class: 'sp' }),
    h('div', { class: 'insp-tools' }, tools));
  const resetBtn = (ids, what) => h('button', { class: 'ib', title: 'Back to the defaults', onclick: () => { S4.ctl.reset(ids); S4.toast(`${what}: defaults`); } }, S4.icon('reset'));
  const rollBtn = ids => h('button', { class: 'ib', title: 'Roll random values (levels stay where they are)', onclick: () => S4.ctl.randomize(ids) }, S4.icon('random'));
  const knobs = ids => h('div', { class: 'kgrid' }, ids.map(id => S4.knob(S4.ctlModel(id))));
  const foot = txt => h('div', { class: 'insp-foot' }, txt);

  function devInsp(t, slot) {
    const dev = st.tracks[t].devices[slot], s = S4.SLOTS.find(x => x.id === slot);
    const ids = S4.ctl.paramIds(t, slot), off = S4.ctl.isBypassed(t, slot);
    const pick = h('button', { class: 'insp-dev', title: 'Set this to the device your S-4 has in the slot' }, dev || 'Empty', S4.icon('chev'));
    pick.addEventListener('click', () => S4.menu(pick, [
      { head: s.label },
      ...s.devices.map(d => ({ label: d, checked: d === dev, value: d })),
      { label: 'Empty', checked: !dev, value: null },
    ], v => S4.ctl.setDevice(t, slot, v)));
    const offBtn = S4.DEVICES[dev] ? h('button', {
      class: 'ib' + (off ? ' on' : ''),
      title: off ? 'Switch it back on: the wet / level returns' : 'Switch it off: its wet / level goes to zero until you switch it back',
      onclick: () => S4.ctl.toggleBypass(t, slot),
    }, S4.icon('bypass')) : null;
    let body;
    if (ids.length) body = knobs(ids);
    else if (dev === 'BYPASS') body = h('p', { class: 'note insp-note' }, 'BYPASS sends the track\'s input (or its USB audio) straight on to the effects. There is nothing to turn here.');
    else body = h('p', { class: 'note insp-note' }, `Nothing set for ${s.label}. Click the name above and choose the device your S-4 has here.`);
    inspEl.append(
      head(`Track ${t + 1} · ${s.label}`, pick, offBtn, ids.length ? resetBtn(ids, dev) : null, ids.length ? rollBtn(ids) : null),
      h('div', { class: 'insp-body' + (off ? ' off' : '') },
        off ? h('p', { class: 'note insp-note' }, 'Switched off. Its wet / level is at zero.') : null,
        body,
        foot(`MIDI channel ${t + 1}`)));
  }

  function modInsp(t, m) {
    const tr = st.tracks[t], ids = S4.ctl.modIds(t, m);
    const type = h('button', { class: 'insp-dev', title: 'Set this to the type your S-4 uses here' }, tr.modTypes[m], S4.icon('chev'));
    type.addEventListener('click', () => S4.menu(type, Object.keys(S4.MOD_TYPES).map(k => ({ label: k, checked: k === tr.modTypes[m], value: k })), v => {
      tr.modTypes[m] = v;
      S4.saveState();
      renderAll();
    }));
    inspEl.append(
      head(`Track ${t + 1} · Modulator`, type, resetBtn(ids, 'MOD ' + (m + 1)), rollBtn(ids)),
      h('div', { class: 'insp-tabs' }, S4.seg([0, 1, 2, 3].map(i => ({ label: 'MOD ' + (i + 1), value: i })), m, v => S4.ctl.select(t, null, v), 'mini wide')),
      h('div', { class: 'insp-body' }, knobs(ids), foot(`MIDI channel ${t + 1} · CC ${S4.modCC(m, 0)}–${S4.modCC(m, 7)}`)));
  }

  function macroInsp() {
    inspEl.append(
      head('Perform', h('span', { class: 'insp-dev' }, 'Macros'), h('button', { class: 'ib', title: 'Back to the track', onclick: () => { macros = false; renderAll(); } }, S4.icon('x'))),
      h('div', { class: 'insp-body' },
        knobs([1, 2, 3, 4, 5, 6, 7, 8].map(n => 'macro.' + n)),
        h('div', { class: 'insp-sub' }, 'Held while pressed'),
        h('div', { class: 'macro-btns' }, [9, 10, 11, 12].map(n => S4.tbutton('btn.macro.' + n, 'M' + n, { cls: 'sm' }))),
        foot('MIDI channel 15')));
  }
})(window.S4);
