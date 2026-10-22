"""Split a recording into sounding segments (separated by >= 0.8 s of silence) and measure each:
duration, RMS level and L/R balance, onsets, intervals between onsets, and pitch at each onset."""
import math, struct, sys, wave

path = sys.argv[1]
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack_from('<%dh' % (n * ch), raw)
L = [a[i] / 32768 for i in range(0, len(a), ch)]
R = [a[i + 1] / 32768 for i in range(0, len(a), ch)]
M = [(x + y) / 2 for x, y in zip(L, R)]
db = lambda x: 20 * math.log10(x) if x > 1e-9 else -180.0
rms = lambda s: math.sqrt(sum(v * v for v in s) / max(1, len(s)))

hop = sr // 200                                    # 5 ms frames
env = [db(rms(M[s:s + hop])) for s in range(0, n, hop)]
active = [e > -60 for e in env]
segs, start, quiet = [], None, 0
for k, on in enumerate(active):
    if on:
        if start is None:
            start = k
        quiet = 0
    elif start is not None:
        quiet += 1
        if quiet * hop / sr >= 0.8:
            segs.append((start, k - quiet + 1))
            start, quiet = None, 0
if start is not None:
    segs.append((start, len(active)))

for i, (s0, s1) in enumerate(segs, 1):
    a0, a1 = s0 * hop, s1 * hop
    lv, rv = db(rms(L[a0:a1])), db(rms(R[a0:a1]))
    on, last = [], -1e9
    for k in range(max(s0, 4), s1):
        floor = max(env[k - 4:k])
        if env[k] > -50 and env[k] - floor > 12 and (k - last) * hop / sr > 0.08:
            on.append(k)
            last = k
    times = [(k - s0) * hop / sr for k in on]
    iv = [b - a for a, b in zip(times, times[1:])]
    hz = []
    for k in on[:12]:
        x0, x1 = k * hop + int(0.003 * sr), k * hop + int(0.028 * sr)
        seg = M[x0:x1]
        zc = [j for j in range(1, len(seg)) if seg[j - 1] < 0 <= seg[j]]
        hz.append(round((len(zc) - 1) * sr / (zc[-1] - zc[0])) if len(zc) > 2 else 0)
    print(f'segment {i}: at {a0 / sr:6.2f}s  dur {(a1 - a0) / sr:5.2f}s  rms L {lv:6.1f} R {rv:6.1f} (L-R {lv - rv:+.1f} dB)  onsets {len(on)}')
    if iv:
        print('   intervals:', ' '.join(f'{x:.3f}' for x in iv[:16]))
    if hz:
        print('   pitch Hz :', ' '.join(str(h) for h in hz))
    if '--profile' in sys.argv:
        prof = []
        for off in (0.03, 0.1, 0.17, 0.25, 0.33, 0.5, 0.8, 1.2):
            x0 = a0 + int(off * sr)
            if x0 + int(0.03 * sr) > a1:
                break
            seg = M[x0:x0 + int(0.03 * sr)]
            zc = [j for j in range(1, len(seg)) if seg[j - 1] < 0 <= seg[j]]
            f = round((len(zc) - 1) * sr / (zc[-1] - zc[0])) if len(zc) > 2 else 0
            prof.append(f'{off:.2f}s:{f}Hz/{db(rms(seg)):.0f}dB')
        print('   profile  :', '  '.join(prof))
