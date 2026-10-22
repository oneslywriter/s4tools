"""Check the fitted formulas for the second calibration against every reading. usage: cal2_check.py fit_r2.json"""
import json, math, sys

fit = json.load(open(sys.argv[1]))
E = lambda k: math.exp(k) - 1
expo = lambda a, b, k: (lambda c: a + (b - a) * (math.exp(k * c / 127) - 1) / E(k))
rexp = lambda a, b, k: (lambda c: b - (b - a) * (math.exp(k * (1 - c / 127)) - 1) / E(k))
geo = lambda a, b: (lambda c: a * (b / a) ** (c / 127))
lin = lambda a, b: (lambda c: a + (b - a) * c / 127)
steps = lambda table: (lambda c: table[round(c * (len(table) - 1) / 127)])
F = {
    'material.disc.density': lin(0, 1), 'material.disc.glide': expo(0, 4, 4), 'material.disc.level': rexp(-100, 12, 4),
    'material.disc.offset': lin(-8, 8), 'material.disc.sos': rexp(-100, 0, 4), 'material.disc.xfade': lin(0, 1),
    'material.disc.speed|DISC sync': steps([-36, -24, -12, 0, 12, 24, 36]), 'material.disc.speed|DISC free': lin(-36, 36),
    'material.disc.tempo|DISC sync': lambda c: round(20 + 979 * c / 127), 'material.disc.tempo|DISC free': lin(20, 999),
    'material.disc.start|DISC free': lin(0, 8),
    'material.poly.attack': expo(0, 4, 4), 'material.poly.decay': expo(0, 4, 4), 'material.poly.level': rexp(-100, 12, 4),
    'material.poly.curve': lin(-1, 1), 'material.poly.filter_amount': lin(-1, 1), 'material.poly.filter_shape': lin(-1, 1),
    'material.poly.length': lin(0, 1), 'material.poly.loop': lin(0, 1), 'material.poly.pitch': lin(-12, 12), 'material.poly.start': lin(0, 1),
    'material.poly.sustain': lin(0, 1), 'material.poly.velocity': lin(0, 1), 'material.poly.xfade': lin(0, 1),
    'material.tape.length': lambda c: 4 * round(c * 15 / 127), 'material.tape.rotate': lin(-1, 1), 'material.tape.sos': lin(-1, 1),
    'material.tape.speed': steps([-36, -24, -12, 0, 12, 24, 36]), 'material.tape.xfade': lin(0, 1),
    'modulator1.wave.amount': lin(0, 1), 'modulator1.wave.curve': lin(-1, 1), 'modulator1.wave.fold': lin(0, 1), 'modulator1.wave.offset': lin(-1, 1),
    'modulator1.wave.phase': lin(0, 1), 'modulator1.wave.rate': lambda c: round(c * 10 / 127), 'modulator1.wave.skew': lin(-1, 1), 'modulator1.wave.spread': lin(-1, 1),
    'modulator2.random.amount': lin(0, 1), 'modulator2.random.length': lin(1, 32), 'modulator2.random.offset': lin(-1, 1), 'modulator2.random.phase': lin(0, 1),
    'modulator2.random.rate': lambda c: 2 + round(c * 9 / 127), 'modulator2.random.smoothing': lin(0, 1), 'modulator2.random.spread': lin(-1, 1), 'modulator2.random.variation': lin(0, 1),
    'modulator3.follow.amount': lin(0, 1), 'modulator3.follow.delay_time': expo(0, 2, 8), 'modulator3.follow.fall': geo(1, 1000), 'modulator3.follow.rise': geo(1, 1000),
    'modulator3.follow.filter_cutoff': lin(-1, 1), 'modulator3.follow.input_level': lin(-36, 36), 'modulator3.follow.spread': lin(-1, 1),
    'space.vast.decay': expo(0.1, 60, 8), 'space.vast.delay_wet': lin(0, 1), 'space.vast.feedback': lin(0, 2), 'space.vast.reverb_wet': lin(0, 1),
    'space.vast.size': lin(0, 1), 'space.vast.spread': lin(0, 1), 'space.vast.time': lambda c: 3 + round(c * 8 / 127), 'space.vast.tone': lin(-1, 1),
}
bad = 0
for field, groups in sorted(fit.items()):
    for g, r in groups.items():
        if 'points' not in r: continue
        f = F.get(f'{field}|{g}') or F.get(field)
        if not f:
            print(f'{field} / {g}: no formula (CC-dependent on the sample: start/length in sync, length in free)')
            continue
        err = max(abs(f(c) - y) / max(1, abs(y)) for c, y in r['points'])
        flag = '' if err < 1e-4 else '   <-- CHECK'
        bad += bool(flag)
        print(f'{field:38} {g:10} max rel. error {err:.2e}{flag}')
print('fields over tolerance:', bad)
