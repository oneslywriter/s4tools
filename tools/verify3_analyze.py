"""Measure a 10-channel recording of S4T VERIFY3 (verify3_build.js / verify3_play.js): scenes 1-13 one every
7.6 s from the first sound. Each effect alone at its defaults (T1), the pan sweep (T2-T4), and VERIFY's
scenes 9 / 10 replayed.
usage: verify3_analyze.py recording.wav"""
import sys
from verify2_analyze import measure
from verify_analyze import load, SR

NAMES = ['master', 'T1', 'T2', 'T3', 'T4']


def main(path):
    ch = load(path)
    n = len(ch[0])
    first = next(i for i in range(0, n, 48) if any(abs(c[i]) > 0.003 for c in ch))
    M = []
    for k in range(13):
        a = first + int((k * 7.6 + 0.4) * SR)
        M.append(measure(ch, a, a + int(5.0 * SR)))
    fmt = m = None

    def line(m):
        if m['level'] <= -70:
            return 'silent'
        return f'L {m["L"]:7.2f} R {m["R"]:7.2f} level {m["level"]:7.2f} dB {m.get("freq") and round(m["freq"], 1)} Hz' + (f' THD {m["thd"]:.1f}' if m.get('thd') is not None else '')
    print('EACH EFFECT ALONE AT ITS DEFAULTS (T1), against all bypassed (scene 1)')
    ref = M[0][1]['level']
    for k, what in enumerate(['all bypassed', 'MOSAIC', 'RING', 'DEFORM', 'VAST', 'all four']):
        t1 = M[k][1]
        print(f'  scene {k + 1} {what:12}: {line(t1)}' + (f'  ({t1["level"] - ref:+.2f} dB)' if t1['level'] > -70 else ''))
    print('PAN AT 0 dB (own return and master), against scene 1\'s centred T1')
    refL, refR = M[0][1]['L'], M[0][1]['R']
    for k, t, p in ((6, 2, -1), (7, 3, -0.5), (8, 4, 0.5)):
        r, mm = M[k][t], M[k][0]
        print(f'  pan {p:+.1f}: return L {r["L"] - refL:+.2f} R {r["R"] - refR:+.2f} dB | master L {mm["L"] - refL:+.2f} R {mm["R"] - refR:+.2f} dB')
    print('VERIFY SCENES 9 -> 10 REPLAYED (10 has T4 alone; 13 = 10 without FOLLOW modulators)')
    for k, what in ((9, 'VERIFY 9'), (10, 'VERIFY 10'), (11, 'VERIFY 9'), (12, 'VERIFY 10 no FOLLOW')):
        print(f'  scene {k + 1} ({what}):')
        for name, m in zip(NAMES, M[k]):
            print(f'    {name:6} {line(m)}')


if __name__ == '__main__':
    main(sys.argv[1])
