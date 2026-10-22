// "S4T VERIFY2": the questions VERIFY left open. Run in the app page like verify_build.js; uploads
// /upload/S4T_VERIFY2.zip and leaves the plan in window._verify2. Every sound is VERIFY_sine440 on DISC SYNC
// with SPEED in chromatic semitones (verified varispeed), so tracks and scenes are told apart by pitch.
// Scene numbers below are the S-4's (1-based).
//   1-4    one track alone (mixer: T1 0 dB / C, T2 -6 dB / C, T3 0 dB / pan +1, T4 -6 dB / pan -0.5)
//   5      all four at 0 / +4 / +7 / +12 st, effects bypassed
//   6      no sample after scene 5: T1 DISC, T2 BYPASS, T3 TAPE, T4 POLY
//   7      effects: T1 COLOR on (DRIVE 0.5, rest bypassed); T2 all four at the S-4's defaults, written out;
//          T3 all bypassed
//   8      the same three tracks with their effects not set ({}): what they inherit from scene 7
//   10, 11, 12, 20, 99, 100, 128   T1 alone at +1 .. +7 st: two- and three-digit scene file names
//   30-45  one mode name each on T1's MOSAIC / DEFORM (T1 also plays the sine): kept after a save = valid
//   46-51  FOLLOW modulators on T1: one with MATERIAL (''), four with '', one with 'track 4' (seen on the
//          S-4), 'input 1/2', 'input 1', 'mix'
(async () => {
  const P = S4.cr.make.project();
  P.name = 'S4T VERIFY2';
  P.bpm = 120;
  const bytes = await (await fetch('/ext/3/VERIFY_sine440.wav')).arrayBuffer();
  await S4.idb.put({ id: 'VERIFY_VERIFY_sine440.wav', name: 'VERIFY_sine440.wav', folder: '', bytes, type: 'audio/wav' });
  const SINE = { id: 'VERIFY_VERIFY_sine440.wav', file: 'VERIFY_sine440.wav', name: 'VERIFY_sine440', folder: '', bpm: 120, bpmSrc: 'user', key: null, dur: null };
  const DEVS = ['MOSAIC', 'RING', 'DEFORM', 'VAST'];
  const defaults = d => S4.params.defaults(S4.params.DEV[d].params);
  const OFF = () => Object.fromEntries(DEVS.map(d => [d, { on: false, n: defaults(d) }]));
  const DEF = () => Object.fromEntries(DEVS.map(d => [d, { on: true, n: defaults(d) }]));
  const sine = (st, fx) => ({ device: 'DISC', tempo: 'sync', sample: Object.assign({}, SINE), grid: '1/4', start: 0, length: null, fx: fx === undefined ? OFF() : fx, dspMode: 'chromatic', speedSt: st });
  const none = () => ({ device: 'DISC', fx: OFF() });
  const S = {};
  S[0] = [none(), none(), none(), sine(0)];
  S[1] = [none(), sine(0), none(), none()];
  S[2] = [none(), none(), sine(0), none()];
  S[3] = [sine(0), none(), none(), none()];
  S[4] = [sine(0), sine(4), sine(7), sine(12)];
  S[5] = [{ device: 'DISC', fx: OFF() }, { device: 'BYPASS', fx: OFF() }, { device: 'TAPE', fx: OFF() }, { device: 'POLY', fx: OFF() }];
  S[6] = [sine(0, Object.assign(OFF(), { DEFORM: { on: true, n: Object.assign(defaults('DEFORM'), { drive: 0.5 }) } })), sine(4, DEF()), sine(7, OFF()), none()];
  S[7] = [sine(0, null), sine(4, null), sine(7, null), none()];
  [9, 10, 11, 19, 98, 99, 127].forEach((s, k) => { S[s] = [sine(k + 1), none(), none(), none()]; });
  // mode names to check: one per scene, on T1 (which also plays the sine, so a scene that loads shows its sample)
  const MODES = [];
  ['dorian', 'lydian', 'super locrian', 'mixolydian', 'hex aeolian', 'hex dorian', 'blues', 'hirajoshi', 'kumoi', 'iwato', 'whole tone', 'pelog', 'tetratonic', 'fifths']
    .forEach(m => MODES.push({ dev: 'MOSAIC', key: 'pitch', mode: m }));
  MODES.push({ dev: 'MOSAIC', key: 'rand_pitch', mode: 'random' }, { dev: 'DEFORM', key: 'crush', mode: 'redux' });
  MODES.forEach((m, k) => {
    const fx = OFF();
    fx[m.dev] = { on: true, n: defaults(m.dev), md: { [m.key]: m.mode } };
    S[29 + k] = [sine(0, fx), none(), none(), none()];
  });
  const FOLLOW = [[''], ['', '', '', ''], ['track 4'], ['input 1/2'], ['input 1'], ['mix']];
  FOLLOW.forEach((list, k) => { S[45 + k] = [sine(0), none(), none(), none()]; });
  for (const [i, tracks] of Object.entries(S)) {
    const sc = S4.cr.make.scene();
    sc.name = 'VERIFY2 ' + (+i + 1);
    tracks.forEach((o, t) => { if (o.fx === null) delete o.fx; Object.assign(sc.tracks[t], o); if (o.fx === undefined) delete sc.tracks[t].fx; });
    P.scenes[+i] = sc;
  }
  // effects not set in scene 8: no fx entry at all
  P.scenes[7].tracks.slice(0, 3).forEach(tr => { delete tr.fx; });
  FOLLOW.forEach((list, k) => {
    const tr = P.scenes[45 + k].tracks[0];
    list.forEach((src, n) => {
      const blk = S4.s4p.block(tr, 'modulator' + (n + 1));
      blk.selected = 2;
      S4.mods.ensure(blk, n).input_level = { value: 0, mode: src };
    });
  });
  Object.assign(P.mix.tracks[0], { lvl: 0, pan: 0 });
  Object.assign(P.mix.tracks[1], { lvl: -6, pan: 0 });
  Object.assign(P.mix.tracks[2], { lvl: 0, pan: 64 });
  Object.assign(P.mix.tracks[3], { lvl: -6, pan: -32 });
  const out = await S4.s4p.build(P);
  const r = await fetch('/upload/S4T_VERIFY2.zip', { method: 'PUT', body: S4.zip.write(out.files) });
  window._verify2 = { modes: MODES, follow: FOLLOW };
  return { upload: await r.text(), scenes: Object.keys(S).length, warnings: out.warnings };
})();
