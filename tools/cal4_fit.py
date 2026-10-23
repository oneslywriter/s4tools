"""Check the CC curves of calibration round 4 (cal4_build.js, cal4_send.js) against the saved project: for each
parameter, the stored values next to a model's, and the largest difference. With the CCs Live showed for the
same project (follow.js, cal4_follow.json), also how far each lands from the CC that was sent and from the
stored value.
usage: cal4_fit.py project.json cal4_plan.json [cal4_follow.json]"""
import json, math, sys

d = json.load(open(sys.argv[1], encoding='utf-8'))['data']
plan = json.load(open(sys.argv[2], encoding='utf-8'))
DUR, BEATS = 4.0, 8  # the sample: 4 s, 8 beats at its own 120 BPM

lin = lambda a, b: lambda c: a + (b - a) * c / 127
rexp = lambda a, b, k: lambda c: b - (b - a) * (math.exp(k * (1 - c / 127)) - 1) / (math.exp(k) - 1)
octv = lambda c: 12 * round(lin(-36, 36)(c) / 12)
grid = lambda g: lambda c: round(c / 127 * (BEATS / g - 1)) * g          # START: grid steps over the sample
glen = lambda g: lambda c: (round(c / 127 * (BEATS / g - 1)) + 1) * g    # LENGTH: 1 step to the whole sample

# (scene range, track) -> device; as in cal4_build.js
def device(s, t):
    g = [8, 16, 24, 28, 32].index(next(x for x in [8, 16, 24, 28, 32] if s < x))
    return [['disc', 'disc', 'tape', 'poly'], ['disc', 'disc', 'tape', 'poly'], ['disc'] * 4,
            ['disc', 'disc', 'tape', 'disc'], ['disc'] * 4][g][t]

FIELD = {'disc': {46: 'speed', 47: 'tempo', 48: 'start', 49: 'length'}, 'tape': {46: 'speed', 49: 'length', 50: 'level'},
         'poly': {46: 'pitch', 48: 'start', 49: 'length'}}

def model(dev, field, tempo, smode, gmode):
    if dev == 'disc':
        if field == 'speed': return {'octaves': octv, 'chromatic': lambda c: round(lin(-36, 36)(c))}.get(smode, lin(-36, 36)) if tempo != 'stretch' else (lambda c: round(lin(-36, 36)(c)))
        if field == 'tempo': return (lambda c: round(lin(20, 999)(c))) if tempo == 'sync' else lin(20, 999)
        if tempo == 'sync':
            g = {'1/4': 1, '1/16': 0.25, '1/1': 4}[gmode]
            return grid(g) if field == 'start' else glen(g)
        return lin(0, DUR)
    if dev == 'tape':
        if field == 'speed': return {'': octv, 'octaves': octv, 'chromatic': lambda c: round(lin(-36, 36)(c))}.get(smode, lin(-36, 36))
        if field == 'level': return rexp(-100, 12, 4)
        if field == 'length': return lambda c: 4 + round(c / 127 * 56)
    if dev == 'poly':
        return lin(-12, 12) if field == 'pitch' else lin(0, 1)

rows, seen = {}, {}
for s, sends in enumerate(plan['scenes']):
    for t, cc, v in sends:
        dev = device(s, t)
        m = d['scenes'][str(s)]['tracks'][t]['material'][dev]
        f = FIELD[dev][cc]
        tempo = m.get('tempo', {}).get('mode', '') if dev == 'disc' else ''
        smode = m['speed']['mode'] if 'speed' in m else m['pitch']['mode']
        gmode = m.get('start', {}).get('mode', '') if dev == 'disc' else m.get('length', {}).get('mode', '')
        key = f'{dev} {f} ({tempo or "-"} / {smode or "-"} / {gmode or "-"})'
        fn = model(dev, f, tempo, smode, gmode)
        rows.setdefault(key, []).append((v, m[f]['value'], fn(v)))
        seen[(s, t, cc)] = (key, m[f]['value'], fn)

mix = d['global_slots']['mixer']['mix']['mix']
perf = d['global_slots']['perform']['perform']
MIX = {46: ('level', rexp(-100, 6, 3)), 50: ('cutoff', lin(-1, 1)), 54: ('pan', lin(-1, 1))}
for ch, cc, v in plan['mix']:
    if ch == 16 and cc < 58:
        name, f = MIX[46 if cc < 50 else 50 if cc < 54 else 54]
        field = f'{name}{(cc - 46) % 4 + 1}'
        rows.setdefault(f'mixer {name}', []).append((v, mix[field]['value'], f(v)))
    elif ch == 16 and cc == 58:
        rows.setdefault('mixer compress_amount', []).append((v, mix['compress_amount']['value'], lin(0, 1)(v)))
    elif ch == 16 and cc == 61:
        rows.setdefault('mixer main_level', []).append((v, mix.get('main_level', {}).get('value'), lin(0, 1)(v)))
    elif ch == 15:
        rows.setdefault('perform macro', []).append((v, perf[f'macro{cc - 45}']['value'], lin(-1, 1)(v)))

for key, pts in rows.items():
    errs = [abs(a - b) for _, a, b in pts if a is not None]
    worst = max(errs) if errs else None
    print(f'{key}: max diff {worst if worst is None else round(worst, 5)}')
    print('   ' + '  '.join(f'{c}:{a if a is None else round(a, 4)}' for c, a, _ in pts))

if len(sys.argv) > 3:
    live = json.load(open(sys.argv[3], encoding='utf-8'))
    for path in ('scenes', 'model'):
        out = {}
        for s, got in enumerate(live.get(path, [])):
            for (t, cc, v), (_, _, dev, c) in zip(plan['scenes'][s], got):
                key, stored, fn = seen[(s, t, cc)]
                o = out.setdefault(key, [0, 0])
                o[0] = max(o[0], abs(c - v))
                o[1] = max(o[1], abs(fn(c) - stored))
        print()
        print(f'Live ({"exact values" if path == "scenes" else "through Build"}): max CC off what was sent / max value off what is stored')
        for key, (dc, dv) in out.items():
            print(f'  {key}: {dc} CC / {round(dv, 5)}')
