"""Harmonic content of a test sine on one return pair of a 10-channel WAV, in each loud segment.
usage: thd.py file.wav pair f0   (pair 0 = master, 1 = T1, 2 = T2 ...)"""
import math, struct, sys, wave

path, pair, f0 = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
x = [(a[i * ch + 2 * pair] + a[i * ch + 2 * pair + 1]) / 65536 for i in range(n)]
db = lambda v: 20 * math.log10(max(v, 1e-9))


def amp(seg, f):
    N = len(seg)
    c = 2 * math.cos(2 * math.pi * f / sr)
    s1 = s2 = 0.0
    for i, v in enumerate(seg):
        s0 = v * (0.5 - 0.5 * math.cos(2 * math.pi * i / N)) + c * s1 - s2
        s2, s1 = s1, s0
    return 2 * math.sqrt(max(s1 * s1 + s2 * s2 - c * s1 * s2, 0)) / (N / 2)


# find segments where the level is up, 50 ms resolution
B = sr // 20
lv = [math.sqrt(sum(v * v for v in x[b:b + B]) / B) for b in range(0, n - B, B)]
on = [l > 10 ** (-60 / 20) for l in lv]
segs, s = [], None
for k, f in enumerate(on + [False]):
    if f and s is None: s = k
    if not f and s is not None:
        if k - s >= 10: segs.append((s * B, k * B))
        s = None
for s0, s1 in segs:
    m = (s1 - s0) // 4
    seg = x[s0 + m: s1 - m]  # the steady middle
    h = [amp(seg, f0 * k) for k in range(1, 8)]
    thd = math.sqrt(sum(v * v for v in h[1:])) / max(h[0], 1e-12)
    print(f'{s0 / sr:5.2f}-{s1 / sr:5.2f} s: fundamental {db(h[0]):6.1f} dBFS, THD {100 * thd:6.2f} % | harmonics 2-7 (dB rel.): '
          + ' '.join(f'{db(v / max(h[0], 1e-12)):6.1f}' for v in h[1:]))
