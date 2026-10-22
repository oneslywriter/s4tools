"""Print every leaf of a project.json as path = value [mode], with {value, mode} pairs folded onto one line.
usage: dumptree.py project.json"""
import json, sys

d = json.load(open(sys.argv[1], encoding='utf-8'))


def walk(o, path):
    if isinstance(o, dict):
        if 'value' in o and set(o) <= {'value', 'mode'}:
            print(f"{path} = {o['value']!r}" + (f"  [{o['mode']}]" if o.get('mode') else ''))
            return
        if not o:
            print(f'{path} = {{}}')
        for k, v in o.items():
            walk(v, f'{path}.{k}' if path else k)
    elif isinstance(o, list):
        if all(not isinstance(x, (dict, list)) for x in o):
            print(f'{path} = {o!r}')
        else:
            for i, v in enumerate(o):
                walk(v, f'{path}[{i}]')
    else:
        print(f'{path} = {o!r}')


walk(d, '')
