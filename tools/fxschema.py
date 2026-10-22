"""Schema of the effect blocks (granular / filter / color / space) across saved S-4 project.json copies:
the device keys under each block, every parameter's value range and modes, and how often each appears.
usage: fxschema.py dir"""
import glob, json, os, sys
from collections import defaultdict

stats = defaultdict(lambda: {'n': 0, 'min': None, 'max': None, 'modes': set(), 'types': set()})
blocks = defaultdict(int)
examples = {}
for path in glob.glob(os.path.join(sys.argv[1], '*.json')):
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception:
        continue
    d = d.get('data', d)
    for sk, sc in (d.get('scenes') or {}).items():
        for t, tr in enumerate(sc.get('tracks') or []):
            for slot in ('granular', 'filter', 'color', 'space'):
                b = tr.get(slot)
                if not isinstance(b, dict):
                    continue
                blocks[(slot, tuple(sorted(b.keys())))] += 1
                for dev, params in b.items():
                    if not isinstance(params, dict):
                        stats[(slot, dev, '(value)')]['types'].add(type(params).__name__)
                        continue
                    examples.setdefault((slot, dev), (os.path.basename(path), sk, t, params))
                    for k, v in params.items():
                        s = stats[(slot, dev, k)]
                        s['n'] += 1
                        if isinstance(v, dict):
                            val = v.get('value')
                            if 'mode' in v:
                                s['modes'].add(str(v['mode']))
                        else:
                            val = v
                        s['types'].add(type(val).__name__)
                        if isinstance(val, (int, float)) and not isinstance(val, bool):
                            s['min'] = val if s['min'] is None else min(s['min'], val)
                            s['max'] = val if s['max'] is None else max(s['max'], val)

print('block shapes:')
for (slot, keys), n in sorted(blocks.items()):
    print(f'  {slot}: {list(keys)} x{n}')
print()
for (slot, dev, k), s in sorted(stats.items()):
    rng = f"{s['min']}..{s['max']}" if s['min'] is not None else ''
    print(f"{slot}.{dev}.{k}: n={s['n']} {rng} types={sorted(s['types'])} modes={sorted(s['modes'])}")
print()
for (slot, dev), (f, sk, t, params) in sorted(examples.items()):
    print(f'example {slot}.{dev} ({f} scene {sk} T{t + 1}): ' + json.dumps(params)[:900])
