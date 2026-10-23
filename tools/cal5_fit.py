"""Analyse the saved S4T CAL5 (cal5_build.js, cal5_send.js): TAPE LENGTH at 90 BPM against three models (the
120 BPM curve of 1-15 bars; whole bars up to the whole bars 30 s hold; whole bars up to the 30 s itself, which
fits), and the macros with routings against -1 + 2x and x.
usage: cal5_fit.py project.json cal5_plan.json"""
import json, math, sys

d = json.load(open(sys.argv[1], encoding='utf-8'))['data']
plan = json.load(open(sys.argv[2], encoding='utf-8'))
bpm = d['tempo']
B = 30 * bpm / 240  # the bars a TAPE's 30 s hold at this tempo
models = {
    '1-15 bars (as at 120 BPM)': lambda c: 4 * (1 + round(14 * c / 127)),
    f'1-{math.floor(B)} bars': lambda c: 4 * (1 + round((math.floor(B) - 1) * c / 127)),
    f'whole bars from 1 to {B:g} (30 s)': lambda c: 4 * round(1 + (B - 1) * c / 127),
}
print(f'project tempo {bpm}; TAPE LENGTH: CC -> stored (mode)')
pts = []
for k, cc in enumerate(plan['length']):
    s, t = divmod(k, 4)
    ln = d['scenes'][str(s)]['tracks'][t]['material']['tape']['length']
    pts.append((cc, ln['value']))
    print(f'  CC {cc:3d}: {ln["value"]:g} beats = {ln["value"] / 4:g} bars ({ln["mode"]})')
for name, f in models.items():
    miss = [(c, v, f(c)) for c, v in pts if abs(v - f(c)) > 1e-4]
    print(f'{name}: {"fits every point" if not miss else f"{len(miss)} misses, e.g. " + str(miss[:4])}')

perf = d['global_slots']['perform']['perform']
kinds = ['UNIPOLAR'] * 4 + ['BIPOLAR'] * 2 + ['no routing'] * 2
print('macros: CC -> stored (-1 + 2x | x)')
for k, cc in enumerate(plan['macros']):
    v = perf[f'macro{k + 1}']
    print(f'  MACRO {k + 1} ({kinds[k]}): CC {cc:3d} -> {v["value"]:.6f} mode {v.get("mode")!r}  ({-1 + 2 * cc / 127:.6f} | {cc / 127:.6f})')
