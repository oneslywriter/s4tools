"""For each calibrated field: how far it is from a straight line, and its CC -> value points when it is not
straight. Also prints MOD 4's stored block. usage: cal2_curves.py fit_r2.json saved_r2.json"""
import json, sys

fit = json.load(open(sys.argv[1]))
raw = json.load(open(sys.argv[2], encoding='utf-8'))['data']
print('MOD 4 block (scene 1, T1):', json.dumps(raw['scenes']['0']['tracks'][0].get('modulator4'))[:400])
print('MOD 3 block (scene 1, T1):', json.dumps(raw['scenes']['0']['tracks'][0].get('modulator3'))[:400])
print()
seen = set()
for field, groups in sorted(fit.items()):
    for g, r in groups.items():
        if 'points' not in r:
            continue
        key = field if field.startswith(('space.', 'modulator')) else field + ' / ' + g
        if field.startswith(('space.', 'modulator')) and field in seen:
            continue
        seen.add(field)
        pts = r['points']
        a, b = pts[0], pts[-1]
        dev = max(abs(y - (a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))) for x, y in pts) if b[0] != a[0] else 0
        span = abs(b[1] - a[1]) or 1
        if dev / span < 1e-5:
            print(f'{key:45} LINEAR {a[1]:g} .. {b[1]:g}')
        else:
            print(f'{key:45} {a[1]:g} .. {b[1]:g}  (dev {dev / span:.1%})  ' + ' '.join(f'{x}:{y:.6g}' for x, y in pts))
