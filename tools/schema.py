"""Map the S-4 project.json schema across many projects (reads copies in s4proj/)."""
import json, os, re, sys
from collections import defaultdict

root = sys.argv[1]
paths = defaultdict(lambda: {'types': set(), 'n': 0, 'min': None, 'max': None, 'ex': set(), 'files': set()})


def norm(p):
    # scenes.<n> -> scenes.#, list indices -> []
    p = re.sub(r'^data\.scenes\.\d+', 'data.scenes.#', p)
    return re.sub(r'\.\d+(?=\.|$)', '.[]', p)


def walk(o, p, f):
    if isinstance(o, dict):
        if not o:
            rec(p, '{}', f)
        for k, v in o.items():
            walk(v, f'{p}.{k}' if p else k, f)
    elif isinstance(o, list):
        if o and all(isinstance(x, (int, float)) for x in o):
            rec(p, f'list[num]x{len(o)}', f)
            return
        rec(p, f'list x{len(o)}', f)
        for i, v in enumerate(o):
            walk(v, f'{p}.{i}', f)
    else:
        rec(p, o, f)


def rec(p, v, f):
    r = paths[norm(p)]
    r['n'] += 1
    r['files'].add(f)
    if isinstance(v, bool):
        r['types'].add('bool'); r['ex'].add(str(v))
    elif isinstance(v, (int, float)):
        r['types'].add('num')
        r['min'] = v if r['min'] is None else min(r['min'], v)
        r['max'] = v if r['max'] is None else max(r['max'], v)
    elif isinstance(v, str) and v in ('{}',) or (isinstance(v, str) and v.startswith('list')):
        r['types'].add(v)
    else:
        r['types'].add(type(v).__name__)
        if len(r['ex']) < 12:
            r['ex'].add(str(v)[:90])


files = sorted(x for x in os.listdir(root) if x.endswith('.json'))
versions = defaultdict(int)
for f in files:
    d = json.load(open(os.path.join(root, f), encoding='utf-8'))
    versions[d.get('version')] += 1
    walk(d, '', f)

print('files', len(files), 'versions', dict(versions))
for p in sorted(paths):
    r = paths[p]
    rng = f" [{r['min']} .. {r['max']}]" if r['min'] is not None else ''
    ex = (' ex=' + ' | '.join(sorted(r['ex']))) if r['ex'] else ''
    print(f"{p}  ({','.join(sorted(r['types']))}) n={r['n']} files={len(r['files'])}{rng}{ex}")
