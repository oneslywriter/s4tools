"""Analyse the saved CAL2 project. Scene s (0-31), track t: k = (s % 8) * 4 + t; within the scene group's CC list,
the i-th CC got round(((k + 5 i) % 32) * 127 / 31). For every stored numeric field, find which CC drives it
(rank correlation over the group's 32 tracks) and print the CC -> value points.
usage: cal2_fit.py project.json out.json"""
import json, sys

DISC = [46, 47, 48, 49, 52, 53, 54, 56, 57, 58]
TAPE = [46, 48, 49, 51, 52, 53]
POLY = [46, 48, 49, 50, 52, 53, 54, 55, 56, 57, 58, 60, 61]
TAIL = list(range(110, 118)) + list(range(14, 46))
GROUPS = [('DISC sync', DISC + TAIL, 'disc'), ('DISC free', DISC + TAIL, 'disc'), ('TAPE', TAPE + TAIL, 'tape'), ('POLY', POLY + TAIL, 'poly')]
sent = lambda k, i: round(((k + 5 * i) % 32) * 127 / 31)

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
    """numeric {value} fields of the material device, VAST and the four modulators"""
    out = {}
    def take(prefix, blk):
        for k, v in (blk or {}).items():
            if isinstance(v, dict) and isinstance(v.get('value'), (int, float)) and not isinstance(v.get('value'), bool):
                out[f'{prefix}.{k}'] = (v['value'], v.get('mode', ''))
            elif isinstance(v, (int, float)) and not isinstance(v, bool) and k not in ('track_index', 'scene_index', 'selected'):
                out[f'{prefix}.{k}'] = (v, '')
    take(f'material.{matkey}', tr.get('material', {}).get(matkey))
    take('space.vast', (tr.get('space') or {}).get('vast'))
    for m in range(1, 5):
        blk = tr.get(f'modulator{m}') or {}
        for typ, b in blk.items():
            if isinstance(b, dict): take(f'modulator{m}.{typ}', b)
    return out


result = {}
for g, (gname, ccs, matkey) in enumerate(GROUPS):
    rows = []
    for s in range(g * 8, g * 8 + 8):
        sc = d['scenes'].get(str(s))
        for t in range(4):
            k = (s % 8) * 4 + t
            rows.append((k, fields(sc['tracks'][t], matkey) if sc else {}))
    keys = sorted({f for _, fs in rows for f in fs})
    print(f'===== {gname} =====')
    for f in keys:
        pts = [(k, fs[f][0], fs[f][1]) for k, fs in rows if f in fs]
        ys = [p[1] for p in pts]
        modes = sorted({p[2] for p in pts})
        if len(set(ys)) == 1:
            print(f'{f:40} constant {ys[0]!r} modes {modes}')
            result.setdefault(f, {})[gname] = {'constant': ys[0], 'modes': modes}
            continue
        best = max(((spearman([sent(k, i) for k, _, _ in pts], ys), c, i) for i, c in enumerate(ccs)), key=lambda x: abs(x[0]))
        rho, c, i = best
        xy = sorted((sent(k, i), y) for k, y, _ in pts)
        result.setdefault(f, {})[gname] = {'cc': c, 'rho': rho, 'points': xy, 'modes': modes}
        print(f'{f:40} CC{c:3d} rho {rho:+.3f}  {xy[0][1]:.6g} .. {xy[-1][1]:.6g}  modes {modes}')
json.dump(result, open(sys.argv[2], 'w'), indent=1)
