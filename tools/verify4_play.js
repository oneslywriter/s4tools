// Plays S4T VERIFY4 (verify4_build.js) over MIDI: scenes 1-15 in order, START 6 s STOP, 1.6 s apart, then back
// to scene 1. The S-4 must be stopped. Run in the app page like verify_play.js.
(async () => {
  const M = S4.midi;
  if (!M.connected()) throw new Error('no S-4 MIDI output');
  const SCENES = Array.from({ length: 15 }, (_, k) => k);
  const pc = M.settings.pcCh, PLAY = 6000, GAP = 1600, t0 = performance.now() + 500;
  const tap = ts => { M.send([0x9F, 24, 127], ts); M.send([0x8F, 24, 0], ts + 40); };
  SCENES.forEach((s, k) => {
    const t = t0 + k * (PLAY + GAP);
    M.send([0xC0 | (pc - 1), s], t);
    tap(t + 500);
    tap(t + 500 + PLAY);
  });
  M.send([0xC0 | (pc - 1), 0], t0 + SCENES.length * (PLAY + GAP));
  window._playEnd = t0 + SCENES.length * (PLAY + GAP) + 500;
  return { scenes: SCENES.map(s => s + 1), seconds: Math.round((window._playEnd - performance.now()) / 100) / 10 };
})();
