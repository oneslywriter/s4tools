// "S4T VERIFY3": what VERIFY2 left open. Run in the app page like verify_build.js (before the exporter writes
// effect defaults out, so scenes 10-13 match VERIFY's scenes 9 / 10 exactly); uploads /upload/S4T_VERIFY3.zip.
// S-4 scene numbers (1-based):
//   1-6    T1 alone, sine: effects all bypassed / only MOSAIC on (defaults) / only RING / only DEFORM /
//          only VAST / all four on (defaults): each device's level and distortion at its defaults
//   7-9    T2 / T3 / T4 alone at 0 dB, panned -1 / -0.5 / +0.5 (with VERIFY2: -1 .. +1 in steps of 0.5)
//   10-13  VERIFY's scene 9, its scene 10 as exported then, scene 9 again, and scene 10 without its
//          FOLLOW modulators: replays the scene that came out wrong
(async () => {
  const P = S4.cr.make.project();
  P.name = 'S4T VERIFY3';
  P.bpm = 120;
  const bytes = await (await fetch('/ext/3/VERIFY_sine440.wav')).arrayBuffer();
  await S4.idb.put({ id: 'VERIFY_VERIFY_sine440.wav', name: 'VERIFY_sine440.wav', folder: '', bytes, type: 'audio/wav' });
  const SINE = { id: 'VERIFY_VERIFY_sine440.wav', file: 'VERIFY_sine440.wav', name: 'VERIFY_sine440', folder: '', bpm: 120, bpmSrc: 'user', key: null, dur: null };
  const DEVS = ['MOSAIC', 'RING', 'DEFORM', 'VAST'];
  const defaults = d => S4.params.defaults(S4.params.DEV[d].params);
  const OFF = () => Object.fromEntries(DEVS.map(d => [d, { on: false, n: defaults(d) }]));
  const only = dev => Object.assign(OFF(), dev ? { [dev]: { on: true, n: defaults(dev) } } : {});
  const ALL = () => Object.fromEntries(DEVS.map(d => [d, { on: true, n: defaults(d) }]));
  // as in verify_build.js
  const disc = (o) => Object.assign({ device: 'DISC', tempo: 'sync', sample: Object.assign({}, SINE), grid: '1/4', start: 0, length: null, fx: OFF() }, o);
  const empty = () => ({ device: 'DISC', fx: OFF() });
  const S = {};
  S[0] = [disc({ fx: only(null) }), empty(), empty(), empty()];
  S[1] = [disc({ fx: only('MOSAIC') }), empty(), empty(), empty()];
  S[2] = [disc({ fx: only('RING') }), empty(), empty(), empty()];
  S[3] = [disc({ fx: only('DEFORM') }), empty(), empty(), empty()];
  S[4] = [disc({ fx: only('VAST') }), empty(), empty(), empty()];
  S[5] = [disc({ fx: ALL() }), empty(), empty(), empty()];
  S[6] = [empty(), disc(), empty(), empty()];
  S[7] = [empty(), empty(), disc(), empty()];
  S[8] = [empty(), empty(), empty(), disc()];
  // VERIFY scene 9 (effects test) and scene 10, built the same way
  const scene9 = () => [disc(), disc({ fx: undefined }), disc({ fx: Object.assign(OFF(), { DEFORM: { on: true, n: Object.assign(defaults('DEFORM'), { drive: 0.5 }) } }) }), empty()];
  const scene10 = () => [empty(), empty(), empty(), disc()];
  S[9] = scene9();
  S[10] = scene10();
  S[11] = scene9();
  S[12] = scene10();
  for (const [i, tracks] of Object.entries(S)) {
    const sc = S4.cr.make.scene();
    sc.name = 'VERIFY3 ' + (+i + 1);
    tracks.forEach((o, t) => { Object.assign(sc.tracks[t], o); if (o.fx === undefined) delete sc.tracks[t].fx; });
    P.scenes[+i] = sc;
  }
  // scene 11 (index 10): VERIFY scene 10's FOLLOW modulators on T1 and T2; scene 13 (index 12) has none
  const FOLLOW_INPUTS = ['input 1/2', 'input 1', 'input 2', 'track 1', 'track 2', 'track 3', 'mix', 'material'];
  FOLLOW_INPUTS.forEach((src, k) => {
    const tr = P.scenes[10].tracks[k >> 2];
    const blk = S4.s4p.block(tr, 'modulator' + ((k & 3) + 1));
    blk.selected = 2;
    S4.mods.ensure(blk, k & 3).input_level = { value: 0, mode: src };
  });
  // mixer: T1 centre 0 dB; T2 / T3 / T4 at 0 dB panned -1 / -0.5 / +0.5 (VERIFY had T4 at -6 dB / -0.5: the
  // mixer differs, the scenes themselves are as exported then). T2's input on SENDS ONLY, as in VERIFY.
  Object.assign(P.mix.tracks[0], { lvl: 0, pan: 0 });
  Object.assign(P.mix.tracks[1], { lvl: 0, pan: -64 });
  Object.assign(P.mix.tracks[2], { lvl: 0, pan: -32 });
  Object.assign(P.mix.tracks[3], { lvl: 0, pan: 32 });
  S4.s4p.settings(P).audio_settings.track2_input = 3;
  const out = await S4.s4p.build(P);
  const r = await fetch('/upload/S4T_VERIFY3.zip', { method: 'PUT', body: S4.zip.write(out.files) });
  return { upload: await r.text(), warnings: out.warnings };
})();
