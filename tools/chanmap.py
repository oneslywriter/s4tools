"""Channel map: one test frequency was sent per output channel; report, for every recorded channel, which
sent channels arrive there and how loud. usage: chanmap.py file.wav f1 f2 ... (f1 = sent channel 1, ...)"""
import math, struct, sys, wave

path, freqs = sys.argv[1], [float(f) for f in sys.argv[2:]]
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
db = lambda x: 20 * math.log10(max(x, 1e-9))


def tone_db(x, f):
    N = len(x)
    c = 2 * math.cos(2 * math.pi * f / sr)
    s1 = s2 = 0.0
    for i, v in enumerate(x):
        s0 = v * (0.5 - 0.5 * math.cos(2 * math.pi * i / N)) + c * s1 - s2
        s2, s1 = s1, s0
    return db(2 * math.sqrt(max(s1 * s1 + s2 * s2 - c * s1 * s2, 0)) / (N / 2))


# the loudest 1 s window overall, then every tone measured in it
mono = [sum(a[i + c] for c in range(ch)) for i in range(0, len(a), ch)]
W = sr
starts = range(0, n - W + 1, sr // 4)
s0 = max(starts, key=lambda s: sum(v * v for v in mono[s:s + W]))
print(f'window {s0 / sr:.2f}-{(s0 + W) / sr:.2f} s')
for c in range(ch):
    x = [a[i] / 32768 for i in range(c + s0 * ch, (s0 + W) * ch, ch)]
    hits = [(k + 1, f, tone_db(x, f)) for k, f in enumerate(freqs)]
    hits = [h for h in hits if h[2] > -75]
    hits.sort(key=lambda h: -h[2])
    print(f'S-4 return ch {c + 1:2d}: ' + (', '.join(f'sent ch {k} ({f:.0f} Hz) {v:.1f} dB' for k, f, v in hits) or '-'))
