// Plays S4T VERIFY5 (verify5_build.js) over MIDI: each entry of PLAN is [scene index, seconds of play], START /
// STOP 1.6 s apart, then back to scene 1. The S-4 must be stopped. Run in the app page like verify_play.js.
// verify5_analyze.py uses the same PLAN.
(async () => {
  const M = S4.midi;
  if (!M.connected()) throw new Error('no S-4 MIDI output');
  const PLAN = window._plan || [[0, 6], [1, 6], [2, 6], [2, 6], [3, 14], [3, 14], [4, 8], [5, 8], [6, 10]]; // window._plan: a replay
  const pc = M.settings.pcCh, GAP = 1600, t0 = performance.now() + 500;
  const tap = ts => { M.send([0x9F, 24, 127], ts); M.send([0x8F, 24, 0], ts + 40); };
  let t = t0;
  for (const [s, sec] of PLAN) {
    M.send([0xC0 | (pc - 1), s], t);
    tap(t + 500);
    tap(t + 500 + sec * 1000);
    t += sec * 1000 + GAP;
  }
  M.send([0xC0 | (pc - 1), 0], t);
  window._playEnd = t + 500;
  return { plays: PLAN.map(([s, sec]) => `${s + 1}:${sec}s`), seconds: Math.round((window._playEnd - performance.now()) / 100) / 10 };
})();
