"""Level per 0.5 s block of a 16-bit stereo WAV, and how strongly each block repeats every 1024 samples
(1.0 = a looping 1024-sample buffer). usage: blocks.py file.wav"""
import math, struct, sys, wave

with wave.open(sys.argv[1]) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
M = [(a[i] + a[i + 1]) / 65536 for i in range(0, len(a), ch)]
B = sr // 2
for b in range(0, len(M) - B + 1, B):
    x = M[b:b + B]
    rms = math.sqrt(sum(v * v for v in x) / B)
    num = sum(x[i] * x[i + 1024] for i in range(B - 1024))
    den = math.sqrt(sum(v * v for v in x[:-1024]) * sum(v * v for v in x[1024:])) or 1
    lvl = 20 * math.log10(max(rms, 1e-9))
    print(f'{b / sr:5.1f} s  {lvl:7.1f} dBFS  repeat@1024 {num / den:5.2f}  ' + '#' * max(0, int((lvl + 100) / 3)))
