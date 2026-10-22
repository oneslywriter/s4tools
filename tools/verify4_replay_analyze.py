"""Measure a recording of verify4_replay.js: the VAST delay echo after the click, plays 1-3 scene 2, plays 4-5
scene 1, one every 7.6 s from the first sound. The first play of each scene follows other delay times (the time
glides there, shown but not checked); the repeats are checked against the note length (mode '' is DOTTED).
usage: verify4_replay_analyze.py recording.wav"""
import sys
from verify_analyze import load, SR
from verify4_analyze import DIVS, echo, vast_want

SCENE = {1: [(5, ''), (6, ''), (7, ''), (8, '')], 2: [(9, ''), (10, ''), (11, ''), (8, 'triplet')]}
PLAYS = [2, 2, 2, 1, 1]


def main(path):
    ch = load(path)
    n = len(ch[0])
    first = next(i for i in range(0, n, 48) if any(abs(c[i]) > 0.003 for c in ch))
    fails = []
    for k, scene in enumerate(PLAYS):
        a = first + int(k * 7.6 * SR) - int(0.2 * SR)
        settled = k > 0 and PLAYS[k - 1] == scene
        print(f'play {k + 1} (scene {scene}{"" if settled else ", after another scene: the time glides"})')
        for t, (step, mode) in enumerate(SCENE[scene]):
            x = [(l + r) / 2 for l, r in zip(ch[2 + 2 * t][a:a + int(3.6 * SR)], ch[3 + 2 * t][a:a + int(3.6 * SR)])]
            d, want = echo(x), vast_want(step, mode)
            ok = d is not None and abs(d - want) < max(0.004, 0.01 * want)
            if settled and not ok:
                fails.append(f'play {k + 1} T{t + 1}: {d}')
            name = DIVS[step] + ('T' if mode == 'triplet' else 'D')
            print(f'  T{t + 1} step {step:2} {mode or "(empty)":8} {name:6}: echo {d} s, expected {want:.4f} s'
                  + (f' {"ok" if ok else "!!"}' if settled else ''))
    print('RESULT:', 'all settled plays match' if not fails else f'{len(fails)} failed: ' + '; '.join(fails))


if __name__ == '__main__':
    main(sys.argv[1])
