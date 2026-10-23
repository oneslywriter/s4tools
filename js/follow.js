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
  const LEVEL_CC = { DISC: 56, TAPE: 50, POLY: 50 };
  const cc = (spec, v) => P.cc(spec, v);
  // The material's curves (calibration rounds 4 and 5: SPEED, TEMPO, START / LENGTH on the sample's grid steps,
  // TAPE LENGTH up to 30 s) are the ones its knobs use: S4.ctl.spec in state.js.
  const { lin } = P.curves;
  const MIX_LEVEL = P.MIX_LEVEL, BI = lin(-1, 1);

  F.project = () => (S4.cr && S4.cr.proj) || null;
  F.has = idx => { const p = F.project(); return !!(p && p.scenes[idx]); };
  let fresh = false;
  F.fresh = () => { fresh = true; };

  function track(cs, tr, t) {
    // each value goes in as its nearest CC and as itself: the knob shows the exact value until Live sends a CC
    const exact = {};
    const put = (dev, n, v, x) => {
      if (!Number.isFinite(v)) return;
      cs.vals[dev + '.' + n] = S4.clamp(Math.round(v), 0, 127);
      if (typeof x === 'number') exact[dev + '.' + n] = x;
    };
    // the modes the project sets, for Live's units (S4.ctl.spec): 'DEV.cc' and 'mod.TYPE.cc' -> mode
    cs.modes = {};
    // material, on the curves its knobs show it with (S4.ctl.spec), so the CC and the shown value agree
    const dev = tr.device || 'DISC';
    cs.devices.material = dev;
    const sv = S4.s4p.stored(F.project(), tr) || {};
    cs.mat = Object.assign({ dev, bpm: F.project().bpm }, sv); // the material's modes, grid and sample length
    const at = (n, x) => { const sp = typeof x === 'number' && S4.ctl.spec(`p.${t}.material.${n}`); if (sp) put(dev, n, sp.curve.from(x), x); };
    const mx = (tr.mx && tr.mx[dev]) || {};
    (P.MAT[dev] || []).forEach(sp => at(sp.cc, mx[sp.key] != null ? mx[sp.key] : sp.def));
    if (dev !== 'BYPASS') { at(LEVEL_CC[dev], S4.clamp(tr.lvl || 0, -100, 12)); at(53, (tr.xfade || 0) / 127); }
    if (dev === 'DISC') { at(46, sv.speed); at(47, sv.tempo); at(48, sv.start); at(49, sv.length); }
    else if (dev === 'TAPE') { at(46, sv.speed); at(49, sv.length); }
    else if (dev === 'POLY') { at(46, sv.pitch); at(48, sv.start); at(49, sv.length); }
    // effects, as the hardware preview reads them (hwpreview.js wanted())
    for (const [name, d] of Object.entries(P.DEV)) {
      const e = tr.fx && tr.fx[name];
      if (!e && tr.s4raw && tr.s4raw[d.slot] && Object.keys(tr.s4raw[d.slot]).length) continue; // imported before exact values
      cs.devices[d.slot] = name;
      const v = {};
      d.params.forEach(sp => {
        const md = e && e.md && e.md[sp.key], ms = P.inMode(sp, md);
        if (md) cs.modes[name + '.' + sp.cc] = md;
        const x = e && e.n && e.n[sp.key] != null ? e.n[sp.key] : ms.def;
        v[sp.cc] = [cc(ms, x), x];
      });
      delete cs.bypass[d.slot];
      if (e && !e.on) { // bypassed on the S-4: Live's bypass keeps the WETs and shows them at 0
        const saved = {};
        S4.DEVICES[name].wet.forEach(w => { saved[w] = v[w][0]; v[w] = [0, null]; });
        cs.bypass[d.slot] = saved;
      }
      Object.entries(v).forEach(([n, [c, x]]) => put(name, n, c, x));
    }
    // modulators
    for (let m = 0; m < 4; m++) {
      const blk = S4.s4p.peek(tr, 'modulator' + (m + 1)) || {};
      const type = S4.mods.typeOf(blk, m), spec = P.MOD[type], vb = blk[spec.key] || {};
      cs.modTypes[m] = type;
      spec.params.forEach(sp => {
        const x = vb[sp.key], ms = P.inMode(sp, x && x.mode), n = S4.modCC(m, sp.cc);
        if (x && x.mode) cs.modes[`mod.${type}.${n}`] = x.mode;
        const xv = x && typeof x.value === 'number' ? x.value : ms.def;
        cs.mods[n] = S4.clamp(cc(ms, xv), 0, 127);
        exact[`mod.${type}.${n}`] = xv;
      });
    }
    S4.ctl.setExact(cs, exact);
  }

  // the project mixer (Build's units: LVL dB, PAN / FLTR -64..63, COMPRESS 0-1) and the Perform macros (-1..1).
  // A value nobody changed since the import is the S-4's own, as the export writes it back.
  function projectWide(proj, st) {
    const exact = {};
    const set = (id, curve, x) => { exact[id] = x; return S4.clamp(Math.round(curve.from(x)), 0, 127); };
    if (proj.mix) {
      const raw = ((S4.s4p.peekGlobal(proj).mixer || {}).mix || {}).mix || {}, inn = proj.s4mixIn;
      const keep = (same, key, made) => (inn && same && raw[key] && typeof raw[key].value === 'number' ? raw[key].value : made);
      proj.mix.tracks.forEach((mt, t) => {
        const cs = st.tracks[t], was = inn && inn.tracks[t], n = t + 1;
        cs.lvl = set(`mix.lvl.${t}`, MIX_LEVEL, keep(was && was.lvl === mt.lvl, 'level' + n, mt.lvl <= -95 ? -100 : S4.clamp(mt.lvl, -100, 6)));
        cs.pan = set(`mix.pan.${t}`, BI, keep(was && was.pan === mt.pan, 'pan' + n, S4.clamp(mt.pan / 64, -1, 1)));
        cs.fltr = set(`mix.fltr.${t}`, BI, keep(was && was.fltr === mt.fltr, 'cutoff' + n, S4.clamp(mt.fltr / 64, -1, 1)));
      });
      st.master.comp = set('master.comp', lin(0, 1), keep(inn && inn.comp === proj.mix.comp, 'compress_amount', S4.clamp(proj.mix.comp || 0, 0, 1)));
    }
    const perf = (S4.s4p.peekGlobal(proj).perform || {}).perform || {};
    st.macros = st.macros.map((_, i) => { const m = perf['macro' + (i + 1)]; return set('macro.' + (i + 1), BI, m && typeof m.value === 'number' ? m.value : 0); });
    S4.ctl.setExact(st, exact);
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
