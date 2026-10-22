// "S4T VERIFY5": VAST TIME STRAIGHT / FREE / long steps, app-written WAVE modulators and routings, DISC LOOP /
// FREEZE, scale modes in the scene active at load, and a few mode names to read on the screen. Built with the
// current exporter; run in the app page like verify_build.js; uploads /upload/S4T_VERIFY5.zip. S-4 scenes:
//   1, 2  DISC SPEED MAJOR +4 / MINOR -4, MOSAIC PITCH MINOR -4, DISC AS RECORDED SPEED FREE +2 (scene 1 is the one
//         active at load, scene 2 the same as a control)
//   3     VAST TIME 'straight' 8 / 9 / 5 and FREE 2 Hz on a single click (feedback 0)
//   4     VAST TIME 'straight' 4 / 3 and '' (dotted) 4 / 3 on a single click 16 s long
//   5     MOD 1 WAVE -> DISC SPEED (bipolar 0.1) on the sine: SHAPE 0 / 1 / 2 at RATE 7, SHAPE 0 at FREE 1.5 Hz
//   6     the same SHAPE 0, RATE 7: bipolar +0.1 / unipolar +0.1 / bipolar -0.1, and RATE 7 DOTTED
//   7     DISC LOOP off / on on the click; FREEZE on the beats sample at freeze_position 1152 and 105600
//   8     to read on the screen: DEFORM TILT and RING DECAY in their default mode (''), VAST TIME 'straight' 8
(async () => {
  const P = S4.cr.make.project();
  P.name = 'S4T VERIFY5';
  P.bpm = 120;
  const smp = async (file) => {
    const bytes = await (await fetch('/ext/3/' + file)).arrayBuffer();
    const id = 'VERIFY_' + file;
    await S4.idb.put({ id, name: file, folder: '', bytes, type: 'audio/wav' });
    return { id, file, name: file.replace(/\.wav$/, ''), folder: '', bpm: 120, bpmSrc: 'user', key: null, dur: null };
  };
  const SINE = await smp('VERIFY_sine440.wav'), CLICK = await smp('VERIFY_click8.wav'), CLICK16 = await smp('VERIFY_click16.wav'),
    SIG = await smp('VERIFY_sig120.wav');
  const DEVS = ['MOSAIC', 'RING', 'DEFORM', 'VAST'];
  const defaults = d => S4.params.defaults(S4.params.DEV[d].params);
  const OFF = () => Object.fromEntries(DEVS.map(d => [d, { on: false, n: defaults(d) }]));
  const ON = (d, n, md) => ({ on: true, n: Object.assign(defaults(d), n || {}), md: md || {} });
  const track = (s, o) => Object.assign({ device: 'DISC', tempo: 'sync', sample: Object.assign({}, s), grid: '1/4', start: 0, length: null, fx: OFF() }, o);
  const withFx = (s, dev, n, md, o) => track(s, Object.assign({ fx: Object.assign(OFF(), { [dev]: ON(dev, n, md) }) }, o));
  const vast = (s, time, mode) => withFx(s, 'VAST', { delay_wet: 0.5, feedback: 0, time }, mode ? { time: mode } : {});
  const free = () => track(SINE, { tempo: 'recorded', dspMode: 'free', speedSt: 0 });
  // MOD 1 = WAVE (shape, rate, rate mode) routed to DISC SPEED
  const wave = (tr, { shape = 0, rate = 7, mode = '', amount = 0.1, uni = false } = {}) => {
    const blk = S4.s4p.block(tr, 'modulator1');
    for (const k of Object.keys(blk)) delete blk[k];
    blk.selected = S4.params.MOD.WAVE.selected;
    const w = S4.mods.ensure(blk, 0);
    w.rate = { value: rate, mode };
    w.shape = { value: shape };
    S4.mods.setRoute(S4.s4p.block(tr, 'modulator_mappings'), ['material', 'disc', 'speed'], '0', amount, uni ? 1 : 0);
    return tr;
  };
  const modes = () => [track(SINE, { dspMode: 'major', speedSt: 4 }), track(SINE, { dspMode: 'minor', speedSt: -4 }),
    withFx(SINE, 'MOSAIC', { pitch: -4 }, { pitch: 'minor' }), track(SINE, { tempo: 'recorded', dspMode: 'free', speedSt: 2 })];
  const S = [
    modes(),
    modes(),
    [vast(CLICK, 8, 'straight'), vast(CLICK, 9, 'straight'), vast(CLICK, 5, 'straight'), vast(CLICK, 2, 'free')],
    [vast(CLICK16, 4, 'straight'), vast(CLICK16, 3, 'straight'), vast(CLICK16, 4), vast(CLICK16, 3)],
    [wave(free(), { shape: 0 }), wave(free(), { shape: 1 }), wave(free(), { shape: 2 }), wave(free(), { mode: 'free', rate: 1.5 })],
    [wave(free()), wave(free(), { uni: true }), wave(free(), { amount: -0.1 }), wave(free(), { mode: 'dotted' })],
    [track(CLICK, { ex: { mat: { disc: { loop: 0 } } } }), track(CLICK, { ex: { mat: { disc: { loop: 1 } } } }),
      track(SIG, { ex: { mat: { disc: { freeze: 1 } } } }), track(SIG, { ex: { mat: { disc: { freeze: 1 } } } })],
    [withFx(SINE, 'DEFORM'), withFx(SINE, 'RING'), vast(CLICK, 8, 'straight'), wave(free(), { shape: 1 })],
  ];
  S.forEach((tracks, i) => {
    const sc = S4.cr.make.scene();
    sc.name = 'VERIFY5 ' + (i + 1);
    tracks.forEach((o, t) => Object.assign(sc.tracks[t], o));
    P.scenes[i] = sc;
  });
  const out = await S4.s4p.build(P);
  // freeze_position has no editor in the app: set it in the written project
  const pj = out.files.find(f => f.name.endsWith('project.json'));
  const doc = JSON.parse(pj.data);
  doc.data.scenes['6'].tracks[2].material.disc.freeze_position = 1152;
  doc.data.scenes['6'].tracks[3].material.disc.freeze_position = 105600;
  pj.data = JSON.stringify(doc);
  const r = await fetch('/upload/S4T_VERIFY5.zip', { method: 'PUT', body: S4.zip.write(out.files) });
  return { upload: await r.text(), warnings: out.warnings };
})();
