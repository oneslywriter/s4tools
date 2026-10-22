// "S4T VERIFY6": DISC LOOP with a region shorter than the sample, and the slowest WAVE rates. Built with the
// current exporter; run in the app page like verify_build.js; uploads /upload/S4T_VERIFY6.zip. S-4 scenes:
//   1   VERIFY_sig120 (beat k: a click, then a 400 + 100 k Hz tone), DISC SYNC, grid 1/4:
//       T1 START 2 LENGTH 2, LOOP on (control); T2 START 2 LENGTH 2, LOOP off; T3 START 0 LENGTH 2, LOOP off;
//       T4 START 6 LENGTH 2 (the sample's last two beats), LOOP off
//   2   MOD 1 WAVE (shape 0) -> DISC SPEED, bipolar 0.1, on the sine as recorded: RATE 2 / 1 / 0 / 3
//       (8/1, 16/1, 32/1, 4/1 if the halving holds: 16, 32, 64, 8 s per cycle at 120 BPM)
(async () => {
  const P = S4.cr.make.project();
  P.name = 'S4T VERIFY6';
  P.bpm = 120;
  const smp = async (file) => {
    const bytes = await (await fetch('/ext/3/' + file)).arrayBuffer();
    const id = 'VERIFY_' + file;
    await S4.idb.put({ id, name: file, folder: '', bytes, type: 'audio/wav' });
    return { id, file, name: file.replace(/\.wav$/, ''), folder: '', bpm: 120, bpmSrc: 'user', key: null, dur: null };
  };
  const SINE = await smp('VERIFY_sine440.wav'), SIG = await smp('VERIFY_sig120.wav');
  const DEVS = ['MOSAIC', 'RING', 'DEFORM', 'VAST'];
  const defaults = d => S4.params.defaults(S4.params.DEV[d].params);
  const OFF = () => Object.fromEntries(DEVS.map(d => [d, { on: false, n: defaults(d) }]));
  const track = (s, o) => Object.assign({ device: 'DISC', tempo: 'sync', sample: Object.assign({}, s), grid: '1/4', start: 0, length: null, fx: OFF() }, o);
  const loop = (start, on) => track(SIG, { start, length: 2, ex: { mat: { disc: { loop: on ? 1 : 0 } } } });
  const wave = rate => {
    const tr = track(SINE, { tempo: 'recorded', dspMode: 'free', speedSt: 0 });
    const blk = S4.s4p.block(tr, 'modulator1');
    blk.selected = S4.params.MOD.WAVE.selected;
    const w = S4.mods.ensure(blk, 0);
    w.rate = { value: rate, mode: '' };
    w.shape = { value: 0 };
    S4.mods.setRoute(S4.s4p.block(tr, 'modulator_mappings'), ['material', 'disc', 'speed'], '0', 0.1, 0);
    return tr;
  };
  const S = [
    [loop(2, true), loop(2, false), loop(0, false), loop(6, false)],
    [wave(2), wave(1), wave(0), wave(3)],
  ];
  S.forEach((tracks, i) => {
    const sc = S4.cr.make.scene();
    sc.name = 'VERIFY6 ' + (i + 1);
    tracks.forEach((o, t) => Object.assign(sc.tracks[t], o));
    P.scenes[i] = sc;
  });
  const out = await S4.s4p.build(P);
  const r = await fetch('/upload/S4T_VERIFY6.zip', { method: 'PUT', body: S4.zip.write(out.files) });
  return { upload: await r.text(), warnings: out.warnings };
})();
