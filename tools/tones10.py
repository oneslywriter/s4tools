"""For a multichannel 16-bit WAV: which test tone appears on which channel pair, and how loud.
usage: tones10.py file.wav 330 440 554.37 ..."""
import math, struct, sys, wave

path, freqs = sys.argv[1], [float(f) for f in sys.argv[2:]]
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
chans = [[a[i] / 32768 for i in range(c, len(a), ch)] for c in range(ch)]
db = lambda x: 20 * math.log10(max(x, 1e-9))


def tone_db(x, f):
    N = len(x)
    c = 2 * math.cos(2 * math.pi * f / sr)
    s1 = s2 = 0.0
    for i, v in enumerate(x):
        s0 = v * (0.5 - 0.5 * math.cos(2 * math.pi * i / N)) + c * s1 - s2
        s2, s1 = s1, s0
    return db(2 * math.sqrt(max(s1 * s1 + s2 * s2 - c * s1 * s2, 0)) / (N / 2))


print(f'{ch} channels, {n / sr:.1f} s')
for p in range(0, ch, 2):
    L, R = chans[p], chans[p + 1] if p + 1 < ch else chans[p]
    rms = [db(math.sqrt(sum(v * v for v in x) / len(x))) for x in (L, R)]
    m = [(x + y) / 2 for x, y in zip(L, R)]
    # strongest level of each tone over any 0.5 s window
    W = sr // 2
    best = []
    for f in freqs:
        top = max(tone_db(m[s:s + W], f) for s in range(0, len(m) - W + 1, W // 2))
        best.append(top)
    found = [f'{f:.0f} Hz at {v:.1f} dBFS' for f, v in zip(freqs, best) if v > -70]
    print(f'return ch {p + 1}/{p + 2}: overall {rms[0]:.1f}/{rms[1]:.1f} dBFS | ' + (', '.join(found) or 'no test tone'))
