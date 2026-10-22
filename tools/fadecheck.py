import struct, sys

path = sys.argv[1]
data = open(path, 'rb').read()
ch, sr, bits = struct.unpack_from('<H', data, 22)[0], struct.unpack_from('<I', data, 24)[0], struct.unpack_from('<H', data, 34)[0]
pcm = data[44:]
n = len(pcm) // 3 // ch

def sample(i):
    o = i * 3 * ch
    v = pcm[o] | (pcm[o + 1] << 8) | (pcm[o + 2] << 16)
    return (v - (1 << 24) if v & 0x800000 else v) / 8388608.0

def peak(a, b):
    return max(abs(sample(i)) for i in range(a, min(b, n)))

beat = int(round(60 / 90 * sr))
ms = lambda x: int(x * sr / 1000)
print(f'{n} frames, {n / sr:.3f} s, ch={ch} sr={sr} bits={bits}')
for k in range(6):
    s0 = k * beat
    print(f'beat {k + 1}: peak 0-5ms={peak(s0, s0 + ms(5)):.3f}  5-20ms={peak(s0 + ms(5), s0 + ms(20)):.3f}  20-200ms={peak(s0 + ms(20), s0 + ms(200)):.3f}  200ms-end={peak(s0 + ms(200), s0 + beat):.4f}')
print(f'last 300 ms peak: {peak(n - ms(300), n):.5f}')
