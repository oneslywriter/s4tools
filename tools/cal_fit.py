"""Read a saved calibration project (scene s, track t got CC value round((s*4+t)*127/31) on every GRANULAR /
FILTER / COLOR parameter) and describe each parameter's CC -> stored value mapping.
usage: cal_fit.py project.json out.json"""
import json, math, sys

PARAMS = {
    'granular.mosaic': {62: 'pitch', 63: 'rate', 64: 'size', 65: 'contour', 66: 'scan', 67: 'spray', 68: 'pattern', 69: 'wet',
                        70: 'rand_pitch', 71: 'rand_rate', 72: 'rand_size', 73: 'rand_amp', 74: 'rand_reverse', 77: 'feedback'},
    'filter.ring': {78: 'cutoff', 79: 'resonance', 80: 'decay', 81: 'pitch', 82: 'slope', 83: 'tone', 84: 'scale', 85: 'wet',
                    86: 'waves', 87: 'noise', 88: 'tilt', 89: 'detune', 90: 'waves_rate', 91: 'noise_rate'},
    'color.deform': {94: 'drive', 95: 'compress', 96: 'crush', 97: 'tilt', 98: 'noise', 99: 'noise_decay', 100: 'noise_color', 101: 'wet'},
}
d = json.load(open(sys.argv[1], encoding='utf-8'))
d = d.get('data', d)
cc_of = lambda k: round(k * 127 / 31)
out, missing, extra_keys = {}, [], {}
for block, params in PARAMS.items():
    slot, dev = block.split('.')
    for cc, key in params.items():
        pts, modes = [], set()
        for s in range(8):
            sc = d['scenes'].get(str(s))
            if not sc:
                missing.append(f'scene {s}')
                continue
            for t in range(4):
                b = sc['tracks'][t].get(slot, {}).get(dev)
                if not b or key not in b:
                    missing.append(f'{block}.{key} s{s} t{t}')
                    continue
                v = b[key]
                pts.append((cc_of(s * 4 + t), v['value'] if isinstance(v, dict) else v))
                if isinstance(v, dict) and 'mode' in v: modes.add(v['mode'])
        pts.sort()
        ys = [p[1] for p in pts]
        ints = all(isinstance(y, int) or (isinstance(y, float) and abs(y - round(y)) < 1e-6) for y in ys)
        # straight line through the ends, and how far the points are from it
        lin_err = None
        if pts and pts[-1][0] != pts[0][0]:
            a, b = pts[0], pts[-1]
            lin_err = max(abs(y - (a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))) for x, y in pts)
        out[f'{block}.{key}'] = {'cc': cc, 'points': pts, 'modes': sorted(modes), 'integer': ints, 'lin_err': lin_err}
        span = f'{ys[0]:g}..{ys[-1]:g}' if ys else '-'
        print(f'{block}.{key:13} CC{cc:3d}  {span:24} modes {sorted(modes)}  {"STEPPED" if ints else "continuous"}  max dev from line {lin_err:.4g}' if lin_err is not None else f'{block}.{key} no data')
# every key the S-4 wrote in these blocks (to reproduce the structure on export)
for block in PARAMS:
    slot, dev = block.split('.')
    b = d['scenes']['0']['tracks'][0].get(slot, {})
    extra_keys[block] = {'block_keys': list(b.keys()), 'device_keys': list(b.get(dev, {}).keys()), 'example': b}
json.dump({'params': out, 'structure': extra_keys, 'missing': missing}, open(sys.argv[2], 'w'), indent=1)
print('missing:', len(missing), missing[:10])
