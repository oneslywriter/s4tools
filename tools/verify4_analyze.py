"""Measure a 10-channel recording of S4T VERIFY4 (verify4_build.js / verify4_play.js): scenes 1-15 one every
7.6 s from the first sound.
usage: verify4_analyze.py recording.wav"""
import math, sys
from verify_analyze import load, rms, db, peaks, onsets, SR, cents
from verify2_analyze import measure

DIVS = ['32/1', '16/1', '8/1', '4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64']
beats = lambda d: 4 * eval(d)  # a note length in beats (4/4)
REF = -15.01  # the centred, bypassed sine on a track's return (VERIFY2 / VERIFY3)


def centre(x):
    """pitch of MOSAIC's grains: the power-weighted centre of the spectral lines near the strongest one"""
    pk = peaks(x[:65536], floor=0.01)
    if not pk:
        return None
    f0 = pk[0][0]
    near = [(f, a) for f, a in pk if abs(f - f0) < 30]
    w = sum(a * a for _, a in near)
    return sum(f * a * a for f, a in near) / w


def echo(x):
    """seconds from the click to its echo: the 1 ms envelope's peak in the first 0.4 s, then the strongest local
    maximum at least 20 ms later and above -30 dB re the click (VAST darkens the repeats, so the first difference
    misses some of them). The echoes measure 0-3 ms long (1 ms steps, the smeared repeat's peak): 4 ms tolerance,
    still well apart from the other modes (1/64: dotted 46.9 ms, straight 31.3, triplet 20.8)"""
    B = SR // 1000
    env = [max(abs(v) for v in x[i:i + B]) for i in range(0, len(x) - B, B)]
    c = max(range(400), key=lambda i: env[i])
    pk = [i for i in range(c + 20, len(env) - 1) if env[i] >= env[i - 1] and env[i] > env[i + 1] and env[i] > env[c] * 10 ** (-30 / 20)]
    return (max(pk, key=lambda i: env[i]) - c) / 1000 if pk else None


def vast_want(step, mode):
    """the echo VAST TIME should give at 120 BPM: the S-4's default mode ('') is DOTTED, 'straight' is stored"""
    return beats(DIVS[step]) * 0.5 * {'': 1.5, 'straight': 1, 'triplet': 2 / 3}[mode]


def pan_law(p):
    if p == 0:
        return 1.0, 1.0
    th = (p + 1) * math.pi / 4
    return 2 * math.cos(th), 2 * math.sin(th)


def main(path):
    ch = load(path)
    n = len(ch[0])
    first = next(i for i in range(0, n, 48) if any(abs(c[i]) > 0.003 for c in ch))
    start = lambda k: first + int(k * 7.6 * SR)
    fails = []
    print('VAST DELAY TIME: echo after the click (120 BPM, 1 beat = 0.5 s; mode "" is DOTTED)')
    print('  scene 1 only: the S-4 sat on it before the run. Scene 2 follows scene 1 and the delay time glides from')
    print('  scene 1 times for about a second, so it is measured by verify4_replay_analyze.py.')
    a = start(0) - int(0.2 * SR)
    for t, (step, mode) in enumerate([(5, ''), (6, ''), (7, ''), (8, '')]):
        x = [(l + r) / 2 for l, r in zip(ch[2 + 2 * t][a:a + int(3.6 * SR)], ch[3 + 2 * t][a:a + int(3.6 * SR)])]
        d, want = echo(x), vast_want(step, mode)
        ok = d is not None and abs(d - want) < max(0.004, 0.01 * want)
        if not ok:
            fails.append(f'VAST step {step} {mode}: {d}')
        print(f'  step {step:2} {mode or "(empty)":8} ({DIVS[step]}D): echo {d} s, expected {want:.4f} s {"ok" if ok else "!!"}')
    print('MOSAIC PITCH (440 Hz sine, MOSAIC on at its defaults)')
    a = start(2) + int(1.0 * SR)
    for t, (st, what) in enumerate(((7, 'chromatic +7'), (-4, 'minor -4'), (7, 'fifths +7'), (0, 'fifths 0'))):
        x = [(l + r) / 2 for l, r in zip(ch[2 + 2 * t][a:a + 65536], ch[3 + 2 * t][a:a + 65536])]
        f, want = centre(x), 440 * 2 ** (st / 12)
        ok = f is not None and abs(cents(f, want)) < 10
        if not ok:
            fails.append(f'MOSAIC {what}: {f}')
        print(f'  {what:13}: {f and round(f, 2)} Hz, expected {want:.2f} ({f and cents(f, want):+.1f} c) {"ok" if ok else "!!"}')
    print('PANS (each track\'s own return, scenes 4 .. 14: sine at 0 dB, effects bypassed; against centre)')
    for t, p in enumerate((1 / 64, 6 / 64, 0.25, -0.25)):
        Ls, Rs = [], []
        for k in (3, 5, 7, 9, 11, 13):
            m = measure(ch, start(k) + int(0.5 * SR), start(k) + int(5.0 * SR))[1 + t]
            Ls.append(m['L']); Rs.append(m['R'])
        L, R = sum(Ls) / len(Ls) - REF, sum(Rs) / len(Rs) - REF
        gl, gr = (20 * math.log10(g) for g in pan_law(p))
        ok = abs(L - gl) < 0.1 and abs(R - gr) < 0.1
        if not ok:
            fails.append(f'pan {p}: L {L:+.2f} R {R:+.2f}')
        print(f'  T{t + 1} pan {p:+.4f}: L {L:+.2f} R {R:+.2f} dB; the law gives L {gl:+.2f} R {gr:+.2f} {"ok" if ok else "!!"}')
    print('SCENE AFTER THE FOUR-TONE SCENE: T4 alone at +2 st (493.88 Hz) means the scene loaded')
    names = ['valid names, T1 + T2', "VERIFY's T1 blocks", "VERIFY's T2 blocks", "T2 'material' only", "T1 'input 1/2' + 'input 1'", "T1 MOD 2 'input 1' only"]
    for j, what in enumerate(names):
        k = 4 + 2 * j
        M = measure(ch, start(k) + int(0.5 * SR), start(k) + int(5.0 * SR))
        sound = [f'T{t}: {round(M[t]["freq"])} Hz' for t in (1, 2, 3, 4) if M[t]['level'] > -70 and M[t].get('freq')]
        loaded = M[4]['level'] > -70 and M[4].get('freq') and abs(cents(M[4]['freq'], 493.88)) < 10 and all(M[t]['level'] <= -70 for t in (1, 2, 3))
        print(f'  scene {k + 1} {what:28}: {", ".join(sound) or "silent"} -> {"loaded" if loaded else "NOT loaded"}')
    print('RESULT:', 'all checks passed' if not fails else f'{len(fails)} failed: ' + '; '.join(fails))


if __name__ == '__main__':
    main(sys.argv[1])
