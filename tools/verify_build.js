// Builds "S4T VERIFY" with the app's own export (S4.s4p.build) from the samples of verify_gen.py, served by
// the dev server as /ext/3/. Run in the app page: eval(await (await fetch('/tools/verify_build.js')).text()).
// Uploads the zipped project to /upload/S4T_VERIFY.zip (tools/uploads). Every track has its effects
// bypassed unless the test is about them. The expectations are in verify_analyze.py (same scene list).
(async () => {
  const P = S4.cr.make.project();
  P.name = 'S4T VERIFY';
  P.bpm = 120;
  const put = async (file, bpm) => {
    const bytes = await (await fetch('/ext/3/' + file)).arrayBuffer();
    const id = 'VERIFY_' + file;
    await S4.idb.put({ id, name: file, folder: '', bytes, type: 'audio/wav' });
    return { id, file, name: file.replace(/\.wav$/, ''), folder: '', bpm, bpmSrc: 'user', key: null, dur: null, sr: null, ch: null };
  };
  const SIG120 = await put('VERIFY_sig120.wav', 120), SIG100 = await put('VERIFY_sig100.wav', 100), SINE = await put('VERIFY_sine440.wav', 120);
  const smp = s => Object.assign({}, s);
  const defaults = d => S4.params.defaults(S4.params.DEV[d].params);
  const OFF = () => Object.fromEntries(['MOSAIC', 'RING', 'DEFORM', 'VAST'].map(d => [d, { on: false, n: defaults(d) }]));
  const SEND = (n, db) => ({ track_output: { track_output: Object.fromEntries([1, 2, 3, 4].map(k => ['send' + k, { value: k === n ? db : -100, mode: '' }])) } });
  const disc = (s, o) => Object.assign({ device: 'DISC', tempo: 'sync', sample: smp(s), grid: '1/4', start: 0, length: null, fx: OFF() }, o);
  const tape = (s, o) => Object.assign({ device: 'TAPE', tempo: 'sync', sample: smp(s), fx: OFF() }, o);
  const poly = (o) => Object.assign({ device: 'POLY', tempo: 'recorded', sample: Object.assign(smp(SINE), { bpm: null, bpmSrc: null }), fx: OFF() }, o);
  const empty = () => ({ device: 'DISC', fx: OFF() });
  const SCENES = [
    // 1 BASELINE: order and spacing, material LEVEL, REVERSE, the mixer on T4 (-6 dB, pan -0.5)
    [disc(SIG120), disc(SIG120, { lvl: -6 }), disc(SIG120, { ex: { mat: { disc: { reverse: 1 } } } }), disc(SIG120)],
    // 2 START / LENGTH (beats), OFFSET +0.6 s, a plain reference, AS RECORDED (FREE tempo)
    [disc(SIG120, { start: 2, length: 4 }), disc(SIG120, { mx: { DISC: { offset: 0.6 } } }), disc(SIG120), disc(SIG120, { tempo: 'recorded' })],
    // 3 DISC SPEED: +1 octave, MAJOR +4 (sine and clicks), -1 octave
    [disc(SINE, { speed: 1 }), disc(SINE, { dspMode: 'major', speedSt: 4 }), disc(SIG120, { dspMode: 'major', speedSt: 4 }), disc(SIG120, { speed: -1 })],
    // 4 DISC STRETCH by the S-4: chromatic +7, a 100 BPM loop at 120, pentatonic +5, chromatic -5 (clicks)
    [disc(SINE, { tempo: 'stretch', warp: 's4', pitchSt: 7 }), disc(SIG100, { tempo: 'stretch', warp: 's4' }),
      disc(SINE, { tempo: 'stretch', warp: 's4', pitchMode: 'pentatonic', pitchSt: 5 }), disc(SIG120, { tempo: 'stretch', warp: 's4', pitchSt: -5 })],
    // 5 a 100 BPM loop at 120: DISC SYNC, TAPE SYNC, TAPE stretched by the app, DISC stretched by the app
    [disc(SIG100), tape(SIG100), tape(SIG100, { tempo: 'stretch', warp: 'beats' }), disc(SIG100, { tempo: 'stretch', warp: 'beats' })],
    // 6 TAPE SPEED chromatic +5 and octaves -12; POLY pitch 0 (reference) and +3 (note 60 on ch 3 / ch 4)
    [tape(SINE, { tempo: 'recorded', tspMode: 'chromatic', speed: 5 }), tape(SINE, { tempo: 'recorded', tspMode: '', speed: -12 }), poly({ pitch: 0 }), poly({ pitch: 3 })],
    // 7 POLY FREE +2.5 (note 60, ch 1); DISC AS RECORDED SPEED FREE +2; DISC SYNC MINOR -4; DISC AS RECORDED +1 octave
    [poly({ pitchMode: 'free', pitch: 2.5 }), disc(SINE, { tempo: 'recorded', dspMode: 'free', speedSt: 2 }), disc(SINE, { dspMode: 'minor', speedSt: -4 }), disc(SINE, { tempo: 'recorded', speed: 1 })],
    // 8 SENDS: T1 -> T2 at -6 dB; T2 in BYPASS with its input on SENDS ONLY
    [disc(SINE, { ex: SEND(2, -6) }), { device: 'BYPASS', fx: OFF() }, empty(), empty()],
    // 9 EFFECTS: all bypassed (reference); not set (the S-4's defaults); DEFORM on with DRIVE 0.5
    [disc(SINE), disc(SINE, { fx: undefined }), disc(SINE, { fx: Object.assign(OFF(), { DEFORM: { on: true, n: Object.assign(defaults('DEFORM'), { drive: 0.5 }) } }) }), empty()],
    // 10 T4 alone: the mixer's level and pan on the master
    [empty(), empty(), empty(), disc(SINE)],
  ];
  SCENES.forEach((tracks, i) => {
    const sc = S4.cr.make.scene();
    sc.name = 'VERIFY ' + (i + 1);
    tracks.forEach((o, t) => Object.assign(sc.tracks[t], o));
    P.scenes[i] = sc;
  });
  // mixer: T4 at -6 dB, panned -0.5 (all scenes)
  Object.assign(P.mix.tracks[3], { lvl: -6, pan: -32 });
  // T2's input is SENDS ONLY (scene 8)
  S4.s4p.settings(P).audio_settings.track2_input = 3;
  // names to check on the S-4's screen: METER quantisation 0 / 1 / 2
  Object.assign(S4.s4p.settings(P).meter_settings, { track_play_quantization: 0, track_record_quantization: 1, mix_record_quantization: 2 });
  // FOLLOW INPUT names (scene 10, T1 and T2 modulators): those the S-4 keeps after a save are its own names
  const FOLLOW_INPUTS = ['input 1/2', 'input 1', 'input 2', 'track 1', 'track 2', 'track 3', 'mix', 'material'];
  FOLLOW_INPUTS.forEach((src, k) => {
    const tr = P.scenes[9].tracks[k >> 2];
    const blk = S4.s4p.block(tr, 'modulator' + ((k & 3) + 1));
    blk.selected = 2;
    S4.mods.ensure(blk, k & 3).input_level = { value: 0, mode: src };
  });
  const out = await S4.s4p.build(P);
  const zip = S4.zip.write(out.files);
  const r = await fetch('/upload/S4T_VERIFY.zip', { method: 'PUT', body: zip });
  window._verify = { P, out };
  return { upload: await r.text(), files: out.files.map(f => f.name + ' ' + f.data.length), warnings: out.warnings };
})();
