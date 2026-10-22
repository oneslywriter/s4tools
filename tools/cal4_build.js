// "S4T CAL4": the CC curves Live still lacks (follow.js), for the material per tempo / speed mode, the
// mixer and the macros. Built with the current exporter; run in the app page like verify_build.js; uploads
// /upload/S4T_CAL4.zip. The samples are a quiet 220 Hz sine, 4 s = 8 beats at 120 BPM. Effects bypassed.
//   scenes 1-8    T1, T2 DISC SYNC (grid 1/4) · T3 TAPE (SPEED mode OCTAVES) · T4 POLY (PITCH CHROMATIC)
//   scenes 9-16   T1, T2 DISC SYNC (grid 1/4) · T3 TAPE (SPEED FREE) · T4 POLY (PITCH FREE)
//   scenes 17-24  T1, T2 DISC AS RECORDED · T3, T4 DISC SYNC (grid 1/16)
//   scenes 25-28  T1, T2 DISC AS RECORDED · T3 TAPE (SPEED CHROMATIC) · T4 DISC STRETCH (by the S-4)
//   scenes 29-32  T1, T2 DISC AS RECORDED · T3, T4 DISC STRETCH
// TAPE and POLY share 36 sample buffers per project: these use exactly 36. Which CC each track gets where:
// cal4_send.js (one parameter per track, or two that don't affect each other).
// cal4_send.js then sets the CCs scene by scene; cal4_fit.py reads the saved project.json.
(async () => {
  const SR = 48000;
  const wav = x => {
    const v = new DataView(new ArrayBuffer(44 + x.length * 2));
    const s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, x.length * 2, true);
    x.forEach((y, i) => v.setInt16(44 + i * 2, Math.round(y * 32767), true));
    return v.buffer;
  };
  const file = 'CAL4_sine220.wav', id = 'CAL4_' + file;
  await S4.idb.put({ id, name: file, folder: '', bytes: wav(Float32Array.from({ length: 4 * SR }, (_, i) => 0.03 * Math.sin(2 * Math.PI * 220 * i / SR))), type: 'audio/wav' });
  const SMP = { id, file, name: 'CAL4_sine220', folder: '', bpm: 120, bpmSrc: 'user', key: null, dur: null };

  const P = S4.cr.make.project();
  P.name = 'S4T CAL4';
  P.bpm = 120;
  const DEVS = ['MOSAIC', 'RING', 'DEFORM', 'VAST'];
  const defaults = d => S4.params.defaults(S4.params.DEV[d].params);
  const OFF = () => Object.fromEntries(DEVS.map(d => [d, { on: false, n: defaults(d) }]));
  const base = o => Object.assign({ sample: Object.assign({}, SMP), fx: OFF() }, o);
  const disc = o => base(Object.assign({ device: 'DISC', tempo: 'sync', grid: '1/4', start: 0, length: null }, o));
  const tape = mode => base({ device: 'TAPE', tempo: 'recorded', tspMode: mode, speed: 0, length: null });
  const poly = mode => base({ device: 'POLY', tempo: 'recorded', pitch: 0, pitchMode: mode, pStart: 0, pLen: 100, loopMode: 'off' });
  const asRec = () => disc({ tempo: 'recorded', dspMode: 'free', speedSt: 0 }), str = () => disc({ tempo: 'stretch', warp: 's4' });
  const groups = [
    [8, () => [disc({}), disc({}), tape(''), poly('')]],
    [8, () => [disc({}), disc({}), tape('free'), poly('free')]],
    [8, () => [asRec(), asRec(), disc({ grid: '1/16' }), disc({ grid: '1/16' })]],
    [4, () => [asRec(), asRec(), tape('chromatic'), str()]],
    [4, () => [asRec(), asRec(), str(), str()]],
  ];
  let i = 0;
  for (const [n, make] of groups) for (let k = 0; k < n; k++, i++) {
    const sc = S4.cr.make.scene();
    sc.name = 'CAL4 ' + (i + 1);
    make().forEach((o, t) => o && Object.assign(sc.tracks[t], o));
    P.scenes[i] = sc;
  }
  const out = await S4.s4p.build(P);
  const r = await fetch('/upload/S4T_CAL4.zip', { method: 'PUT', body: S4.zip.write(out.files) });
  return { upload: await r.text(), warnings: out.warnings, scenes: i, files: out.files.length };
})();
