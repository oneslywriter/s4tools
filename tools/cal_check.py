"""Check the fitted CC -> stored-value formulas against every calibration point. usage: cal_check.py fit.json"""
import json, math, sys

p = json.load(open(sys.argv[1]))['params']
PT = [-36, -29, -24, -17, -12, -5, 0, 7, 12, 19, 24, 31, 36]
F = {
    'uni': lambda c: c / 127, 'bi': lambda c: 2 * c / 127 - 1, 'fb': lambda c: 2 * c / 127,
    'rpitch': lambda c: 48 * c / 127 - 24, 'scale': lambda c: 19 * c / 127,
    'size': lambda c: 0.001 + 9.999 * (math.exp(8 * c / 127) - 1) / (math.exp(8) - 1),
    'mpitch': lambda c: PT[round(c * 12 / 127)], 'rate': lambda c: 5 + round(c * 6 / 127), 'rr': lambda c: round(c * 11 / 127),
}
KIND = {'granular.mosaic.pitch': 'mpitch', 'granular.mosaic.rate': 'rate', 'granular.mosaic.size': 'size', 'granular.mosaic.contour': 'bi',
        'granular.mosaic.feedback': 'fb', 'filter.ring.pitch': 'rpitch', 'filter.ring.slope': 'bi', 'filter.ring.tone': 'bi',
        'filter.ring.scale': 'scale', 'filter.ring.tilt': 'bi', 'filter.ring.waves_rate': 'rr', 'filter.ring.noise_rate': 'rr', 'color.deform.tilt': 'bi'}
for k, v in p.items():
    kind = KIND.get(k, 'uni')
    f = F[kind]
    if kind == 'size':
        err = max(abs(f(c) - y) / y for c, y in v['points'])
        print(f'{k:30} {kind:7} max relative error {err:.2%}')
    else:
        err = max(abs(f(c) - y) for c, y in v['points'])
        print(f'{k:30} {kind:7} max error {err:.2e}')
