// Plays S4T VERIFY2 over MIDI (verify2_build.js). The S-4 must be stopped. Played scenes: START 6 s STOP with
// 1.6 s of silence between. Then every mode / FOLLOW scene (30-51) is selected for 0.5 s without playing, so
// the S-4 loads it; save the project afterwards and verify2_saved.py reports which names survived.
(async () => {
  const M = S4.midi;
  if (!M.connected()) throw new Error('no S-4 MIDI output');
  const PLAYED = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 19, 98, 99, 127];
  const VISIT = Array.from({ length: 22 }, (_, k) => 29 + k);
  const pc = M.settings.pcCh, PLAY = 6000, GAP = 1600, t0 = performance.now() + 500;
  const tap = ts => { M.send([0x9F, 24, 127], ts); M.send([0x8F, 24, 0], ts + 40); };
  PLAYED.forEach((s, k) => {
    const t = t0 + k * (PLAY + GAP);
    M.send([0xC0 | (pc - 1), s], t);
    tap(t + 500);
    tap(t + 500 + PLAY);
  });
  const t1 = t0 + PLAYED.length * (PLAY + GAP);
  VISIT.forEach((s, k) => M.send([0xC0 | (pc - 1), s], t1 + k * 500));
  M.send([0xC0 | (pc - 1), 0], t1 + VISIT.length * 500 + 500);
  window._playEnd = t1 + VISIT.length * 500 + 1000;
  return { played: PLAYED.map(s => s + 1), visited: VISIT.map(s => s + 1), seconds: Math.round((window._playEnd - performance.now()) / 100) / 10 };
})();
