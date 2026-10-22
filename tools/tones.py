"""Which test tone is present in each 0.25 s block of a 16-bit stereo WAV (Goertzel at each frequency),
plus the block level. usage: tones.py file.wav 330 440 554.37 ..."""
import math, struct, sys, wave

path, freqs = sys.argv[1], [float(f) for f in sys.argv[2:]]
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
L = [a[i] / 32768 for i in range(0, len(a), ch)]
R = [a[i + 1] / 32768 for i in range(0, len(a), ch)]
db = lambda x: 20 * math.log10(max(x, 1e-9))


def tone_db(x, f):
    N = len(x)
    c = 2 * math.cos(2 * math.pi * f / sr)
    s1 = s2 = 0.0
    for i, v in enumerate(x):
        s0 = v * (0.5 - 0.5 * math.cos(2 * math.pi * i / N)) + c * s1 - s2
        s2, s1 = s1, s0
    p = s1 * s1 + s2 * s2 - c * s1 * s2
    return db(2 * math.sqrt(max(p, 0)) / (N / 2))  # amplitude of a sine, in dBFS


B = sr // 4
print('time    L dBFS  R dBFS  ' + '  '.join(f'{f:>7.0f}Hz' for f in freqs))
for b in range(0, len(L) - B + 1, B):
    xl, xr = L[b:b + B], R[b:b + B]
    lv = [db(math.sqrt(sum(v * v for v in x) / B)) for x in (xl, xr)]
    m = [(p + q) / 2 for p, q in zip(xl, xr)]
    t = [tone_db(m, f) for f in freqs]
    best = max(range(len(freqs)), key=lambda k: t[k])
    mark = f'<- {freqs[best]:.0f} Hz' if t[best] > -60 else ''
    print(f'{b / sr:5.2f}  {lv[0]:6.1f}  {lv[1]:6.1f}  ' + '  '.join(f'{v:9.1f}' for v in t) + '  ' + mark)
