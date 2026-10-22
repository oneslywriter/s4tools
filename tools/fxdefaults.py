"""Tally every effect parameter value across S-4 projects; the most common value is usually the S-4's default.
usage: fxdefaults.py <folder with *.s4project folders>"""
import collections, glob, json, sys

vals = collections.defaultdict(collections.Counter)
files = glob.glob(sys.argv[1] + '/**/project.json', recursive=True)
for fn in files:
    try:
        d = json.load(open(fn, encoding='utf-8'))['data']
    except Exception:
        continue
    for sc in d.get('scenes', {}).values():
        for t in sc.get('tracks', []):
            for slot, key in (('granular', 'mosaic'), ('filter', 'ring'), ('color', 'deform'), ('space', 'vast')):
                b = (t.get(slot) or {}).get(key)
                if not b:
                    continue
                for k, v in b.items():
                    if isinstance(v, dict) and isinstance(v.get('value'), (int, float)):
                        vals[f'{key}.{k}'][round(v['value'], 4)] += 1
print(len(files), 'projects')
for k in sorted(vals):
    print(k, vals[k].most_common(4))
