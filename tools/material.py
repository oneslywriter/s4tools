"""Summarise material slots per scene/track, and list each project's own wav files."""
import json, os, sys
from collections import Counter

jdir, projroots = sys.argv[1], sys.argv[2:]
sel = Counter()
for f in sorted(os.listdir(jdir)):
    d = json.load(open(os.path.join(jdir, f), encoding='utf-8'))['data']
    name = f[:-5]
    lines = []
    for sk, sc in sorted(d['scenes'].items(), key=lambda x: int(x[0])):
        for ti, tr in enumerate(sc['tracks']):
            m = tr.get('material', {})
            s = m.get('selected')
            keys = [k for k in m if k != 'selected']
            sel[(s, tuple(sorted(keys)))] += 1
            dev = m.get('disc') or m.get('tape') or {}
            info = {k: dev.get(k) for k in ('sample_title', 'library_sample_path', 'sample_path') if k in dev}
            if s not in (0, None) or info:
                lines.append(f'  scene {sk} T{ti + 1}: selected={s} keys={keys} {info}')
    wavs = []
    for r in projroots:
        p = os.path.join(r, name.replace('10-12_', '') + '.s4project')
        if name.startswith('10-12_') != ('10-12' in r):
            continue
        for sub in ('discs', 'tapes', 'granular_buffers'):
            q = os.path.join(p, sub)
            if os.path.isdir(q):
                wavs += [f'{sub}/{x}' for x in sorted(os.listdir(q))]
    if lines or wavs:
        print(f'== {name}: scenes={sorted(int(k) for k in d["scenes"])} files={wavs}')
        print('\n'.join(lines[:14]))
print('\nselected/keys combos:')
for k, v in sel.most_common():
    print(' ', k, v)
