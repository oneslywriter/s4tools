"""Describe a steady tone in a 16-bit stereo WAV: level per channel, fundamental, harmonics, waveform shape,
and whether it is steady over time. usage: tone.py file.wav"""
import cmath, math, struct, sys, wave

with wave.open(sys.argv[1]) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
L = [a[i] / 32768 for i in range(0, len(a), ch)]
R = [a[i + 1] / 32768 for i in range(0, len(a), ch)] if ch > 1 else L
db = lambda x: 20 * math.log10(max(x, 1e-9))
for name, x in (('L', L), ('R', R)):
    rms = math.sqrt(sum(v * v for v in x) / len(x))
    pk = max(abs(v) for v in x)
    print(f'{name}: rms {db(rms):.1f} dBFS, peak {db(pk):.1f} dBFS, crest {pk / max(rms, 1e-9):.2f} (sine 1.41, square 1.00), DC {sum(x) / len(x):+.4f}')
M = [(l + r) / 2 for l, r in zip(L, R)]
# fundamental: autocorrelation of 0.25 s, 30 Hz - 4 kHz
seg = M[sr // 2: sr // 2 + sr // 4]
mean = sum(seg) / len(seg)
seg = [v - mean for v in seg]
best, lag = -1e9, 0
for l in range(sr // 4000, sr // 30):
    c = sum(seg[i] * seg[i + l] for i in range(0, len(seg) - l, 2))
    if c > best:
        best, lag = c, l
# refine with parabolic interpolation
def ac(l): return sum(seg[i] * seg[i + l] for i in range(0, len(seg) - l, 2))
y0, y1, y2 = ac(lag - 1), ac(lag), ac(lag + 1)
d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) else 0
f0 = sr / (lag + d)
print(f'fundamental ~ {f0:.2f} Hz (period {1000 / f0:.2f} ms)')
# harmonic levels relative to the fundamental (DFT at k*f0 over 1 s)
x = M[:sr]
def amp(f): return abs(sum(v * cmath.exp(-2j * math.pi * f * i / sr) for i, v in enumerate(x[::2]) )) if False else abs(sum(x[i] * cmath.exp(-2j * math.pi * f * i / sr) for i in range(0, len(x), 3)))
h1 = amp(f0)
print('harmonics (dB rel. 1st): ' + ', '.join(f'{k}:{db(amp(k * f0) / h1):.0f}' for k in range(2, 8)))
# steadiness: level and pitch in 0.5 s blocks
for b in range(0, len(M) - sr // 2 + 1, sr // 2):
    blk = M[b:b + sr // 2]
    rms = math.sqrt(sum(v * v for v in blk) / len(blk))
    zc = sum(1 for i in range(1, len(blk)) if (blk[i - 1] - mean) < 0 <= (blk[i] - mean))
    print(f'  {b / sr:.1f}-{(b + sr // 2) / sr:.1f} s: rms {db(rms):.1f} dBFS, ~{zc * 2:.0f} upward crossings/s')
