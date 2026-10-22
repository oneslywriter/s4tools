"""Measure a 10-channel recording of S4T VERIFY6 (verify6_build.js / verify6_play.js): scene 1 for 12 s, then
scene 2 for 70 s, 1.6 s apart, from the first sound.
usage: verify6_analyze.py recording.wav"""
import math, sys
from verify_analyze import load, rms, db, zc_freq, SR
from verify5_analyze import mono, trace, grid, median

PLAN = [(0, 12), (1, 70)]
GAP = 1.6


def beats(x):
    """the sig120 beats in a track: (seconds from the first click, beat index from the tone after each click)"""
    B = SR // 1000
    env = [max(abs(v) for v in x[i:i + B]) for i in range(0, len(x) - B, B)]
    top = max(env)
    hits, last = [], -1000
    for i, v in enumerate(env):
        if v > top * 0.5 and i - last > 200:
            hits.append(i)
            last = i
    out = []
    for h in hits:
        a = (h + 40) * B
        f = zc_freq(x[a:a + int(0.14 * SR)])
        out.append(((h - hits[0]) / 1000, round((f - 400) / 100) if f else None))
    return out


def fit_period(g, step, lo=4.0, hi=200.0):
    """the period of a sine fitted by least squares (sin, cos, offset) over a log grid of periods, then refined:
    works with about one cycle"""
    ts = [i * step for i in range(len(g))]
    n = len(g)

    def resid(p):
        w = 2 * math.pi / p
        s = [math.sin(w * t) for t in ts]
        c = [math.cos(w * t) for t in ts]
        # normal equations for [s, c, 1]
        A = [[sum(a * b for a, b in zip(u, v)) for v in (s, c, [1] * n)] for u in (s, c, [1] * n)]
        y = [sum(a * b for a, b in zip(u, g)) for u in (s, c, [1] * n)]
        # solve 3x3 by Cramer's rule
        det = lambda M: (M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
                         + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]))
        D = det(A)
        if abs(D) < 1e-12:
            return float('inf')
        k = []
        for j in range(3):
            Mj = [row[:] for row in A]
            for i in range(3):
                Mj[i][j] = y[i]
            k.append(det(Mj) / D)
        return sum((v - (k[0] * a + k[1] * b + k[2])) ** 2 for v, a, b in zip(g, s, c))
    cands = [lo * (hi / lo) ** (i / 300) for i in range(301)]
    best = min(cands, key=resid)
    for f in (1.01, 1.001, 1.0001):
        best = min((best * f ** k for k in range(-12, 13)), key=resid)
    return best


def main(path):
    ch = load(path)
    n = len(ch[0])
    first = next(i for i in range(0, n, 48) if any(abs(c[i]) > 0.003 for c in ch))
    starts, t = [], first
    for s, sec in PLAN:
        starts.append(t)
        t += int((sec + GAP) * SR)
    print(f'first sound at {first / SR:.2f} s')
    print('SCENE 1: DISC LOOP on the beats sample (beat k = a click and a 400 + 100 k Hz tone; 0.5 s per beat)')
    for tn, what in enumerate(('START 2 LENGTH 2, LOOP on', 'START 2 LENGTH 2, LOOP off', 'START 0 LENGTH 2, LOOP off', 'START 6 LENGTH 2, LOOP off')):
        x = mono(ch, tn, starts[0] - int(0.2 * SR), starts[0] + int(11.6 * SR))
        seq = beats(x)
        blocks = ''.join('#' if db(rms(x[i:i + SR // 2])) > -60 else '.' for i in range(int(0.2 * SR), len(x) - SR // 2, SR // 2))
        print(f'  T{tn + 1} {what}:')
        print(f'     beats  {" ".join(str(k) for _, k in seq)}')
        print(f'     at     {" ".join(f"{t:.2f}" for t, _ in seq)}')
        print(f'     sound per 0.5 s: {blocks}')
    print('SCENE 2: WAVE (sine) -> DISC SPEED, period of a sine fitted to the pitch (s)')
    for tn, (rate, label, want) in enumerate(((2, '8/1', 16), (1, '16/1', 32), (0, '32/1', 64), (3, '4/1', 8))):
        a = starts[1] + int(0.5 * SR)
        tr = trace(mono(ch, tn, a, a + int(69 * SR)))
        g = median(grid(tr, 0.01), 5)
        p = fit_period(g, 0.01)
        vals = sorted(g)
        print(f'  T{tn + 1} RATE {rate} ({label}?): period {p:.2f} s, {want} s if it is {label} at 120 BPM '
              f'{"ok" if abs(p - want) < 0.02 * want else "!!"}; pitch {vals[len(vals) // 50]:+.2f} .. {vals[-len(vals) // 50]:+.2f} st')


if __name__ == '__main__':
    main(sys.argv[1])
