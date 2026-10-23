'use strict';
// Live state and the control API (S4.ctl).
// Every controllable thing has a string id; knobs, buttons, learned controls
// and MIDI all go through S4.ctl.get / set / press.
//
//   p.<t>.<slot>.<cc>    device parameter on track t (0-3), channel t+1
//   mod.<t>.<cc>         modulator parameter (CC 14-45), channel t+1
//   mix.<lvl|pan|fltr>.<t>, master.<main|comp>   channel 16
//   macro.<1-8>          PERFORM macro, channel 15
//   btn.<play|rec>, btn.<mute|solo|tplay|trec|mon>.<t>, btn.macro.<9-12>
//   scene.<1-128>, scene.<next|prev>
(function (S4) {
  const TRACKS = [0, 1, 2, 3];

  function fresh() {
    return {
      v: 1,
      tracks: TRACKS.map(() => ({
        devices: { material: 'DISC', granular: 'MOSAIC', filter: 'RING', color: 'DEFORM', space: 'VAST' },
        // the S-4's default modulator per slot (manual)
        vals: {}, mods: {}, modTypes: ['RANDOM', 'RANDOM', 'WAVE', 'WAVE'], bypass: {},
        lvl: 96, pan: 64, fltr: 64, // LVL 96 = 0 dB
        mute: false, solo: false, s4muted: false, tplay: true, trec: false, mon: false,
      })),
      master: { main: 100, comp: 0 },
      macros: [64, 64, 64, 64, 64, 64, 64, 64], // 64 = 0, a fresh project's macros
      scene: 1,
      playing: false,
      rec: false,
      sel: { track: 0, slot: 'material', mod: -1 },
    };
  }

  const saved = S4.store.get('ctl', null);
  const st = S4.state = saved && saved.v === 1 ? saved : fresh();
  st.playing = false;
  st.rec = false;
  const save = S4.debounce(() => S4.store.set('ctl', st), 300);
  S4.saveState = save;

  const nameOf = { lvl: 'LVL', pan: 'PAN', fltr: 'FLTR' };
  const BTN_TOGGLES = { mute: 'mute', solo: 'solo', tplay: 'tplay', trec: 'trec', mon: 'mon' };
  const BTN_LABEL = { mute: 'MUTE', solo: 'SOLO', tplay: 'PLAY / STOP', trec: 'RECORD', mon: 'MONITOR' };

  const ctl = S4.ctl = {};

  ctl.info = function (id) {
    const a = id.split('.');
    switch (a[0]) {
      case 'p': {
        const t = +a[1], slot = a[2], cc = +a[3];
        const dev = st.tracks[t].devices[slot];
        const p = S4.param(dev, cc) || { name: 'CC ' + cc, cc, bi: false, def: 0 };
        return { kind: 'cont', ch: t + 1, cc, bi: p.bi, def: p.def, fmt: p.fmt, short: p.name, label: `T${t + 1} · ${S4.SLOT_LABEL[slot]} CC ${cc}`, p };
      }
      case 'mod': {
        const t = +a[1], cc = +a[2], m = Math.floor((cc - 14) / 8), i = (cc - 14) % 8;
        const type = st.tracks[t].modTypes[m], name = S4.MOD_TYPES[type][i];
        const bi = S4.MOD_BI.has(name), sp = S4.params.MOD[type] && S4.params.MOD[type].params.find(x => x.cc === i);
        // the S-4's default for this modulator type (s4params.js), as the nearest CC
        return { kind: 'cont', ch: t + 1, cc, bi, def: sp ? S4.params.cc(sp, sp.def) : bi ? 64 : 0, short: name, label: `T${t + 1} · MOD ${m + 1} ${name}` };
      }
      case 'mix': {
        const k = a[1], t = +a[2];
        return { kind: 'cont', ch: S4.CH_MIX, cc: S4.MIX_CC[k] + t, bi: k !== 'lvl', def: k === 'lvl' ? 96 : 64, short: nameOf[k], label: `T${t + 1} · MIX ${nameOf[k]}` };
      }
      case 'master': {
        const main = a[1] === 'main';
        return { kind: 'cont', ch: S4.CH_MIX, cc: main ? S4.MIX_CC.main : S4.MIX_CC.comp, bi: false, def: main ? 100 : 0, short: main ? 'MAIN' : 'COMPRESS', label: main ? 'MASTER MAIN' : 'MASTER COMPRESS' };
      }
      case 'macro': {
        const n = +a[1];
        return { kind: 'cont', ch: S4.CH_PERFORM, cc: S4.MACRO_CC + n - 1, bi: false, def: 64, short: 'M' + n, label: 'MACRO ' + n };
      }
      case 'btn': {
        const k = a[1];
        if (k === 'play') return { kind: 'btn', toggle: true, label: 'PLAY / STOP', ch: 16, note: S4.NOTE.START_STOP };
        if (k === 'rec') return { kind: 'btn', toggle: true, label: 'MAIN RECORD', ch: 16, note: S4.NOTE.MAIN_REC };
        if (k === 'macro') return { kind: 'btn', toggle: false, label: 'MACRO ' + a[2], ch: 15, note: S4.NOTE.MACRO9 + (+a[2] - 9) };
        const t = +a[2];
        return { kind: 'btn', toggle: true, label: `T${t + 1} · ${BTN_LABEL[k]}`, ch: 16 };
      }
      case 'scene': {
        if (a[1] === 'next' || a[1] === 'prev') return { kind: 'btn', toggle: false, label: a[1] === 'next' ? 'NEXT SCENE' : 'PREVIOUS SCENE' };
        return { kind: 'btn', toggle: false, label: 'SCENE ' + S4.pad3(+a[1]) };
      }
    }
    return { kind: 'cont', ch: 1, cc: 0, def: 0, short: '?', label: id };
  };

  ctl.get = function (id) {
    const a = id.split('.');
    switch (a[0]) {
      case 'p': {
        const tr = st.tracks[+a[1]], dev = tr.devices[a[2]], v = tr.vals[dev + '.' + a[3]];
        if (v != null) return v;
        const p = S4.param(dev, +a[3]);
        return p ? p.def : 0;
      }
      case 'mod': {
        const v = st.tracks[+a[1]].mods[a[2]];
        return v != null ? v : ctl.info(id).def;
      }
      case 'mix': return st.tracks[+a[2]][a[1]];
      case 'master': return st.master[a[1]];
      case 'macro': return st.macros[+a[1] - 1];
      case 'btn': {
        if (a[1] === 'play') return st.playing;
        if (a[1] === 'rec') return st.rec;
        if (a[1] === 'macro') return !!ctl._held[id];
        return !!st.tracks[+a[2]][BTN_TOGGLES[a[1]]];
      }
      case 'scene': return st.scene === +a[1];
    }
    return 0;
  };

  // ---------- the S-4's own units ----------
  // A control's parameter as the S-4 stores it (s4params.js, measured), in the mode Live knows: the one the
  // followed Build project set (tr.modes, tr.mat from follow.js), else the S-4's default. Its curve turns a CC
  // into the value. null: no measured curve (MAIN, a TAPE LENGTH in seconds).
  const round = c => ({ to: x => Math.round(c.to(x)), from: c.from });
  function matSpec(tr, dev, cc) {
    const P = S4.params, { lin } = P.curves, x = tr.mat && tr.mat.dev === dev ? tr.mat : {};
    const sp = (P.MAT[dev] || []).find(s => s.cc === cc);
    if (sp) return sp;
    if (cc === 53) return { curve: lin(0, 1), unit: '%', def: 0 }; // XFADE
    if (cc === (dev === 'DISC' ? 56 : 50)) return { curve: P.LEVEL, unit: 'dB', def: 0 };
    if (dev === 'POLY') {
      if (cc === 46) return { curve: x.speedMode === 'free' ? P.POLY_PITCH : round(P.POLY_PITCH), unit: 'st', def: 0 };
      return cc === 48 || cc === 49 ? { curve: lin(0, 1), unit: '%', def: cc === 49 ? 1 : 0 } : null;
    }
    if (cc === 46) { // SPEED (with DISC STRETCH: PITCH), in OCTAVES, a scale or FREE
      const m = x.speedMode || (dev === 'DISC' && x.tempoMode === 'stretch' ? 'chromatic' : dev === 'DISC' && x.tempoMode === 'free' ? 'free' : 'octaves');
      return m === 'free' ? { curve: P.SPEED, unit: 'st', def: 0 } : { curve: P.scaleCurve(m) || P.scaleCurve('octaves'), unit: 'st', int: true, def: 0 };
    }
    if (dev === 'DISC' && cc === 47) return { curve: !x.tempoMode || x.tempoMode === 'sync' ? round(P.TEMPO) : P.TEMPO, unit: 'BPM', def: 120 };
    if (dev === 'DISC' && (cc === 48 || cc === 49)) { // START / LENGTH: grid steps in the sample, or its seconds
      const first = cc === 49 ? 1 : 0;
      if (x.grid && x.steps >= 1) return { curve: P.curves.steps(Array.from({ length: x.steps }, (_, i) => (i + first) * x.grid)), unit: 'beats', def: first ? x.steps * x.grid : 0 };
      if (x.secs) return { curve: lin(0, x.secs), unit: 's', def: first ? x.secs : 0 };
      return { curve: lin(0, 1), unit: '%', def: first }; // the sample's length isn't known here: a share of it
    }
    if (dev === 'TAPE' && cc === 49) { // LENGTH: whole grid steps from one to the 30 s a TAPE holds
      if (x.lengthMode === 'free') return null;
      const g = x.grid || 4, proj = S4.cr && S4.cr.proj, B = x.steps || (30 * ((proj && proj.bpm) || 120)) / 60 / g;
      return { curve: { to: c => g * Math.round(1 + (S4.clamp(c, 0, 127) / 127) * (B - 1)), from: v => ((v / g - 1) * 127) / (B - 1) }, unit: g === 4 ? 'bars' : 'beats' };
    }
    return null;
  }
  ctl.spec = function (id) {
    const P = S4.params, { lin } = P.curves, a = id.split('.');
    switch (a[0]) {
      case 'p': {
        const tr = st.tracks[+a[1]], dev = tr.devices[a[2]], cc = +a[3];
        if (a[2] === 'material') return dev === 'BYPASS' ? null : matSpec(tr, dev, cc);
        const sp = P.DEV[dev] && P.DEV[dev].params.find(s => s.cc === cc);
        return sp ? P.inMode(sp, (tr.modes || {})[dev + '.' + cc] || '') : null;
      }
      case 'mod': {
        const tr = st.tracks[+a[1]], cc = +a[2], m = Math.floor((cc - 14) / 8), type = tr.modTypes[m];
        const sp = P.MOD[type] && P.MOD[type].params.find(s => s.cc === (cc - 14) % 8);
        return sp ? P.inMode(sp, (tr.modes || {})[`mod.${type}.${cc}`] || '') : null;
      }
      case 'mix': return a[1] === 'lvl' ? { curve: P.MIX_LEVEL, unit: 'dB', def: 0 } : { curve: lin(-1, 1), unit: '±', def: 0 };
      case 'master': return a[1] === 'comp' ? { curve: lin(0, 1), unit: '%', def: 0 } : null; // MAIN: not measured
      case 'macro': return { curve: lin(-1, 1), unit: '±', def: 0 };
    }
    return null;
  };

  // ---------- exact values ----------
  // What the S-4 has isn't always a CC's value: a project's values are exact (a pan at 0 sits between CC 63 and
  // 64), and so are a fresh device's defaults. A knob shows that exact value until Live sends it a CC; from then
  // on, that CC's value, which is what the S-4 then has.
  //   tr.exact (a track's devices and modulators), st.exact (the mixer, COMPRESS, the macros): key -> the value,
  //   or null once a CC went out. A key that isn't there: the S-4's default, unless exactOnly (set when Live
  //   follows a project or sends everything), where nothing beyond the keys there is known.
  function exactRef(id) {
    const a = id.split('.');
    switch (a[0]) {
      case 'p': { const tr = st.tracks[+a[1]]; return { h: tr, key: tr.devices[a[2]] + '.' + a[3] }; }
      case 'mod': { const tr = st.tracks[+a[1]]; return { h: tr, key: `mod.${tr.modTypes[Math.floor((+a[2] - 14) / 8)]}.${a[2]}` }; }
      case 'mix': case 'macro': return { h: st, key: id };
      case 'master': return a[1] === 'comp' ? { h: st, key: id } : null;
    }
    return null;
  }
  ctl.exact = function (id, v = ctl.get(id)) {
    const r = exactRef(id), sp = r && ctl.spec(id);
    if (!sp) return null;
    const e = r.h.exact ? r.h.exact[r.key] : undefined;
    const x = e !== undefined ? e : r.h.exactOnly ? null : sp.def;
    return typeof x === 'number' && S4.params.cc(sp, x) === v ? x : null;
  };
  const sent = id => { const r = exactRef(id); if (r) (r.h.exact = r.h.exact || {})[r.key] = null; };
  // follow.js: the values a project set ('DEV.cc', 'mod.TYPE.cc' on a track; 'mix.k.t', 'master.comp', 'macro.n')
  ctl.setExact = (h, exact) => { h.exact = exact; h.exactOnly = true; };

  ctl.format = function (id, v) {
    const sp = ctl.spec(id);
    if (sp) { const x = ctl.exact(id, v); return S4.params.fmt(sp, x != null ? x : sp.curve.to(v)); }
    const i = ctl.info(id);
    return S4.fmtCC(v, i.bi, i.fmt);
  };
  // a typed value ("-6 dB", "1/16", "250 ms", "3 bars"; a plain number in the parameter's unit) -> CC, or null
  ctl.parse = function (id, text) {
    const sp = ctl.spec(id);
    if (!sp) { const n = parseFloat(text); return Number.isFinite(n) ? S4.clamp(Math.round(n), 0, 127) : null; }
    const v = S4.params.parse(sp, text);
    return v == null ? null : S4.clamp(Math.round(sp.curve.from(v)), 0, 127);
  };

  // opts: { src: 'ui' | 'map:<id>' | 'reset' ..., send: false }
  ctl.set = function (id, v, opts = {}) {
    v = S4.clamp(Math.round(v), 0, 127);
    if (v === ctl.get(id) && !opts.force) return;
    const a = id.split('.');
    switch (a[0]) {
      case 'p': { const tr = st.tracks[+a[1]]; tr.vals[tr.devices[a[2]] + '.' + a[3]] = v; break; }
      case 'mod': st.tracks[+a[1]].mods[a[2]] = v; break;
      case 'mix': st.tracks[+a[2]][a[1]] = v; break;
      case 'master': st.master[a[1]] = v; break;
      case 'macro': st.macros[+a[1] - 1] = v; break;
      default: return;
    }
    if (opts.send !== false) {
      const i = ctl.info(id);
      S4.midi.cc(i.ch, i.cc, v);
    }
    sent(id); // the S-4 has this CC's value now, not an exact one
    save();
    S4.emit('val', id, opts.src || 'ui');
  };

  ctl._held = {};
  // Buttons. down=true on press, false on release. Toggles act on press;
  // opts.gate makes a toggle follow the held state instead.
  ctl.press = function (id, down, opts = {}) {
    const a = id.split('.');
    if (a[0] === 'scene') {
      if (!down) return;
      if (a[1] === 'next') ctl.launch(st.scene + 1);
      else if (a[1] === 'prev') ctl.launch(st.scene - 1);
      else ctl.launch(+a[1]);
      return;
    }
    if (a[0] !== 'btn') return;
    const k = a[1];
    if (k === 'macro') {
      const n = +a[2], note = S4.NOTE.MACRO9 + n - 9;
      if (!!ctl._held[id] === down) return;
      ctl._held[id] = down;
      if (down) S4.midi.noteOn(S4.CH_PERFORM, note); else S4.midi.noteOff(S4.CH_PERFORM, note);
      S4.emit('val', id);
      return;
    }
    const cur = ctl.get(id);
    let next;
    if (opts.gate) next = down; else if (down) next = !cur; else return;
    if (next === cur) return;
    if (k === 'play') return ctl.setPlaying(next, true);
    if (k === 'rec') {
      st.rec = next;
      S4.midi.noteTap(16, S4.NOTE.MAIN_REC, opts.at);
      S4.emit('val', id);
      return;
    }
    const t = +a[2], tr = st.tracks[t];
    tr[BTN_TOGGLES[k]] = next;
    if (k === 'mute' || k === 'solo') applyMutes();
    else if (k === 'tplay') S4.midi.noteTap(16, S4.NOTE.TRACK_PLAY + t);
    else if (k === 'trec') S4.midi.noteTap(16, S4.NOTE.TRACK_REC + t, opts.at);
    else if (k === 'mon') S4.midi.noteTap(16, S4.NOTE.MONITOR + t);
    save();
    S4.emit('val', id);
    if (k === 'solo') TRACKS.forEach(i => S4.emit('val', 'btn.mute.' + i));
  };

  // The S-4 mute note toggles, so track what we believe the S-4 has and only
  // send when the effective (mute || other-track-solo) state changes.
  function applyMutes() {
    const anySolo = st.tracks.some(t => t.solo);
    st.tracks.forEach((tr, i) => {
      const want = tr.mute || (anySolo && !tr.solo);
      if (want !== !!tr.s4muted) {
        S4.midi.noteTap(16, S4.NOTE.MUTE + i);
        tr.s4muted = want;
      }
    });
    S4.emit('mutes');
  }
  ctl.effectiveMuted = t => !!st.tracks[t].s4muted;

  // at: a performance.now() time to send at (the recorder's count-in); now when left out
  ctl.setPlaying = function (on, send, at) {
    if (st.playing === on) return;
    st.playing = on;
    if (send) {
      if (S4.midi.settings.transport === 'realtime') S4.midi.realtime(on ? 0xFA : 0xFC, at);
      else S4.midi.noteTap(16, S4.NOTE.START_STOP, at);
      S4.midi.expectAnswer(tries => {
        ctl.setPlaying(!on, false); // nothing came back, so the S-4 most likely didn't change
        S4.toast(tries ? 'Still no reply from the S-4. Reload the page; if that doesn\'t help, make sure it isn\'t in USB storage mode, plug it in again, or restart the browser.'
          : `No reply from the S-4 to ${on ? 'START' : 'STOP'}, so MIDI isn't getting through. MIDI has been reopened: try again.`, 'err');
      }, at);
    }
    S4.emit('val', 'btn.play');
  };
  S4.on('s4-transport', on => ctl.setPlaying(on, false));

  ctl.launch = function (n) {
    n = S4.clamp(n, 1, 128);
    const old = st.scene;
    st.scene = n;
    S4.midi.pc(S4.midi.settings.pcCh, n - 1);
    save();
    S4.emit('val', 'scene.' + old);
    S4.emit('val', 'scene.' + n);
    S4.emit('scene', n);
  };

  // ---------- device helpers ----------
  ctl.paramIds = function (t, slot) {
    const dev = st.tracks[t].devices[slot];
    return S4.DEVICES[dev] ? S4.DEVICES[dev].params.map(p => `p.${t}.${slot}.${p.cc}`) : [];
  };
  ctl.modIds = (t, m) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => `mod.${t}.${S4.modCC(m, i)}`);

  ctl.setDevice = function (t, slot, dev) {
    const tr = st.tracks[t];
    if (tr.devices[slot] === dev) return;
    delete tr.bypass[slot];
    tr.devices[slot] = dev;
    save();
    S4.emit('device', t, slot);
  };

  ctl.reset = function (ids) {
    ids.forEach(id => ctl.set(id, ctl.info(id).def, { src: 'reset', force: true }));
  };

  ctl.randomize = function (ids) {
    ids.forEach(id => {
      const i = ctl.info(id);
      if (i.p && i.p.level) return; // keep levels where they are
      const max = (i.p && i.p.safeMax) || 127;
      ctl.set(id, Math.floor(Math.random() * (max + 1)), { src: 'random' });
    });
  };

  // BYPASS: the S-4 has no bypass CC, so zero the device's WET/LEVEL
  // parameter(s) and restore the previous values when switched back.
  ctl.isBypassed = (t, slot) => !!st.tracks[t].bypass[slot];
  ctl.toggleBypass = function (t, slot) {
    const tr = st.tracks[t], dev = S4.DEVICES[tr.devices[slot]];
    if (!dev) return;
    if (tr.bypass[slot]) {
      const saved = tr.bypass[slot];
      delete tr.bypass[slot];
      dev.wet.forEach(cc => ctl.set(`p.${t}.${slot}.${cc}`, saved[cc], { src: 'bypass', force: true }));
    } else {
      const saved = {};
      dev.wet.forEach(cc => { saved[cc] = ctl.get(`p.${t}.${slot}.${cc}`); });
      tr.bypass[slot] = saved;
      dev.wet.forEach(cc => ctl.set(`p.${t}.${slot}.${cc}`, 0, { src: 'bypass', force: true }));
    }
    save();
    S4.emit('bypass', t, slot);
  };

  // Push the whole on-screen state to the S-4 (it cannot report its knobs back).
  ctl.dumpAll = function () {
    const ids = [];
    st.tracks.forEach((tr, t) => {
      S4.SLOTS.forEach(s => ids.push(...ctl.paramIds(t, s.id)));
      [0, 1, 2, 3].forEach(m => ids.push(...ctl.modIds(t, m)));
      ['lvl', 'pan', 'fltr'].forEach(k => ids.push(`mix.${k}.${t}`));
    });
    ids.push('master.main', 'master.comp', ...st.macros.map((_, i) => 'macro.' + (i + 1)));
    const out = ids.map(id => { const i = ctl.info(id); sent(id); return [0xB0 | (i.ch - 1), i.cc, ctl.get(id)]; });
    S4.midi.sendBatch(out);
    save();
    S4.emit('device'); // the knobs now show what those CCs set
    return out.length;
  };

  ctl.select = function (t, slot, mod) {
    st.sel.track = t;
    if (slot) st.sel.slot = slot;
    st.sel.mod = mod == null ? -1 : mod;
    save();
    S4.emit('sel');
  };
})(window.S4);
