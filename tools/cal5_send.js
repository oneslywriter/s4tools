// Sets the values for S4T CAL5 (cal5_build.js): each scene's four TAPE LENGTHs (CC 49 on channels 1-4), 36 CCs
// spread over 0-127, then the eight macros (channel 15, CC 46-53), and back to scene 1. Run in the app page with
// the S-4 stopped on the project; then save on the S-4. Uploads the plan as /upload/cal5_plan.json.
(async () => {
  const M = S4.midi;
  if (!M.connected()) throw new Error('no S-4 MIDI output');
  const length = Array.from({ length: 36 }, (_, k) => Math.round((k * 127) / 35)); // scene s, track t: k = 4s + t
  // macros 1-4 UNIPOLAR, 5-6 BIPOLAR, 7-8 without routings
  const macros = [0, 32, 64, 96, 32, 96, 32, 96];
  const pc = M.settings.pcCh, sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let s = 0; s < 9; s++) {
    M.pc(pc, s);
    await sleep(700);
    M.sendBatch([0, 1, 2, 3].map(t => [0xB0 | t, 49, length[4 * s + t]]));
    await sleep(200);
  }
  M.sendBatch(macros.map((v, k) => [0xB0 | 14, 46 + k, v]));
  await sleep(300);
  M.pc(pc, 0);
  const plan = { bpm: 90, length, macros };
  await fetch('/upload/cal5_plan.json', { method: 'PUT', body: JSON.stringify(plan) });
  return plan;
})();
