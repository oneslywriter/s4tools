// "S4T VERIFY4": the last open points. Built with the current exporter (every effect / modulator slot written
// out). Run in the app page like verify_build.js; uploads /upload/S4T_VERIFY4.zip. S-4 scene numbers:
//   1   VAST delay TIME steps 5 / 6 / 7 / 8 (T1-T4) on a single click: the echo's distance is the note length
//   2   VAST TIME steps 9 / 10 / 11, and step 8 TRIPLET
//   3   MOSAIC PITCH on the 440 Hz sine: chromatic +7, MINOR -4, FIFTHS (default) +7, and 0
//   4, 6, 8, 10, 12, 14   all four tracks on the sine at 0 / +4 / +7 / +12 st (the scene before each test)
//   5, 7, 9, 11, 13, 15   T4 alone at +2 st, T1 / T2 with VERIFY's scene 10 FOLLOW blocks in six variants
// The mixer pans T1-T4 at +1/64, +6/64, +0.25, -0.25 (read on the tracks' own returns in scenes 4 ...).
// METER quantisation 3 / 4 / 5 to read on the S-4's screen.
(async () => {
  const P = S4.cr.make.project();
  P.name = 'S4T VERIFY4';
  P.bpm = 120;
  const smp = async (file) => {
    const bytes = await (await fetch('/ext/3/' + file)).arrayBuffer();
    const id = 'VERIFY_' + file;
    await S4.idb.put({ id, name: file, folder: '', bytes, type: 'audio/wav' });
    return { id, file, name: file.replace(/\.wav$/, ''), folder: '', bpm: 120, bpmSrc: 'user', key: null, dur: null };
  };
  const SINE = await smp('VERIFY_sine440.wav'), CLICK = await smp('VERIFY_click8.wav');
  const DEVS = ['MOSAIC', 'RING', 'DEFORM', 'VAST'];
  const defaults = d => S4.params.defaults(S4.params.DEV[d].params);
  const OFF = () => Object.fromEntries(DEVS.map(d => [d, { on: false, n: defaults(d) }]));
  const track = (s, o) => Object.assign({ device: 'DISC', tempo: 'sync', sample: Object.assign({}, s), grid: '1/4', start: 0, length: null, fx: OFF() }, o);
  const sine = st => track(SINE, { dspMode: 'chromatic', speedSt: st });
  const none = () => ({ device: 'DISC', fx: OFF() });
  const vast = (step, mode) => track(CLICK, { fx: Object.assign(OFF(), { VAST: { on: true, n: Object.assign(defaults('VAST'), { delay_wet: 0.5, feedback: 0, time: step }), md: mode ? { time: mode } : {} } }) });
  const mosaic = (pitch, mode) => track(SINE, { fx: Object.assign(OFF(), { MOSAIC: { on: true, n: Object.assign(defaults('MOSAIC'), { pitch }), md: mode ? { pitch: mode } : {} } }) });
  const S = {};
  S[0] = [vast(5), vast(6), vast(7), vast(8)];
  S[1] = [vast(9), vast(10), vast(11), vast(8, 'triplet')];
  S[2] = [mosaic(7, 'chromatic'), mosaic(-4, 'minor'), mosaic(7, ''), mosaic(0, '')];
  const FOLLOW = [
    { T1: ['in1/in2', 'in1', 'in2', 'track 1'], T2: ['track 2', 'track 3', 'mix', ''] }, // valid names
    { T1: ['input 1/2', 'input 1', 'input 2', 'track 1'] },                            // VERIFY's T1 only
    { T2: ['track 2', 'track 3', 'mix', 'material'] },                                 // VERIFY's T2 only
    { T2: ['material'] },
    { T1: ['input 1/2', 'input 1'] },
    { T1: [null, 'input 1'] },                                                         // MOD 2 only
  ];
  FOLLOW.forEach((v, k) => {
    S[3 + 2 * k] = [sine(0), sine(4), sine(7), sine(12)];
    S[4 + 2 * k] = [none(), none(), none(), sine(2)];
  });
  for (const [i, tracks] of Object.entries(S)) {
    const sc = S4.cr.make.scene();
    sc.name = 'VERIFY4 ' + (+i + 1);
    tracks.forEach((o, t) => Object.assign(sc.tracks[t], o));
    P.scenes[+i] = sc;
  }
  FOLLOW.forEach((v, k) => {
    for (const [tn, list] of Object.entries(v)) {
      const tr = P.scenes[4 + 2 * k].tracks[tn === 'T1' ? 0 : 1];
      list.forEach((src, n) => {
        if (src === null) return;
        const blk = S4.s4p.block(tr, 'modulator' + (n + 1));
        blk.selected = 2;
        delete blk.random; delete blk.wave;
        S4.mods.ensure(blk, n).input_level = { value: 0, mode: src };
      });
    }
  });
  Object.assign(P.mix.tracks[0], { lvl: 0, pan: 1 });
  Object.assign(P.mix.tracks[1], { lvl: 0, pan: 6 });
  Object.assign(P.mix.tracks[2], { lvl: 0, pan: 16 });
  Object.assign(P.mix.tracks[3], { lvl: 0, pan: -16 });
  Object.assign(S4.s4p.settings(P).meter_settings, { track_play_quantization: 3, track_record_quantization: 4, mix_record_quantization: 5 });
  const out = await S4.s4p.build(P);
  const r = await fetch('/upload/S4T_VERIFY4.zip', { method: 'PUT', body: S4.zip.write(out.files) });
  return { upload: await r.text(), warnings: out.warnings };
})();
