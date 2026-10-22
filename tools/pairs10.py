"""Level of each S-4 return pair (master, T1..T4) per 0.25 s block of a 10-channel 16-bit WAV, plus how
strongly each block repeats every 1024 samples on the pairs that carry sound. usage: pairs10.py file.wav"""
import math, struct, sys, wave

with wave.open(sys.argv[1]) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack('<%dh' % (n * ch), raw)
names = ['MST', 'T1', 'T2', 'T3', 'T4']
B = sr // 4
db = lambda x: 20 * math.log10(max(x, 1e-9))
print('time   ' + ''.join(f'{nm:>8}' for nm in names))
for b in range(0, n - B + 1, B):
    row = []
    for p in range(5):
        s = 0.0
        for c in (2 * p, 2 * p + 1):
            for i in range(b, b + B):
                v = a[i * ch + c] / 32768
                s += v * v
        row.append(db(math.sqrt(s / (2 * B))))
    print(f'{b / sr:5.2f} ' + ''.join(f'{v:8.1f}' for v in row) + '   ' + ' '.join(nm for nm, v in zip(names, row) if v > -70))
