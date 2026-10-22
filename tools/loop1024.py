"""Does one channel pair of a multichannel 16-bit WAV repeat every 1024 samples (a stale USB block)?
usage: loop1024.py file.wav pair   (pair 0 = master, 1 = T1 ...)"""
import math, struct, sys, wave

path, pair = sys.argv[1], int(sys.argv[2])
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
x = [(a[i * ch + 2 * pair] + a[i * ch + 2 * pair + 1]) / 65536 for i in range(n)]
rms = math.sqrt(sum(v * v for v in x) / n)
for lag in (1024, 512, 2048, 777):
    num = sum(x[i] * x[i + lag] for i in range(n - lag))
    den = math.sqrt(sum(v * v for v in x[:-lag]) * sum(v * v for v in x[lag:])) or 1
    print(f'lag {lag:5d}: correlation {num / den:+.3f}')
print(f'level {20 * math.log10(max(rms, 1e-9)):.1f} dBFS, peak {20 * math.log10(max(max(abs(v) for v in x), 1e-9)):.1f} dBFS')
