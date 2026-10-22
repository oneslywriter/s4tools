"""For each project.json: every non-empty mode string per parameter (scene/track indices folded),
every `selected` value per slot, and the settings / global blocks that are not scene data.
usage: modes_seen.py a.json [b.json ...]"""
import json, re, sys
from collections import defaultdict

for fn in sys.argv[1:]:
    d = json.load(open(fn, encoding='utf-8'))['data']
    modes, sel = defaultdict(set), defaultdict(set)

    def walk(o, path):
        if isinstance(o, dict):
            if 'mode' in o and isinstance(o.get('mode'), str) and o['mode']:
                modes[re.sub(r'\.\d+\.tracks\[\d\]', '', path)].add((o['mode'], o.get('value') if not isinstance(o.get('value'), float) else round(o['value'], 3)))
            for k, v in o.items():
                if k == 'selected' and not isinstance(v, (dict, list)):
                    sel[re.sub(r'scenes\.\d+\.tracks\[\d\]', 'track', path)].add(v)
                walk(v, f'{path}.{k}' if path else k)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f'{path}[{i}]')

    walk(d, '')
    print(f'===== {fn}')
    print('-- modes')
    for k in sorted(modes):
        print(f'  {k}: {sorted(modes[k], key=str)}')
    print('-- selected')
    for k in sorted(sel):
        print(f'  {k}: {sorted(sel[k])}')
    print('-- scenes present:', sorted(d['scenes'], key=int), ' selected_scene:', d.get('selected_scene'))
    print('-- settings:', json.dumps(d.get('settings'), indent=None))
    g = d.get('global_slots', {})
    for k in sorted(g):
        if k in ('track_mappings',):
            continue
        s = json.dumps(g[k])
        print(f'-- global_slots.{k}: {s[:1500]}')
    print('-- other top-level keys:', [k for k in d if k not in ('scenes', 'settings', 'global_slots')])
    for k in d:
        if k not in ('scenes', 'settings', 'global_slots'):
            print(f'   {k} = {json.dumps(d[k])[:300]}')
