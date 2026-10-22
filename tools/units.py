"""Value/mode statistics for DISC and TAPE fields, plus the most common (default-looking) values."""
import json, os, sys, wave
from collections import Counter, defaultdict

jdir, broot = sys.argv[1], sys.argv[2]
pairs = defaultdict(Counter)
rows = []
for f in sorted(os.listdir(jdir)):
    d = json.load(open(os.path.join(jdir, f), encoding='utf-8'))['data']
    for sk, sc in d['scenes'].items():
        for ti, tr in enumerate(sc['tracks']):
            m = tr.get('material', {})
            for dev in ('disc', 'tape'):
                o = m.get(dev)
                if not o:
                    continue
                for k, v in o.items():
                    if isinstance(v, dict) and 'value' in v:
                        pairs[f'{dev}.{k}'][(v.get('mode'), round(v['value'], 4))] += 1
                    elif not isinstance(v, (list, dict)) and k not in ('library_sample_path', 'sample_title', 'sample_path'):
                        pairs[f'{dev}.{k}'][('', v)] += 1
            o = m.get('disc')
            if m.get('selected') == 0 and o and 'sample_title' in o:
                rows.append((f[:-5], int(sk), ti, o))

for k in sorted(pairs):
    c = pairs[k]
    print(f'{k}: ' + ', '.join(f'{mode or "-"}:{val} x{n}' for (mode, val), n in c.most_common(10)))

# relate start/length/tempo to the actual wav length for project-local discs
print('\nproject-local discs: title | tempo(mode) default_tempo | start/length(mode) | wav secs -> beats@tempo')
for name, s, t, o in rows:
    if 'library_sample_path' in o:
        continue
    proj = name.replace('10-12_', '')
    base = os.path.join(broot, '10-12', 'PROJECTS') if name.startswith('10-12_') else os.path.join(broot, 'PROJECTS')
    w = os.path.join(base, proj + '.s4project', 'discs', f'scene{s + 1}_track{t + 1}.wav')
    try:
        with wave.open(w) as x:
            secs = x.getnframes() / x.getframerate()
    except Exception as e:
        secs = None
    tempo = o['tempo']['value']
    beats = secs * tempo / 60 if secs else None
    print(f"{name} s{s} T{t + 1}: {o['sample_title']} | {tempo}({o['tempo']['mode']}) def={o.get('default_sample_tempo')} | "
          f"{o['start']['value']}/{o['length']['value']} ({o['length']['mode']}) | {secs and round(secs, 3)}s -> {beats and round(beats, 2)} beats")
