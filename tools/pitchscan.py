"""Precise pitch of each beat in given time ranges: Goertzel scan of a Hann-windowed 60 ms frame
taken 10 ms after each onset. usage: pitchscan.py file.wav start1-end1 start2-end2 ..."""
import math, struct, sys, wave

path = sys.argv[1]
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
a = struct.unpack_from('<%dh' % (n * ch), raw)
M = [(a[i] + a[i + 1]) / 65536 for i in range(0, len(a), ch)]


def onsets(s0, s1):
    hop = sr // 200
    env = []
    for s in range(s0, s1, hop):
        seg = M[s:s + hop]
        e = math.sqrt(sum(v * v for v in seg) / max(1, len(seg)))
        env.append(20 * math.log10(e) if e > 1e-9 else -180)
    out, last = [], -1e9
    for k in range(4, len(env)):
        if env[k] > -50 and env[k] - max(env[k - 4:k]) > 12 and k - last > 16:
            out.append(s0 + k * hop)
            last = k
    return out


def peak(x0, lo=200, hi=1600):
    N = int(0.06 * sr)
    frame = [M[x0 + j] * (0.5 - 0.5 * math.cos(2 * math.pi * j / N)) for j in range(N)]
    best, bf = -1, 0
    f = lo
    while f <= hi:
        w = 2 * math.pi * f / sr
        c = 2 * math.cos(w)
        s1 = s2 = 0.0
        for v in frame:
            s0 = v + c * s1 - s2
            s2, s1 = s1, s0
        p = s1 * s1 + s2 * s2 - c * s1 * s2
        if p > best:
            best, bf = p, f
        f += 2 if f < hi else 1
    # refine around the coarse peak in 0.25 Hz steps
    for f in [bf + d / 4 for d in range(-8, 9)]:
        w = 2 * math.pi * f / sr
        c = 2 * math.cos(w)
        s1 = s2 = 0.0
        for v in frame:
            s0 = v + c * s1 - s2
            s2, s1 = s1, s0
        p = s1 * s1 + s2 * s2 - c * s1 * s2
        if p > best:
            best, bf = p, f
    return bf


for rng in sys.argv[2:]:
    t0, t1 = (float(x) for x in rng.split('-'))
    ons = onsets(int(t0 * sr), int(t1 * sr))[:8]
    print(f'{rng}: ' + ' '.join(f'{peak(o + int(0.01 * sr)):.1f}' for o in ons))
