"""Test samples for the S-4 verification project (48 kHz, 24-bit, stereo, seamless loops).
  VERIFY_sig120.wav  8 beats at 120 BPM (4.0 s). Beat k: a 10 ms click at k * beat, then from +20 ms a 200 ms
                     tone at 400 + 100 k Hz (-12 dBFS). Order, spacing, reversal and speed can be read back.
  VERIFY_sig100.wav  the same at 100 BPM (4.8 s).
  VERIFY_sine440.wav 440 Hz at -12 dBFS, 4.0 s (exactly 1760 cycles, so the loop is seamless).
  VERIFY_click8.wav  one click at the start of 8.0 s (4 bars at 120 BPM): echoes of a delay can be timed.
  VERIFY_click16.wav the same click at the start of 16.0 s (8 bars), for delays up to 12 s.
usage: verify_gen.py out_dir"""
import math, os, random, struct, sys, wave

SR = 48000
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
A12 = 10 ** (-12 / 20)


def write(name, x):
    with wave.open(os.path.join(out, name), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        b = bytearray()
        for v in x:
            s = max(-8388607, min(8388607, int(round(v * 8388607))))
            p = struct.pack('<i', s)[:3]
            b += p + p
        w.writeframes(bytes(b))
    print(name, len(x) / SR, 's')


def sig(bpm):
    beat = 60 / bpm
    n = int(round(8 * beat * SR))
    x = [0.0] * n
    rnd = random.Random(7)
    for k in range(8):
        t0 = int(round(k * beat * SR))
        for i in range(int(0.010 * SR)):  # click: decaying noise burst
            x[t0 + i] += (rnd.random() * 2 - 1) * 0.8 * math.exp(-i / (0.002 * SR))
        f, s0, L = 400 + 100 * k, t0 + int(0.020 * SR), int(0.200 * SR)
        fade = int(0.005 * SR)
        for i in range(L):
            g = min(1.0, i / fade, (L - 1 - i) / fade)
            x[s0 + i] += A12 * g * math.sin(2 * math.pi * f * i / SR)
    return x


write('VERIFY_sig120.wav', sig(120))
write('VERIFY_sig100.wav', sig(100))
write('VERIFY_sine440.wav', [A12 * math.sin(2 * math.pi * 440 * i / SR) for i in range(4 * SR)])
rnd = random.Random(7)
click = [0.0] * (8 * SR)
for i in range(int(0.010 * SR)):
    click[i] = (rnd.random() * 2 - 1) * 0.8 * math.exp(-i / (0.002 * SR))
write('VERIFY_click8.wav', click)
write('VERIFY_click16.wav', click + [0.0] * (8 * SR))
