"""Measure a 10-channel recording of the S-4 playing S4T VERIFY (verify_build.js) and check every scene
against what the app intends. Channels: 1/2 master, 3/4 T1, 5/6 T2, 7/8 T3, 9/10 T4 (16-bit, 48 kHz).
Pure Python. Measures per track: click spacing, the 8-tone sequence (order, reversal, speed ratio), steady
pitch (zero crossings), level (RMS dB), left / right balance, harmonic distortion.
usage: verify_analyze.py recording.wav [--selftest dir_with_VERIFY_wavs]"""
import array, cmath, math, sys, wave

SR = 48000
NOMINAL = [400 + 100 * k for k in range(8)]
cents = lambda a, b: 1200 * math.log2(a / b)
db = lambda v: 20 * math.log10(max(v, 1e-12))


def load(path):
    with wave.open(path) as w:
        ch, n, sw = w.getnchannels(), w.getnframes(), w.getsampwidth()
        raw = w.readframes(n)
    if sw == 2:
        a = array.array('h'); a.frombytes(raw); scale = 32768.0
        return [[v / scale for v in a[c::ch]] for c in range(ch)]
    if sw == 3:  # 24-bit
        vals = [int.from_bytes(raw[i:i + 3], 'little', signed=True) / 8388608.0 for i in range(0, len(raw), 3)]
        return [vals[c::ch] for c in range(ch)]
    raise ValueError('16 or 24-bit only')


def rms(x):
    return math.sqrt(sum(v * v for v in x) / max(1, len(x)))


def zc_freq(x):
    """frequency from rising zero crossings (linear interpolation); None if too few"""
    pts, prev = [], x[0]
    for i in range(1, len(x)):
        cur = x[i]
        if prev < 0 <= cur and cur != prev:
            pts.append(i - 1 + (-prev) / (cur - prev))
        prev = cur
    if len(pts) < 4:
        return None
    return (len(pts) - 1) * SR / (pts[-1] - pts[0])


def fft(x):
    n = len(x)
    if n == 1:
        return x
    ev, od = fft(x[0::2]), fft(x[1::2])
    t = [cmath.exp(-2j * math.pi * k / n) * od[k] for k in range(n // 2)]
    return [ev[k] + t[k] for k in range(n // 2)] + [ev[k] - t[k] for k in range(n // 2)]


def peaks(x, n=65536, floor=0.03):
    """spectral peaks (Hz, linear amplitude), parabolic interpolation on a Hann-windowed FFT, strongest first"""
    x = x[:n] + [0.0] * max(0, n - len(x))
    m = min(len(x), n)
    X = [abs(c) for c in fft([v * (0.5 - 0.5 * math.cos(2 * math.pi * i / m)) for i, v in enumerate(x[:n])])[:n // 2]]
    top = max(X) or 1
    out = []
    for k in range(2, len(X) - 2):
        if X[k] > X[k - 1] and X[k] >= X[k + 1] and X[k] > top * floor:
            a, b, c = math.log(X[k - 1] + 1e-12), math.log(X[k]), math.log(X[k + 1] + 1e-12)
            den = a - 2 * b + c
            d = 0.5 * (a - c) / den if den else 0
            out.append(((k + d) * SR / n, X[k]))
    return sorted(out, key=lambda p: -p[1])


def W(u):
    """magnitude of a Hann window's spectrum at u bins of its length (main lobe)"""
    u = abs(u)
    if u < 1e-9:
        return 1.0
    if abs(u - 1) < 1e-9:
        return 0.5
    return abs(math.sin(math.pi * u) / (math.pi * u) / (1 - u * u))


def comb_center(pk):
    """The S-4's granular stretch turns a tone into lines one grain rate apart around the true pitch. With
    Hann grains of two grain periods, the two strongest neighbouring lines' amplitude ratio gives the centre.
    Returns (centre Hz, grain rate Hz), or None when the spectrum is a single line."""
    if len(pk) < 2:
        return None
    (fa, aa), (fb, ab) = pk[0], pk[1]
    g = abs(fa - fb)
    if not 40 < g < 200 or ab < 0.05 * aa:
        return None
    hi, lo = (fa, aa), (fb, ab)
    if fb > fa:
        hi, lo = lo, hi
    T = 2 / g
    want = hi[1] / lo[1]
    a, b = lo[0], hi[0]
    for _ in range(60):  # ratio W(hi - fc) / W(fc - lo) rises as fc moves up
        m = (a + b) / 2
        r = W((hi[0] - m) * T) / max(W((m - lo[0]) * T), 1e-12)
        a, b = (m, b) if r < want else (a, m)
    return (a + b) / 2, g


def pitch(x, granular=False, n=65536):
    """pitch of a steady tone: the strongest spectral line, or the grain comb's centre"""
    pk = peaks(x, n)
    if not pk:
        return None
    if granular:
        c = comb_center(pk)
        if c:
            return c[0]
    return pk[0][0]


def goertzel(x, f):
    N = len(x)
    c = 2 * math.cos(2 * math.pi * f / SR)
    s1 = s2 = 0.0
    for i, v in enumerate(x):
        s0 = v * (0.5 - 0.5 * math.cos(2 * math.pi * i / N)) + c * s1 - s2
        s2, s1 = s1, s0
    return 2 * math.sqrt(max(s1 * s1 + s2 * s2 - c * s1 * s2, 0)) / (N / 2)


def onsets(x, refractory=0.15):
    """click times: block maxima of the first difference crossing a quarter of their peak"""
    B = 48
    env = []
    for i in range(1, len(x) - B, B):
        env.append(max(abs(x[j] - x[j - 1]) for j in range(i, i + B)))
    if not env:
        return []
    thr = 0.25 * max(env)
    out, last = [], -1e9
    for k, e in enumerate(env):
        t = k * B / SR
        if e >= thr and t - last > refractory:
            out.append(t)
            last = t
    return out


def tones(x, ons, reverse=False, granular=False):
    """frequency of the tone after (or, reversed, before) each click; granular: the grain comb's centre over
    the burst (8192-point FFT), otherwise zero crossings"""
    out = []
    for t in ons:
        if granular:
            a, b = int((t + 0.025) * SR), int((t + 0.025) * SR) + 8192
        elif reverse:
            a, b = int((t - 0.090) * SR), int((t - 0.030) * SR)
        else:
            a, b = int((t + 0.030) * SR), int((t + 0.090) * SR)
        if a < 0 or b > len(x):
            continue
        f = pitch(x[a:b], True, 8192) if granular else zc_freq(x[a:b])
        if f and rms(x[a:b]) > 0.003:
            out.append(f)
    return out


def classify(fs, ratio):
    """beat index of each tone at a speed ratio, and the measured ratio (median of f / nominal)"""
    idx, rs = [], []
    for f in fs:
        k = min(range(8), key=lambda j: abs(f / ratio - NOMINAL[j]))
        idx.append(k)
        rs.append(f / NOMINAL[k])
    rs.sort()
    return idx, (rs[len(rs) // 2] if rs else None)


def spacing(ons):
    d = sorted(b - a for a, b in zip(ons, ons[1:]))
    return d[len(d) // 2] if d else None


def segments(chans, gap=0.8, minlen=2.0):
    """scene segments: 10 ms frames where any channel is above -55 dBFS, joined over gaps shorter than `gap`"""
    F = 480
    n = len(chans[0])
    act = []
    for i in range(0, n - F, F):
        act.append(any(max(abs(v) for v in c[i:i + F:4]) > 0.0018 for c in chans))
    segs, start, quiet = [], None, 0
    for k, a in enumerate(act):
        if a:
            if start is None:
                start = k
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet * F / SR >= gap:
                end = k - quiet + 1
                if (end - start) * F / SR >= minlen:
                    segs.append((start * F, end * F))
                start, quiet = None, 0
    if start is not None and (len(act) - start) * F / SR >= minlen:
        segs.append((start * F, len(act) * F))
    return segs


def track(chans, t, a, b):
    L, R = chans[2 + 2 * t][a:b], chans[3 + 2 * t][a:b]
    return [(l + r) / 2 for l, r in zip(L, R)], L, R


def report_track(name, x, L, R, exp):
    """exp: dict of expectations; returns (lines, measured)"""
    m = {'level': db(rms(x)), 'lr': db(rms(L)) - db(rms(R))}
    lines, bad = [], []
    if m['level'] < -70:
        lines.append(f'  {name}: silent ({m["level"]:.1f} dB)')
        return lines, m, (['silent'] if exp.get('kind') not in (None, 'silent') else [])
    kind = exp.get('kind')
    if kind == 'sig':
        ons = onsets(x)
        sp = spacing(ons)
        fs = tones(x, ons, exp.get('reverse', False), exp.get('granular', False))
        idx, r = classify(fs, exp.get('ratio', 1.0))
        m.update(spacing=sp, ratio=r, order=idx[:12])
        if exp.get('spacing') and (sp is None or abs(sp - exp['spacing']) > 0.01 * exp['spacing']):
            bad.append(f'spacing {sp} != {exp["spacing"]}')
        if exp.get('ratio') and (r is None or abs(cents(r, exp['ratio'])) > 10):
            bad.append(f'ratio {r} != {exp["ratio"]:.4f}')
        if exp.get('order'):
            want = exp['order']
            got = idx[:len(want) * 2]
            if not any(got[i:i + len(want)] == want for i in range(len(got) - len(want) + 1)):
                bad.append(f'order {got} lacks {want}')
        lines.append(f'  {name}: level {m["level"]:.2f} dB, L-R {m["lr"]:+.2f} dB, spacing {sp and round(sp, 4)} s, ratio {r and round(r, 4)}, beats {idx[:12]}')
    elif kind == 'sine':
        mid = x[len(x) // 4: len(x) * 3 // 4] if len(x) > SR else x
        f = pitch(mid, exp.get('granular', False))
        h = [goertzel(mid[:SR], f * k) for k in (1, 2, 3, 4, 5)] if f else None
        thd = db(math.sqrt(sum(v * v for v in h[1:])) / h[0]) if h and h[0] > 0 else None
        m.update(freq=f, thd=thd)
        if exp.get('freq') and (f is None or abs(cents(f, exp['freq'])) > 5):
            bad.append(f'freq {f} != {exp["freq"]:.2f}')
        lines.append(f'  {name}: level {m["level"]:.2f} dB, L-R {m["lr"]:+.2f} dB, {f and round(f, 2)} Hz'
                     + (f' ({cents(f, exp["freq"]):+.1f} c vs {exp["freq"]:.2f})' if f and exp.get('freq') else '') + (f', THD {thd:.1f} dB' if thd is not None else ''))
    else:
        lines.append(f'  {name}: level {m["level"]:.2f} dB, L-R {m["lr"]:+.2f} dB')
    return lines, m, bad


ST = lambda s: 2 ** (s / 12)
# expectations per scene (verify_build.js), per track T1..T4; 'rel' checks run after measuring
PLAN = [
    ('BASELINE', [{'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': [0, 1, 2, 3, 4, 5, 6, 7]},
                  {'kind': 'sig', 'spacing': 0.5, 'ratio': 1},
                  {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'reverse': True, 'order': [7, 6, 5, 4, 3, 2, 1, 0]},
                  {'kind': 'sig', 'spacing': 0.5, 'ratio': 1}]),
    ('START/LENGTH, OFFSET, AS RECORDED', [{'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': [2, 3, 4, 5, 2, 3, 4, 5]},
                                         {'kind': 'sig', 'spacing': 0.5, 'ratio': 1},
                                         {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': [0, 1, 2, 3, 4, 5, 6, 7]},
                                         {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': [0, 1, 2, 3, 4, 5, 6, 7]}]),
    ('DISC SPEED', [{'kind': 'sine', 'freq': 880}, {'kind': 'sine', 'freq': 440 * ST(4)},
                    {'kind': 'sig', 'ratio': ST(4)}, {'kind': 'sig', 'ratio': 0.5}]),
    # the S-4's own stretch is granular: pitch read as the centre of its grain comb
    ('DISC STRETCH (S-4)', [{'kind': 'sine', 'freq': 440 * ST(7), 'granular': True},
                            {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': [0, 1, 2, 3, 4, 5, 6, 7], 'granular': True},
                            {'kind': 'sine', 'freq': 440 * ST(5), 'granular': True}, {'kind': 'sig', 'spacing': 0.5, 'ratio': ST(-5), 'granular': True}]),
    ('100 BPM LOOP AT 120', [{'kind': 'sig', 'spacing': 0.5, 'ratio': 1.2, 'order': [0, 1, 2, 3, 4, 5, 6, 7]},
                             {'kind': 'sig', 'spacing': 0.5, 'ratio': 1.2, 'order': [0, 1, 2, 3, 4, 5, 6, 7]},
                             {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': [0, 1, 2, 3, 4, 5, 6, 7]},
                             {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': [0, 1, 2, 3, 4, 5, 6, 7]}]),
    # POLY: note 60 plays the sample at its own pitch (measured), so PITCH moves it from 440 Hz
    ('TAPE SPEED, POLY PITCH', [{'kind': 'sine', 'freq': 440 * ST(5)}, {'kind': 'sine', 'freq': 220}, {'kind': 'sine', 'freq': 440}, {'kind': 'sine', 'freq': 440 * ST(3)}]),
    ('FREE PITCHES', [{'kind': 'sine', 'freq': 440 * ST(2.5)}, {'kind': 'sine', 'freq': 440 * ST(2)}, {'kind': 'sine', 'freq': 440 * ST(-4)}, {'kind': 'sine', 'freq': 880}]),
    ('SENDS', [{'kind': 'sine', 'freq': 440}, {'kind': 'sine', 'freq': 440}, {'kind': 'silent'}, {'kind': 'silent'}]),
    ('EFFECTS', [{'kind': 'sine', 'freq': 440}, {'kind': 'sine', 'freq': 440}, {'kind': 'sine', 'freq': 440}, {'kind': 'silent'}]),
    ('T4 ALONE', [{'kind': 'silent'}, {'kind': 'silent'}, {'kind': 'silent'}, {'kind': 'sine', 'freq': 440}]),
]


def offset_between(x, ref):
    """time shift of x against ref: tone sequences aligned by the click times (s, positive = x later)"""
    ox, orf = onsets(x), onsets(ref)
    ix, _ = classify(tones(x, ox), 1.0)
    ir, _ = classify(tones(ref, orf), 1.0)
    # content time of each click = its beat index * 0.5; offset = playing time - content time, compared
    px = sorted(((t - k * 0.5) % 4.0) for t, k in zip(ox, ix))
    pr = sorted(((t - k * 0.5) % 4.0) for t, k in zip(orf, ir))
    if not px or not pr:
        return None
    d = (px[len(px) // 2] - pr[len(pr) // 2]) % 4.0
    return d - 4.0 if d > 2.0 else d


def main(path):
    chans = load(path)
    segs = segments(chans)
    print(f'{path}: {len(chans[0]) / SR:.1f} s, {len(segs)} scenes found (expected {len(PLAN)})')
    M, fails = [], []
    for s, (a, b) in enumerate(segs[:len(PLAN)]):
        title, exps = PLAN[s]
        print(f'SCENE {s + 1} {title}: {a / SR:.2f}-{b / SR:.2f} s')
        mx = [(l + r) / 2 for l, r in zip(chans[0][a:b], chans[1][a:b])]
        print(f'  master: level {db(rms(mx)):.2f} dB, L-R {db(rms(chans[0][a:b])) - db(rms(chans[1][a:b])):+.2f} dB')
        row = []
        for t in range(4):
            x, L, R = track(chans, t, a, b)
            lines, m, bad = report_track(f'T{t + 1}', x, L, R, exps[t])
            for ln in lines:
                print(ln)
            for e in bad:
                print(f'    !! {e}')
                fails.append(f'scene {s + 1} T{t + 1}: {e}')
            m['x'] = x
            row.append(m)
        M.append(row)
    # relations
    print('RELATIONS')
    rel = []
    if len(M) >= 1:
        rel.append(('scene 1 T2 LEVEL -6 dB', M[0][1]['level'] - M[0][0]['level'], -6.0, 0.3))
        rel.append(('scene 1 T4 return vs T1 (mixer -6 dB if post-fader)', M[0][3]['level'] - M[0][0]['level'], None, None))
        rel.append(('scene 1 T4 return L-R (mixer pan -0.5 if post-fader)', M[0][3]['lr'], None, None))
    if len(M) >= 2:
        off = offset_between(M[1][1]['x'], M[1][2]['x'])
        rel.append(('scene 2 T2 OFFSET +0.6 s: shift vs T3 (s)', off, None, None))
    if len(M) >= 6 and M[5][2].get('freq') and M[5][3].get('freq'):
        rel.append(('scene 6 POLY +3 st vs POLY 0 (cents)', cents(M[5][3]['freq'], M[5][2]['freq']), 300.0, 5))
        if len(M) >= 7 and M[6][0].get('freq'):
            rel.append(('scene 7 POLY FREE +2.5 st vs scene 6 POLY 0 (cents)', cents(M[6][0]['freq'], M[5][2]['freq']), 250.0, 5))
    if len(M) >= 8:
        rel.append(('scene 8 T2 (send -6 dB) vs T1 (dB)', M[7][1]['level'] - M[7][0]['level'], -6.0, 0.5))
    if len(M) >= 9:
        rel.append(('scene 9 T2 (effects not set) vs T1 (bypassed), level dB', M[8][1]['level'] - M[8][0]['level'], None, None))
        rel.append(('scene 9 THD: T1 bypassed / T2 not set / T3 DEFORM drive', [M[8][k].get('thd') for k in range(3)], None, None))
    if len(M) >= 10:
        rel.append(('scene 10 T4 return vs scene 1 T1 (dB)', M[9][3]['level'] - M[0][0]['level'], None, None))
    for name, v, want, tol in rel:
        ok = '' if want is None else ('ok' if v is not None and abs(v - want) <= tol else '!! expected %+.2f' % want)
        if want is not None and ok != 'ok':
            fails.append(f'{name}: {v} (expected {want})')
        vs = [None if q is None else round(q, 2) for q in v] if isinstance(v, list) else (None if v is None else round(v, 3))
        print(f'  {name}: {vs} {ok}')
    print('RESULT:', 'all checks passed' if not fails else f'{len(fails)} failed')
    for f in fails:
        print('  -', f)


def selftest(d):
    """the analysis itself, on the source samples: a fake recording with known changes"""
    import os
    sig = load(os.path.join(d, 'VERIFY_sig120.wav'))[0]
    sine = load(os.path.join(d, 'VERIFY_sine440.wav'))[0]
    sig100 = load(os.path.join(d, 'VERIFY_sig100.wav'))[0]
    loop = lambda x, n: (x * (n // len(x) + 1))[:n]
    N = 6 * SR
    def speed(x, r):  # linear-interpolation varispeed
        out, i = [], 0.0
        while int(i) + 1 < len(x):
            j = int(i); out.append(x[j] + (x[j + 1] - x[j]) * (i - j)); i += r
        return out
    a = loop(sig, N)
    checks = {
        'sig120 spacing 0.5, ascending': report_track('sig', a, a, a, {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'order': list(range(8))}),
        'sig120 reversed': report_track('rev', loop(sig[::-1], N), a, a, {'kind': 'sig', 'spacing': 0.5, 'ratio': 1, 'reverse': True, 'order': [7, 6, 5, 4, 3, 2, 1, 0]}),
        'sig100 x1.2': report_track('x1.2', loop(speed(sig100, 1.2), N), a, a, {'kind': 'sig', 'spacing': 0.5, 'ratio': 1.2, 'order': list(range(8))}),
        'sine440': report_track('sine', loop(sine, N), a, a, {'kind': 'sine', 'freq': 440}),
        'sine440 x1.5': report_track('sine', loop(speed(sine, 1.5), N), a, a, {'kind': 'sine', 'freq': 660}),
    }
    for k, (lines, m, bad) in checks.items():
        print(k, '->', lines[0].strip(), '| FAIL ' + '; '.join(bad) if bad else '| ok')
    shifted = loop(sig[int(0.6 * SR):] + sig[:int(0.6 * SR)], N)
    print('offset of a 0.6 s advance:', round(offset_between(shifted, a), 4), '(content 0.6 s earlier = -0.6)')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--selftest':
        selftest(sys.argv[2])
    else:
        main(sys.argv[1])
