"""Measure a 10-channel recording of S4T VERIFY2 (verify2_build.js / verify2_play.js). Scenes are found by time:
the first sound is scene 1's START, then one scene every 7.6 s. Per scene, for the master and T1-T4: left and
right level (RMS dB), the strongest pitch and harmonic distortion.
usage: verify2_analyze.py recording.wav"""
import math, sys
from verify_analyze import load, rms, db, peaks, goertzel, SR, cents

PLAYED = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 20, 99, 100, 128]
NAMES = ['master', 'T1', 'T2', 'T3', 'T4']
ST = lambda s: 440 * 2 ** (s / 12)


def measure(ch, a, b):
    out = []
    for p in range(5):
        L, R = ch[2 * p][a:b], ch[2 * p + 1][a:b]
        x = [(l + r) / 2 for l, r in zip(L, R)]
        m = {'L': db(rms(L)), 'R': db(rms(R)), 'level': db(rms(x))}
        if m['level'] > -70:
            pk = peaks(x[:65536])
            f = pk[0][0] if pk else None
            m['freq'] = f
            if f:
                seg = x[:SR]
                h = [goertzel(seg, f * k) for k in (1, 2, 3, 4, 5)]
                m['thd'] = db(math.sqrt(sum(v * v for v in h[1:])) / h[0]) if h[0] > 0 else None
        out.append(m)
    return out


def main(path):
    ch = load(path)
    n = len(ch[0])
    first = next(i for i in range(0, n, 48) if any(abs(c[i]) > 0.003 for c in ch))
    print(f'{path}: first sound at {first / SR:.3f} s')
    M = {}
    for k, s in enumerate(PLAYED):
        a = first + int((k * 7.6 + 0.4) * SR)
        b = a + int(5.0 * SR)
        M[s] = measure(ch, a, b)
        print(f'SCENE {s} ({a / SR:.1f}-{b / SR:.1f} s)')
        for name, m in zip(NAMES, M[s]):
            if m['level'] <= -70:
                print(f'  {name:6} silent ({m["level"]:.1f} dB)')
                continue
            f = m.get('freq')
            print(f'  {name:6} L {m["L"]:7.2f}  R {m["R"]:7.2f}  level {m["level"]:7.2f} dB   {f and round(f, 2)} Hz'
                  + (f'  THD {m["thd"]:.1f} dB' if m.get('thd') is not None else ''))
    print('MIXER (against scene 4: T1 alone, 0 dB, centre)')
    ref = M[4]
    for s, t, what in ((1, 4, 'T4 -6 dB, pan -0.5'), (2, 2, 'T2 -6 dB, centre'), (3, 3, 'T3 0 dB, pan +1')):
        mm, rt = M[s][0], M[s][t]
        print(f'  {what}: master L {mm["L"] - ref[0]["L"]:+.2f} R {mm["R"] - ref[0]["R"]:+.2f} dB | own return L {rt["L"] - ref[1]["L"]:+.2f} R {rt["R"] - ref[1]["R"]:+.2f} dB')
    print('PITCHES (scene 5: 0 / +4 / +7 / +12 st; scenes 10..128 on T1: +1 .. +7)')
    for t, st in zip((1, 2, 3, 4), (0, 4, 7, 12)):
        f = M[5][t].get('freq')
        print(f'  scene 5 T{t}: {f and round(f, 2)} Hz, expected {ST(st):.2f}' + (f' ({cents(f, ST(st)):+.1f} c)' if f else ''))
    for k, s in enumerate((10, 11, 12, 20, 99, 100, 128)):
        f = M[s][1].get('freq')
        print(f'  scene {s} T1: {f and round(f, 2)} Hz, expected {ST(k + 1):.2f}' + (f' ({cents(f, ST(k + 1)):+.1f} c)' if f else '  !! no sound'))
    print('NO SAMPLE AFTER SCENE 5 (scene 6: T1 DISC, T2 BYPASS, T3 TAPE, T4 POLY)')
    for t in (1, 2, 3, 4):
        m = M[6][t]
        print(f'  T{t}: ' + ('silent' if m['level'] <= -70 else f'{m["level"]:.1f} dB at {m.get("freq") and round(m["freq"], 1)} Hz'))
    print('EFFECTS (scene 7: T1 COLOR drive, T2 S-4 defaults written out, T3 bypassed; scene 8: the same, not set)')
    for t in (1, 2, 3):
        a7, a8 = M[7][t], M[8][t]
        fmt = lambda m: 'silent' if m['level'] <= -70 else f'{m["level"]:.2f} dB, THD {m.get("thd") is not None and round(m["thd"], 1)}'
        print(f'  T{t}: scene 7 {fmt(a7)} | scene 8 {fmt(a8)}')


if __name__ == '__main__':
    main(sys.argv[1])
