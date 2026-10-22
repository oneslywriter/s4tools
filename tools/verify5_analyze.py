"""Measure a 10-channel recording of S4T VERIFY5 (verify5_build.js / verify5_play.js). The plays follow PLAN
(scene index, seconds) with 1.6 s gaps, from the first sound.
The first seconds of any recording run sharp (+5 c falling to +1 c over 4 s, the same on every track and scene:
the capture settling; scene 1 replayed later is at 0 c), so start the recorder about 10 s before the first play.
usage: verify5_analyze.py recording.wav"""
import math, sys
from verify_analyze import load, rms, db, peaks, pitch, SR, cents
from verify2_analyze import measure
from verify4_analyze import DIVS, beats, centre, echo

PLAN = [(0, 6), (1, 6), (2, 6), (2, 6), (3, 14), (3, 14), (4, 8), (5, 8), (6, 10)]
GAP = 1.6


def mono(ch, t, a, b):
    return [(l + r) / 2 for l, r in zip(ch[2 + 2 * t][a:b], ch[3 + 2 * t][a:b])]


def trace(x):
    """the sine's pitch per cycle: (time s, semitones re 440 Hz), from rising zero crossings"""
    zc = [i - 1 + x[i - 1] / (x[i - 1] - x[i]) for i in range(1, len(x)) if x[i - 1] < 0 <= x[i]]
    return [((zc[k] + zc[k + 1]) / 2 / SR, 12 * math.log2(SR / (zc[k + 1] - zc[k]) / 440)) for k in range(len(zc) - 1)]


def grid(tr, step=0.001):
    """the trace resampled every step seconds"""
    out, j = [], 0
    t = tr[0][0]
    while t < tr[-1][0]:
        while tr[j + 1][0] < t:
            j += 1
        (t0, a), (t1, b) = tr[j], tr[j + 1]
        out.append(a + (b - a) * (t - t0) / (t1 - t0))
        t += step
    return out


def median(g, w=15):
    """a running median over w points: removes the one- or two-cycle spikes the DISC's fast varispeed leaves"""
    h = w // 2
    return [sorted(g[max(0, i - h):i + h + 1])[len(g[max(0, i - h):i + h + 1]) // 2] for i in range(len(g))]


def period(g, step=0.001):
    """the LFO period: the strongest line of a periodogram over 0.15 .. 1.5 s, refined to 0.1 ms (robust against
    the spikes, unlike zero crossings)"""
    m = sum(g) / len(g)
    d = [v - m for v in g]
    ts = [i * step for i in range(len(d))]

    def power(p):
        c = s_ = 0.0
        w = 2 * math.pi / p
        for t, v in zip(ts[::4], d[::4]):
            c += v * math.cos(w * t)
            s_ += v * math.sin(w * t)
        return c * c + s_ * s_
    # coarse in frequency, then finer around the best
    best = max((1 / f for f in [0.67 + 0.01 * k for k in range(600)]), key=power)
    for res in (0.001, 0.0001):
        best = max((best + res * k for k in range(-15, 16)), key=power)
    return best


def shape(g, per, step=0.001, bins=100):
    """the trace folded over one period, compared with sine / triangle / square / saw templates (best correlation
    over all phases)"""
    acc, cnt = [0.0] * bins, [0] * bins
    for i, v in enumerate(g):
        b = int(((i * step) % per) / per * bins) % bins
        acc[b] += v
        cnt[b] += 1
    f = [a / c for a, c in zip(acc, cnt) if c]
    n = len(f)
    m = sum(f) / n
    f = [v - m for v in f]
    T = {
        'sine': [math.sin(2 * math.pi * k / n) for k in range(n)],
        'triangle': [1 - 4 * abs(k / n - 0.5) for k in range(n)],
        'square': [1 if k < n / 2 else -1 for k in range(n)],
        'saw up': [2 * k / n - 1 for k in range(n)],
        'saw down': [1 - 2 * k / n for k in range(n)],
    }
    out = {}
    for name, tp in T.items():
        tm = sum(tp) / n
        tp = [v - tm for v in tp]
        nt = math.sqrt(sum(v * v for v in tp)) * math.sqrt(sum(v * v for v in f)) or 1
        out[name] = max(sum(f[i] * tp[(i + s) % n] for i in range(n)) / nt for s in range(n))
    return out


def main(path):
    ch = load(path)
    n = len(ch[0])
    first = next(i for i in range(0, n, 48) if any(abs(c[i]) > 0.003 for c in ch))
    starts, t = [], first
    for s, sec in PLAN:
        starts.append(t)
        t += int((sec + GAP) * SR)
    fails = []

    def check(ok, what):
        if not ok:
            fails.append(what)
        return 'ok' if ok else '!!'

    print('SCENES 1 (active at load) AND 2: scale modes')
    want = [('DISC SPEED MAJOR +4', 440 * 2 ** (4 / 12)), ('DISC SPEED MINOR -4', 440 * 2 ** (-4 / 12)),
            ('MOSAIC PITCH MINOR -4', 440 * 2 ** (-4 / 12)), ('DISC FREE +2', 440 * 2 ** (2 / 12))]
    for k in (0, 1):
        a = starts[k] + int(0.5 * SR)
        M = measure(ch, a, a + int(5 * SR))
        for tn, (what, f0) in enumerate(want):
            f = centre(mono(ch, tn, a, a + 65536)) if tn == 2 else M[tn + 1].get('freq')
            c = cents(f, f0) if f else None
            print(f'  scene {k + 1} T{tn + 1} {what:22}: {f and round(f, 2)} Hz, expected {f0:.2f} ({c and round(c, 1)} c) {check(c is not None and abs(c) < 10, f"scene {k + 1} T{tn + 1}")}')

    print('VAST TIME (echo after the click, 120 BPM; the first play of a scene follows other delay times: shown, not checked)')
    vt = {2: [('straight 1/8', 0.25), ('straight 1/16', 0.125), ('straight 1/1', 2.0), ('FREE 2 Hz', 0.5)],
          3: [('straight 2/1', 4.0), ('straight 4/1', 8.0), ('dotted 2/1D', 6.0), ('dotted 4/1D', 12.0)]}
    for k, (s, sec) in enumerate(PLAN):
        if s not in vt:
            continue
        settled = k > 0 and PLAN[k - 1][0] == s
        a = starts[k] - int(0.2 * SR)
        for tn, (what, w) in enumerate(vt[s]):
            d = echo(mono(ch, tn, a, a + int((sec - 0.3) * SR)))
            ok = d is not None and abs(d - w) < max(0.004, 0.01 * w)
            mark = check(ok, f'VAST scene {s + 1} T{tn + 1} {what}: {d}') if settled else ''
            print(f'  play {k + 1} scene {s + 1} T{tn + 1} {what:14}: echo {d} s, expected {w} s {mark}')

    print('WAVE -> DISC SPEED (pitch of the 440 Hz sine per cycle; semitones)')
    wt = {4: [('shape 0, rate 7 (1/4)', 0.5), ('shape 1, rate 7', 0.5), ('shape 2, rate 7', 0.5), ('shape 0, FREE 1.5 Hz', 1 / 1.5)],
          5: [('bipolar +0.1', 0.5), ('unipolar +0.1', 0.5), ('bipolar -0.1', 0.5), ('rate 7 DOTTED (1/4D)', 0.75)]}
    G = {}
    for k, (s, sec) in enumerate(PLAN):
        if s not in wt:
            continue
        a = starts[k] + int(0.5 * SR)
        for tn, (what, w) in enumerate(wt[s]):
            tr = trace(mono(ch, tn, a, a + int((sec - 1.0) * SR)))
            if len(tr) < 100:
                print(f'  scene {s + 1} T{tn + 1} {what}: no tone')
                fails.append(f'WAVE scene {s + 1} T{tn + 1}: no tone')
                continue
            g = median(grid(tr))
            G[(s, tn)] = g
            p = period(g)
            vals = sorted(g)
            lo, hi, mean = vals[len(vals) // 50], vals[-len(vals) // 50], sum(g) / len(g)
            sh = shape(g, p) if p else {}
            best = max(sh, key=sh.get) if sh else None
            ok = p is not None and abs(p - w) < 0.01 * w
            print(f'  scene {s + 1} T{tn + 1} {what:22}: period {p and round(p, 4)} s, expected {w:.4f} {check(ok, f"WAVE scene {s + 1} T{tn + 1} period {p}")}; '
                  f'pitch {lo:+.2f} .. {hi:+.2f} st (mean {mean:+.2f}); shape {best} ' + ' '.join(f'{k2} {v:.3f}' for k2, v in sh.items()))
    if (5, 0) in G and (5, 2) in G:
        a, b = G[(5, 0)], G[(5, 2)]
        L = min(len(a), len(b))
        ma, mb = sum(a[:L]) / L, sum(b[:L]) / L
        r = sum((a[i] - ma) * (b[i] - mb) for i in range(L)) / math.sqrt(sum((a[i] - ma) ** 2 for i in range(L)) * sum((b[i] - mb) ** 2 for i in range(L)))
        print(f'  scene 6: correlation of T1 (+0.1) and T3 (-0.1) traces: {r:+.3f} (-1 = mirror images)')

    print('SCENE 7: DISC LOOP and FREEZE')
    k = 8
    a = starts[k] - int(0.2 * SR)
    for tn, what in enumerate(('click, LOOP off', 'click, LOOP on')):
        x = mono(ch, tn, a, a + int(9.8 * SR))
        B = SR // 1000
        env = [max(abs(v) for v in x[i:i + B]) for i in range(0, len(x) - B, B)]
        top = max(env)
        hits, last = [], -1000
        for i, v in enumerate(env):
            if v > top * 0.1 and i - last > 200:
                hits.append(i)
                last = i
        clicks = [round((h - hits[0]) / 1000, 3) for h in hits]
        want = [0.0] if tn == 0 else [0.0, 8.0]
        ok = len(clicks) == len(want) and all(abs(c - w) < 0.01 for c, w in zip(clicks, want))
        print(f'  T{tn + 1} {what}: clicks at {clicks} s, expected {want} {check(ok, f"LOOP T{tn + 1}: {clicks}")}')
    # sig120: beat k's tone is 400 + 100 k Hz from k * 0.5 + 0.02 s for 0.2 s. A frozen DISC loops grains (the
    # STRETCH engine, lines 83.6 Hz apart); their comb centre is the tone under the frozen position.
    for tn, pos in ((2, 1152), (3, 105600)):
        x = mono(ch, tn, starts[k] + int(1.0 * SR), starts[k] + int(9.0 * SR))
        f = pitch(x, granular=True)
        sec = pos / SR
        beat = int(sec / 0.5)
        f0 = 400 + 100 * beat if 0.02 <= sec - beat * 0.5 <= 0.22 else None
        ok = f0 is not None and f is not None and abs(cents(f, f0)) < 10
        print(f'  T{tn + 1} FREEZE at freeze_position {pos}: comb centre {f and round(f, 2)} Hz; as samples that is {sec:.3f} s, '
              f'the tone of beat {beat}: {f0} Hz {check(ok, f"FREEZE {pos}: {f}")}')
    print('RESULT:', 'all checks passed' if not fails else f'{len(fails)} failed: ' + '; '.join(fails))


if __name__ == '__main__':
    main(sys.argv[1])
