"""Closer looks at a verify recording: spectral peaks of a track in a time window, a level timeline, and click
times. Pure Python (radix-2 FFT).
usage: verify_inspect.py rec.wav peaks <track 0-4> <t0> <t1>      (0 = master)
       verify_inspect.py rec.wav timeline <t0> <t1> [step]
       verify_inspect.py rec.wav clicks <track> <t0> <t1>"""
import array, cmath, math, sys, wave

SR = 48000
path, cmd = sys.argv[1], sys.argv[2]
with wave.open(path) as w:
    CH, N = w.getnchannels(), w.getnframes()
    raw = w.readframes(N)
A = array.array('h')
A.frombytes(raw)


def mono(tr, t0, t1):
    a, b = int(t0 * SR), int(t1 * SR)
    L, R = A[a * CH + 2 * tr:b * CH:CH], A[a * CH + 2 * tr + 1:b * CH:CH]
    return [(l + r) / 65536 for l, r in zip(L, R)]


def fft(x):
    n = len(x)
    if n == 1:
        return x
    ev, od = fft(x[0::2]), fft(x[1::2])
    t = [cmath.exp(-2j * math.pi * k / n) * od[k] for k in range(n // 2)]
    return [ev[k] + t[k] for k in range(n // 2)] + [ev[k] - t[k] for k in range(n // 2)]


if cmd == 'peaks':
    tr, t0, t1 = int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
    x = mono(tr, t0, t1)
    n = 1 << int(math.log2(len(x)))
    x = [v * (0.5 - 0.5 * math.cos(2 * math.pi * i / n)) for i, v in enumerate(x[:n])]
    X = [abs(c) for c in fft(x)[:n // 2]]
    top = max(X)
    pk = []
    for k in range(2, len(X) - 2):
        if X[k] > X[k - 1] and X[k] >= X[k + 1] and X[k] > top * 0.03:
            a, b, c = math.log(X[k - 1] + 1e-12), math.log(X[k]), math.log(X[k + 1] + 1e-12)
            d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) else 0
            pk.append(((k + d) * SR / n, 20 * math.log10(X[k] / top)))
    pk.sort(key=lambda p: -p[1])
    print(f'track {tr} {t0}-{t1} s, {n} points, {SR / n:.2f} Hz bins')
    for f, d in pk[:12]:
        print(f'  {f:9.2f} Hz  {d:6.1f} dB')
elif cmd == 'timeline':
    t0, t1 = float(sys.argv[3]), float(sys.argv[4])
    st = float(sys.argv[5]) if len(sys.argv) > 5 else 0.5
    t = t0
    print('   t     master    T1     T2     T3     T4   (RMS dB)')
    while t < t1:
        row = []
        for tr in range(5):
            x = mono(tr, t, t + st)
            r = math.sqrt(sum(v * v for v in x) / len(x)) if x else 0
            row.append(f'{20 * math.log10(max(r, 1e-6)):6.1f}')
        print(f'{t:6.2f}', ' '.join(row))
        t += st
elif cmd == 'clicks':
    tr, t0, t1 = int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
    x = mono(tr, t0, t1)
    B = 48
    env = [max(abs(x[j] - x[j - 1]) for j in range(i, i + B)) for i in range(1, len(x) - B, B)]
    thr = 0.25 * max(env)
    last = -1
    out = []
    for k, e in enumerate(env):
        t = k * B / SR
        if e >= thr and t - last > 0.15:
            out.append(round(t0 + t, 3))
            last = t
    print('clicks', out)
    print('gaps', [round(b - a, 3) for a, b in zip(out, out[1:])])
