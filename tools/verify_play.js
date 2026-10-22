// Plays S4T VERIFY on the S-4 over MIDI, for recording (record10.ps1) and verify_analyze.py. The S-4 must be
// stopped. Per scene: program change while stopped, START (note 24, ch 16), 6 s, STOP, 1.6 s of silence.
// POLY notes: scene 6 T3 / T4 (ch 3 / 4) and scene 7 T1 (ch 1), note 60 from 0.5 s to 5 s into the scene.
// Run in the app page: eval(await (await fetch('/tools/verify_play.js')).text()).
(async () => {
  const M = S4.midi;
  if (!M.connected()) throw new Error('no S-4 MIDI output');
  const pc = M.settings.pcCh, PLAY = 6000, GAP = 1600, t0 = performance.now() + 500;
  const tap = ts => { M.send([0x9F, 24, 127], ts); M.send([0x8F, 24, 0], ts + 40); };
  const note = (ch, n, on, off) => { M.send([0x90 | (ch - 1), n, 100], on); M.send([0x80 | (ch - 1), n, 0], off); };
  for (let s = 0; s < 10; s++) {
    const t = t0 + s * (PLAY + GAP);
    M.send([0xC0 | (pc - 1), s], t);
    tap(t + 500);
    if (s === 5) { note(3, 60, t + 1000, t + 5500); note(4, 60, t + 1000, t + 5500); }
    if (s === 6) note(1, 60, t + 1000, t + 5500);
    tap(t + 500 + PLAY);
  }
  window._playEnd = t0 + 10 * (PLAY + GAP);
  return { seconds: Math.round((window._playEnd - performance.now()) / 100) / 10 };
})();
