"""Level, stereo balance, onsets and loop period of a recorded 16-bit stereo WAV.
usage: analyze.py file.wav [--onsets]"""
import math, struct, sys, wave

path = sys.argv[1]
with wave.open(path) as w:
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n)
L = struct.unpack_from('<%dh' % (n * ch), raw)
left = [L[i] / 32768 for i in range(0, len(L), ch)]
right = [L[i + 1] / 32768 for i in range(0, len(L), ch)] if ch > 1 else left


def db(x):
    return 20 * math.log10(x) if x > 1e-9 else -180.0


def rms(a):
    return math.sqrt(sum(v * v for v in a) / max(1, len(a)))


print(f'{path.split(chr(92))[-1]}: {n / sr:.2f} s  peak {db(max(max(map(abs, left)), max(map(abs, right)))):.1f} dBFS  '
      f'rms L {db(rms(left)):.1f} R {db(rms(right)):.1f} dBFS  (L-R {db(rms(left)) - db(rms(right)):+.1f} dB)')

# 5 ms energy frames, onsets = jumps of > 12 dB above the recent floor
hop = sr // 200
env = [db(rms([(left[i] + right[i]) / 2 for i in range(s, min(n, s + hop))])) for s in range(0, n, hop)]
if '--onsets' in sys.argv:
    on, last = [], -1e9
    for k in range(4, len(env)):
        floor = max(env[k - 4:k])
        if env[k] > -50 and env[k] - floor > 12 and (k - last) * hop / sr > 0.08:
            on.append(k * hop / sr)
            last = k
    print('onsets (s):', ' '.join(f'{t:.3f}' for t in on[:40]))
    if len(on) > 2:
        d = [b - a for a, b in zip(on, on[1:])]
        print('intervals (s):', ' '.join(f'{x:.3f}' for x in d[:39]))
    if '--pitch' in sys.argv:
        # zero-crossing pitch over 3-28 ms after each onset
        hz = []
        for t in on[:40]:
            a, b = int((t + 0.003) * sr), int((t + 0.028) * sr)
            seg = [(left[i] + right[i]) / 2 for i in range(a, min(b, n))]
            zc = [i for i in range(1, len(seg)) if seg[i - 1] < 0 <= seg[i]]
            hz.append((len(zc) - 1) * sr / (zc[-1] - zc[0]) if len(zc) > 2 else 0)
        print('pitch (Hz):', ' '.join(f'{f:.0f}' for f in hz))
