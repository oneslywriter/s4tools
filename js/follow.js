'use strict';
// Live follows Build's project: launching scene N from Live shows scene N's values as
// the project stores them, converted to the CCs Live works in. Nothing is sent: the S-4 loads the scene
// itself. Covered: the devices per slot (BYPASS material too), every effect value in its mode, effect bypass,
// the four modulators (type and values), the material values with measured curves (DISC OFFSET / GLIDE / SOS /
// DENSITY / LEVEL / XFADE, TAPE ROTATE / SOS / XFADE, POLY envelope, LOOP, CURVE, VELOCITY, filter, LEVEL,
// XFADE), and the project's mutes and track play states. Left as they are until their CC curves are measured:
// DISC SPEED / TEMPO / START / LENGTH, TAPE SPEED / LENGTH / LEVEL, POLY PITCH / START / LENGTH, the mixer's
// levels, pans and filters, COMPRESS, MAIN and the Perform macros.
(function (S4) {
  const P = S4.params;
  const F = S4.follow = { settings: Object.assign({ on: true }, S4.store.get('follow', {})) };
  F.save = () => S4.store.set('follow', F.settings);
  const LEVEL = { curve: P.LEVEL };
  const LEVEL_CC = { DISC: 56, POLY: 50 };
  const cc = (spec, v) => P.cc(spec, v);

  F.project = () => (S4.cr && S4.cr.proj) || null;
  F.has = idx => { const p = F.project(); return !!(p && p.scenes[idx]); };

  function track(cs, tr, t) {
    const put = (dev, n, v) => { cs.vals[dev + '.' + n] = S4.clamp(Math.round(v), 0, 127); };
    // material
    const dev = tr.device || 'DISC';
    cs.devices.material = dev;
    const mx = (tr.mx && tr.mx[dev]) || {};
    (P.MAT[dev] || []).forEach(sp => put(dev, sp.cc, cc(sp, mx[sp.key] != null ? mx[sp.key] : sp.def)));
    if (LEVEL_CC[dev]) put(dev, LEVEL_CC[dev], cc(LEVEL, tr.lvl || 0));
    if (dev === 'DISC' || dev === 'TAPE' || dev === 'POLY') put(dev, 53, tr.xfade || 0);
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

  F.apply = function (idx) {
    const proj = F.project(), sc = proj && proj.scenes[idx];
    if (!sc) return false;
    const st = S4.state;
    sc.tracks.forEach((tr, t) => track(st.tracks[t], tr, t));
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
