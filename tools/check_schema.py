"""Check S-4 project.json files against schema/s4project.schema.json (no third-party packages: a validator for
the JSON Schema keywords the schema uses). Prints each file's problems with their path, then a summary.
usage: check_schema.py project.json [more.json ...]   (a list file of paths with @list.txt)"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = json.load(open(os.path.join(HERE, '..', 'schema', 's4project.schema.json'), encoding='utf-8'))
EPS = 1e-6  # the S-4 stores float32: allow rounding at range edges (11.999998 for 12)


def resolve(ref):
    node = SCHEMA
    for part in ref.lstrip('#/').split('/'):
        node = node[part]
    return node


def is_type(x, t):
    if t == 'object': return isinstance(x, dict)
    if t == 'array': return isinstance(x, list)
    if t == 'string': return isinstance(x, str)
    if t == 'boolean': return isinstance(x, bool)
    if t == 'integer': return isinstance(x, (int, float)) and not isinstance(x, bool) and float(x).is_integer()
    if t == 'number': return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
    if t == 'null': return x is None
    return True


def same(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return a == b


def validate(x, s, path, errs):
    if '$ref' in s:
        validate(x, resolve(s['$ref']), path, errs)
    if 'type' in s and not is_type(x, s['type']):
        errs.append(f'{path}: expected {s["type"]}, got {json.dumps(x)[:60]}')
        return
    if 'const' in s and not same(x, s['const']):
        errs.append(f'{path}: {json.dumps(x)[:60]} is not {json.dumps(s["const"])}')
    if 'enum' in s and not any(same(x, e) for e in s['enum']):
        errs.append(f'{path}: {json.dumps(x)[:60]} is not one of {json.dumps(s["enum"])[:120]}')
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        if 'minimum' in s and x < s['minimum'] - EPS: errs.append(f'{path}: {x} < minimum {s["minimum"]}')
        if 'maximum' in s and x > s['maximum'] + EPS: errs.append(f'{path}: {x} > maximum {s["maximum"]}')
        if 'exclusiveMinimum' in s and x <= s['exclusiveMinimum']: errs.append(f'{path}: {x} <= {s["exclusiveMinimum"]}')
    if isinstance(x, str) and 'pattern' in s and not re.search(s['pattern'], x):
        errs.append(f'{path}: {x!r} does not match {s["pattern"]}')
    if isinstance(x, dict):
        props = s.get('properties', {})
        for k in s.get('required', []):
            if k not in x: errs.append(f'{path}: missing {k!r}')
        pn = s.get('propertyNames')
        for k, v in x.items():
            if pn and 'pattern' in pn and not re.search(pn['pattern'], k):
                errs.append(f'{path}: key {k!r} does not match {pn["pattern"]}')
            if k in props:
                validate(v, props[k], f'{path}.{k}', errs)
            else:
                ap = s.get('additionalProperties', True)
                if ap is False: errs.append(f'{path}: unexpected key {k!r}')
                elif isinstance(ap, dict): validate(v, ap, f'{path}.{k}', errs)
    if isinstance(x, list):
        if 'minItems' in s and len(x) < s['minItems']: errs.append(f'{path}: {len(x)} items < {s["minItems"]}')
        if 'maxItems' in s and len(x) > s['maxItems']: errs.append(f'{path}: {len(x)} items > {s["maxItems"]}')
        if 'items' in s:
            for i, v in enumerate(x): validate(v, s['items'], f'{path}[{i}]', errs)
    if 'anyOf' in s:
        tries = []
        for alt in s['anyOf']:
            e = []
            validate(x, alt, path, e)
            if not e: break
            tries.append(e)
        else:
            # report against the branch whose mode matches, if any
            mode = x.get('mode') if isinstance(x, dict) else None
            for alt, e in zip(s['anyOf'], tries):
                c = alt.get('properties', {}).get('mode', {}).get('const', object())
                if c == mode:
                    errs.extend(e)
                    break
            else:
                errs.append(f'{path}: matches no allowed form ({json.dumps(x)[:80]})')


def main(args):
    files = []
    for a in args:
        if a.startswith('@'):
            files += [l.strip() for l in open(a[1:], encoding='utf-8') if l.strip()]
        else:
            files.append(a)
    bad = 0
    for fn in files:
        errs = []
        validate(json.load(open(fn, encoding='utf-8')), SCHEMA, '$', errs)
        if errs:
            bad += 1
            print(f'{fn}: {len(errs)} problem(s)')
            for e in errs[:12]:
                print('   ', e)
            if len(errs) > 12:
                print(f'    ... {len(errs) - 12} more')
    print(f'{len(files) - bad} of {len(files)} valid')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
