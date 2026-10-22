"""Diff two project.json files leaf by leaf: changed, added (+) and removed (-) paths.
Long numeric lists are summarised. usage: jdiff.py old.json new.json"""
import json, sys


def flat(o, path, out):
    if isinstance(o, dict):
        if not o:
            out[path] = '{}'
        for k, v in o.items():
            flat(v, f'{path}.{k}' if path else k, out)
    elif isinstance(o, list):
        if all(not isinstance(x, (dict, list)) for x in o):
            out[path] = (f'list[{len(o)}] sum={round(sum(x for x in o if isinstance(x, (int, float))), 4)}'
                         if len(o) > 8 else repr(o))
        else:
            if not o:
                out[path] = '[]'
            for i, v in enumerate(o):
                flat(v, f'{path}[{i}]', out)
    else:
        out[path] = repr(o)


a, b = {}, {}
flat(json.load(open(sys.argv[1], encoding='utf-8')), '', a)
flat(json.load(open(sys.argv[2], encoding='utf-8')), '', b)
for k in sorted(set(a) | set(b)):
    if k not in b:
        print(f'- {k} = {a[k]}')
    elif k not in a:
        print(f'+ {k} = {b[k]}')
    elif a[k] != b[k]:
        print(f'~ {k}: {a[k]} -> {b[k]}')
