"""Analyse the saved CAL3 project (gen_cal3.py). Scene s (0-31) belongs to group s // 8; track t is point
k = (s % 8) * 4 + t, whose i-th CC got round(((A[i % 16] * k + 7 * (i // 16)) % 32) * 127 / 31), A = 1, 3 ... 31.
For every stored numeric field: the CC that drives it (rank correlation over the group's 32 points), its mode(s)
and the CC -> value points.
usage: cal3_fit.py project.json out.json"""
import json, sys

CC = {'disc': [46, 47, 48, 49, 52, 53, 54, 56, 57, 58], 'tape': [46, 48, 49, 50, 51, 52, 53, 54, 55, 56],
      'poly': [46, 48, 49, 50, 52, 53, 54, 55, 56, 57, 58, 60, 61]}
TAIL = list(range(62, 75)) + [77] + list(range(78, 92)) + list(range(110, 118)) + list(range(14, 46))
GROUPS = [('G1 disc sync major', 'disc'), ('G2 tape pentatonic', 'tape'), ('G3 poly free', 'poly'), ('G4 disc stretch chromatic', 'disc')]
A = list(range(1, 32, 2))
level = lambda k, i: round(((A[i % 16] * k + 7 * (i // 16)) % 32) * 127 / 31)

d = json.load(open(sys.argv[1], encoding='utf-8'))
d = d.get('data', d)


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]: j += 1
        for q in range(i, j + 1): r[order[q]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5
    return num / den if den else 0.0


def fields(tr, matkey):
    out = {}

    def take(prefix, blk):
        for k, v in (blk or {}).items():
            if isinstance(v, dict) and isinstance(v.get('value'), (int, float)) and not isinstance(v.get('value'), bool):
                out[f'{prefix}.{k}'] = (v['value'], v.get('mode', ''))
    take(f'material.{matkey}', tr.get('material', {}).get(matkey))
    for slot, key in (('granular', 'mosaic'), ('filter', 'ring'), ('space', 'vast')):
        take(f'{slot}.{key}', (tr.get(slot) or {}).get(key))
    for m in range(1, 5):
        for typ, b in (tr.get(f'modulator{m}') or {}).items():
            if isinstance(b, dict): take(f'modulator{m}.{typ}', b)
    return out


result = {}
for g, (gname, mat) in enumerate(GROUPS):
    ccs = CC[mat] + TAIL
    rows = []
    for s in range(g * 8, g * 8 + 8):
        sc = d['scenes'].get(str(s))
        for t in range(4):
            rows.append(((s % 8) * 4 + t, fields(sc['tracks'][t], mat) if sc else {}))
    print(f'===== {gname} =====')
    for f in sorted({f for _, fs in rows for f in fs}):
        pts = [(k, fs[f][0], fs[f][1]) for k, fs in rows if f in fs]
        ys = [p[1] for p in pts]
        modes = sorted({p[2] for p in pts})
        if len(set(ys)) == 1:
            print(f'{f:42} constant {ys[0]!r} modes {modes}')
            result.setdefault(f, {})[gname] = {'constant': ys[0], 'modes': modes}
            continue
        rho, c, i = max(((spearman([level(k, i) for k, _, _ in pts], ys), c, i) for i, c in enumerate(ccs)), key=lambda x: abs(x[0]))
        xy = sorted((level(k, i), y) for k, y, _ in pts)
        result.setdefault(f, {})[gname] = {'cc': c, 'rho': rho, 'points': xy, 'modes': modes}
        print(f'{f:42} CC{c:3d} rho {rho:+.3f}  {xy[0][1]:.6g} .. {xy[-1][1]:.6g}  ({len(set(ys))} values)  modes {modes}')
json.dump(result, open(sys.argv[2], 'w'), indent=1)
