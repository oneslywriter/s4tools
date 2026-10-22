// Plays S4T VERIFY6 (verify6_build.js) over MIDI: scene 1 for 12 s, scene 2 for 70 s (START / STOP, 1.6 s
// apart), then back to scene 1. Start the recorder about 10 s before (the capture's first seconds run sharp).
// The S-4 must be stopped. Run in the app page like verify_play.js; verify6_analyze.py uses the same PLAN.
(async () => {
  const M = S4.midi;
  if (!M.connected()) throw new Error('no S-4 MIDI output');
  const PLAN = [[0, 12], [1, 70]];
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
