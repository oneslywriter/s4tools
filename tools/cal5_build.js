// "S4T CAL5": TAPE LENGTH at a tempo other than 120 (calibration round 4 measured 1-15 bars at 120 BPM, the
// 30 s a TAPE holds), and the macros with routings. Built with the current exporter at 90 BPM; run in the app
// page like verify_build.js; uploads /upload/S4T_CAL5.zip.
//   scenes 1-9   four TAPE tracks each (36: every sample buffer a project has), the 4 s 220 Hz sine of CAL4
//   macros       1-4 routed UNIPOLAR onto T1 PAN, 5-6 BIPOLAR onto T2 PAN, 7-8 without routings
// cal5_send.js then sets each TAPE's LENGTH (CC 49) and the macros; cal5_fit.py reads the saved project.json.
(async () => {
  const SR = 48000, BPM = 90;
  const wav = x => {
    const v = new DataView(new ArrayBuffer(44 + x.length * 2));
    const s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, x.length * 2, true);
    x.forEach((y, i) => v.setInt16(44 + i * 2, Math.round(y * 32767), true));
    return v.buffer;
  };
  const file = 'CAL5_sine220.wav', id = 'CAL5_' + file;
  await S4.idb.put({ id, name: file, folder: '', bytes: wav(Float32Array.from({ length: 4 * SR }, (_, i) => 0.03 * Math.sin(2 * Math.PI * 220 * i / SR))), type: 'audio/wav' });
  const SMP = { id, file, name: 'CAL5_sine220', folder: '', bpm: 120, bpmSrc: 'user', key: null, dur: 4 };

  const P = S4.cr.make.project();
  P.name = 'S4T CAL5';
  P.bpm = BPM;
  const DEVS = ['MOSAIC', 'RING', 'DEFORM', 'VAST'];
  const OFF = () => Object.fromEntries(DEVS.map(d => [d, { on: false, n: S4.params.defaults(S4.params.DEV[d].params) }]));
  const tape = () => ({ sample: Object.assign({}, SMP), fx: OFF(), device: 'TAPE', tempo: 'recorded', tspMode: '', speed: 0, length: null });
  for (let i = 0; i < 9; i++) {
    const sc = S4.cr.make.scene();
    sc.name = 'CAL5 ' + (i + 1);
    sc.tracks.forEach(t => Object.assign(t, tape()));
    P.scenes[i] = sc;
  }
  const route = mode => ({ value: 0.5, mode });
  const g = S4.s4p.global(P);
  g.mix_mappings = { mix: { mix: {
    pan1: { 0: route(1), 1: route(1), 2: route(1), 3: route(1) },
    pan2: { 4: route(0), 5: route(0) },
  } } };
  const out = await S4.s4p.build(P);
  const r = await fetch('/upload/S4T_CAL5.zip', { method: 'PUT', body: S4.zip.write(out.files) });
  return { upload: await r.text(), warnings: out.warnings, files: out.files.length, mix_mappings: JSON.parse(out.files[0].data).data.global_slots.mix_mappings };
})();
