"""DISC tempo/speed/length mode combinations, free-tempo examples, and most common VAST values."""
import json, os, sys
from collections import Counter, defaultdict

jdir = sys.argv[1]
combo = Counter()
free = []
vast = defaultdict(Counter)
keyorder = Counter()
for f in sorted(os.listdir(jdir)):
    d = json.load(open(os.path.join(jdir, f), encoding='utf-8'))['data']
    for sk, sc in d['scenes'].items():
        for ti, tr in enumerate(sc['tracks']):
            dsc = tr.get('material', {}).get('disc')
            if dsc:
                combo[(dsc['tempo']['mode'], dsc['speed']['mode'], dsc['length']['mode'])] += 1
                keyorder[tuple(dsc.keys())] += 1
                if dsc['tempo']['mode'] == 'free' and len(free) < 6:
                    free.append((f[:-5], sk, ti, {k: dsc[k] for k in ('tempo', 'speed', 'start', 'length')}, dsc.get('sample_title')))
            v = tr.get('space', {}).get('vast')
            if v:
                for k, x in v.items():
                    vast[k][(round(x['value'], 4), x.get('mode'))] += 1
for k, n in combo.most_common():
    print('tempo/speed/length modes', k, n)
for x in free:
    print('FREE', x)
for k, c in vast.items():
    print('VAST', k, c.most_common(5))
for k, n in keyorder.most_common(4):
    print('DISC KEY ORDER', n, k)
