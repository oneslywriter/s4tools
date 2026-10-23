'use strict';
// Live follows Build's project: launching scene N from Live shows scene N's values as
// the project stores them, converted to the CCs Live works in. Nothing is sent: the S-4 loads the scene
// itself. Covered: the devices per slot (BYPASS material too), every effect value in its mode, effect bypass,
// the four modulators (type and values), the material values with measured curves (DISC SPEED / TEMPO /
// START / LENGTH / OFFSET / GLIDE / SOS / DENSITY, TAPE SPEED / LENGTH / ROTATE / SOS, POLY PITCH / START /
// LENGTH and envelope, LOOP, CURVE, VELOCITY, filter, LEVEL, XFADE), and the project's mutes and track play
// states. The mixer's levels, pans and filters, COMPRESS and the Perform macros belong to the whole project:
// the S-4 sets them when it opens a project, not when a scene changes, so Live takes them once, on the first
// scene launched after Build exports or opens a project (F.fresh). MAIN isn't stored in a project.
(function (S4) {
  const P = S4.params;
  const F = S4.follow = { settings: Object.assign({ on: true }, S4.store.get('follow', {})) };
  F.save = () => S4.store.set('follow', F.settings);
  const LEVEL = { curve: P.LEVEL };
  const LEVEL_CC = { DISC: 56, TAPE: 50, POLY: 50 };
  const cc = (spec, v) => P.cc(spec, v);
  // CC curves from calibration round 4 (S4T CAL4, 2026-10-22). A SPEED in OCTAVES or a scale is the nearest
  // step to the linear value, a TEMPO in SYNC the nearest whole BPM; START / LENGTH on a grid step evenly
  // through the grid steps (LENGTH from one step to all of them), and in FREE through the sample's seconds.
  const { lin } = P.curves;
  const SPEED = P.SPEED, TEMPO = P.TEMPO, PITCH = P.POLY_PITCH, MIX_LEVEL = P.MIX_LEVEL, BI = lin(-1, 1);
  const step = (k, n) => (n > 1 ? (k * 127) / (n - 1) : 0); // grid step k (from 0) of n

  F.project = () => (S4.cr && S4.cr.proj) || null;
  F.has = idx => { const p = F.project(); return !!(p && p.scenes[idx]); };
  let fresh = false;
  F.fresh = () => { fresh = true; };

  function track(cs, tr, t) {
    const put = (dev, n, v) => { if (Number.isFinite(v)) cs.vals[dev + '.' + n] = S4.clamp(Math.round(v), 0, 127); };
    // material
    const dev = tr.device || 'DISC';
    cs.devices.material = dev;
    const mx = (tr.mx && tr.mx[dev]) || {};
    (P.MAT[dev] || []).forEach(sp => put(dev, sp.cc, cc(sp, mx[sp.key] != null ? mx[sp.key] : sp.def)));
    if (LEVEL_CC[dev]) put(dev, LEVEL_CC[dev], cc(LEVEL, tr.lvl || 0));
    if (dev === 'DISC' || dev === 'TAPE' || dev === 'POLY') put(dev, 53, tr.xfade || 0);
    const sv = S4.s4p.stored(F.project(), tr) || {};
    const at = (n, v, f) => { if (typeof v === 'number') put(dev, n, f(v)); };
    if (dev === 'DISC') {
      at(46, sv.speed, SPEED.from);
      at(47, sv.tempo, TEMPO.from);
      if (sv.grid) { at(48, sv.start, v => step(v / sv.grid, sv.steps)); at(49, sv.length, v => step(v / sv.grid - 1, sv.steps)); }
      else if (sv.secs) { at(48, sv.start, v => (v / sv.secs) * 127); at(49, sv.length, v => (v / sv.secs) * 127); }
    } else if (dev === 'TAPE') {
      at(46, sv.speed, SPEED.from);
      if (sv.grid) at(49, sv.length, v => step(v / sv.grid - 1, sv.steps));
    } else if (dev === 'POLY') {
      at(46, sv.pitch, PITCH.from);
      at(48, sv.start, v => v * 127);
      at(49, sv.length, v => v * 127);
    }
    // effects, as the hardware preview reads them (hwpreview.js wanted())
    for (const [name, d] of Object.entries(P.DEV)) {
      const e = tr.fx && tr.fx[name];
      if (!e && tr.s4raw && tr.s4raw[d.slot] && Object.keys(tr.s4raw[d.slot]).length) continue; // imported before exact values
      cs.devices[d.slot] = name;
      const v = {};
      d.params.forEach(sp => {
        const ms = P.inMode(sp, e && e.md && e.md[sp.key]);
        v[sp.cc] = cc(ms, e && e.n && e.n[sp.key] != null ? e.n[sp.key] : ms.def);
      });
      delete cs.bypass[d.slot];
      if (e && !e.on) { // bypassed on the S-4: Live's bypass keeps the WETs and shows them at 0
        const saved = {};
        S4.DEVICES[name].wet.forEach(w => { saved[w] = v[w]; v[w] = 0; });
        cs.bypass[d.slot] = saved;
      }
      Object.entries(v).forEach(([n, x]) => put(name, n, x));
    }
    // modulators
    for (let m = 0; m < 4; m++) {
      const blk = S4.s4p.peek(tr, 'modulator' + (m + 1)) || {};
      const type = S4.mods.typeOf(blk, m), spec = P.MOD[type], vb = blk[spec.key] || {};
      cs.modTypes[m] = type;
      spec.params.forEach(sp => {
        const x = vb[sp.key], ms = P.inMode(sp, x && x.mode);
        cs.mods[S4.modCC(m, sp.cc)] = S4.clamp(cc(ms, x && typeof x.value === 'number' ? x.value : ms.def), 0, 127);
      });
    }
  }

  // the project mixer (Build's units: LVL dB, PAN / FLTR -64..63, COMPRESS 0-1) and the Perform macros (-1..1)
  function projectWide(proj, st) {
    const to = (curve, v) => S4.clamp(Math.round(curve.from(v)), 0, 127);
    if (proj.mix) {
      proj.mix.tracks.forEach((mt, t) => {
        const cs = st.tracks[t];
        cs.lvl = to(MIX_LEVEL, mt.lvl <= -95 ? -100 : S4.clamp(mt.lvl, -100, 6));
        cs.pan = to(BI, S4.clamp(mt.pan / 64, -1, 1));
        cs.fltr = to(BI, S4.clamp(mt.fltr / 64, -1, 1));
      });
      st.master.comp = to(lin(0, 1), S4.clamp(proj.mix.comp || 0, 0, 1));
    }
    const perf = (S4.s4p.peekGlobal(proj).perform || {}).perform || {};
    st.macros = st.macros.map((_, i) => { const m = perf['macro' + (i + 1)]; return to(BI, m && typeof m.value === 'number' ? m.value : 0); });
  }

  F.apply = function (idx) {
    const proj = F.project(), sc = proj && proj.scenes[idx];
    if (!sc) return false;
    const st = S4.state;
    sc.tracks.forEach((tr, t) => track(st.tracks[t], tr, t));
    if (fresh) { fresh = false; projectWide(proj, st); }
    // project-wide: mutes (what the S-4 has) and which tracks play on load
    const mixer = (S4.s4p.peekGlobal(proj).mixer) || {};
    st.tracks.forEach((cs, t) => {
      const mt = proj.mix && proj.mix.tracks[t];
      if (mt) { cs.mute = !!mt.mute; cs.s4muted = !!mt.mute; cs.solo = false; }
      if (Array.isArray(mixer.track_playing)) cs.tplay = mixer.track_playing[t] !== false;
    });
    S4.saveState();
    S4.emit('device');
    S4.emit('mutes');
    return true;
  };

  S4.on('scene', n => { if (F.settings.on) F.apply(n - 1); });
})(window.S4);
