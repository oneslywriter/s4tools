// Sets the CCs for S4T CAL4 (cal4_build.js) scene by scene: program change, a pause for the scene to load, then
// that scene's CCs; finally the mixer and the macros (project-wide), and back to scene 1. Run in the app page
// with the S-4 stopped on the project; then save on the S-4. cal4_fit.py uses the same plan.
// window._cal4 = the plan, for the fit: { scenes: [[track, cc, value], ...] per scene, mix: [[ch, cc, value]] }
(async () => {
  const M = S4.midi;
  if (!M.connected()) throw new Error('no S-4 MIDI output');
  const c8 = j => Math.round((j * 127) / 7), c4 = j => Math.round((j * 127) / 3);
  // [track (0-3), CCs, value] per scene; see cal4_build.js for the devices
  const plan = [];
  for (let s = 0; s < 32; s++) {
    const g = Math.floor(s / 8), j = s % 8, v = c8(j), row = [];
    if (g === 0) row.push([0, [46], v], [1, [48], v], [2, [46, 50], v], [3, [46, 48], v]);
    if (g === 1) row.push([0, [47], v], [1, [49], v], [2, [46, 49], v], [3, [46, 49], v]);
    if (g === 2) row.push([0, [46], v], [1, [48], v], [2, [48], v], [3, [49], v]);
    if (g === 3) row.push([0, [47], v], [1, [49], v], j < 4 ? [2, [46], c4(j)] : [2, [47], c4(j - 4)], [3, [46], v]);
    plan.push(row.flatMap(([t, ccs, val]) => ccs.map(cc => [t, cc, val])));
  }
  // mixer (ch 16): LEVEL 46-49, FILTER 50-53, PAN 54-57 at 4 values each, COMPRESS 58; macros 1-8 (ch 15, CC 46-53)
  const four = [0, 64, 100, 127], eight = [0, 18, 36, 54, 73, 91, 109, 127];
  const mix = [];
  four.forEach((v, t) => mix.push([16, 46 + t, v], [16, 50 + t, [0, 32, 96, 127][t]], [16, 54 + t, [0, 32, 96, 127][t]]));
  mix.push([16, 58, 64]);
  eight.forEach((v, k) => mix.push([15, 46 + k, v]));
  window._cal4 = { scenes: plan, mix };
  const pc = M.settings.pcCh, sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let s = 0; s < 32; s++) {
    M.pc(pc, s);
    await sleep(700);
    M.sendBatch(plan[s].map(([t, cc, v]) => [0xB0 | t, cc, v]));
    await sleep(200);
  }
  M.sendBatch(mix.map(([ch, cc, v]) => [0xB0 | (ch - 1), cc, v]));
  await sleep(300);
  M.pc(pc, 0);
  await fetch('/upload/cal4_plan.json', { method: 'PUT', body: JSON.stringify(window._cal4) });
  return { scenes: plan.length, ccs: plan.reduce((a, r) => a + r.length, 0) + mix.length };
})();
