"""Raw mixer block example; TAPE length vs tape wav duration; scene count stats."""
import json, os, sys, wave

jdir, broot = sys.argv[1], sys.argv[2]
shown = False
for f in sorted(os.listdir(jdir)):
    d = json.load(open(os.path.join(jdir, f), encoding='utf-8'))['data']
    mix = d['global_slots']['mixer']['mix']
    if mix and not shown:
        print('MIXER', f, json.dumps(mix)[:900])
        print('SCENE', json.dumps(d['global_slots'].get('scene'))[:300])
        shown = True
    proj = f[:-5].replace('10-12_', '')
    base = os.path.join(broot, '10-12', 'PROJECTS') if f.startswith('10-12_') else os.path.join(broot, 'PROJECTS')
    for sk, sc in d['scenes'].items():
        for ti, tr in enumerate(sc['tracks']):
            m = tr.get('material', {})
            if m.get('selected') == 1 and m.get('tape'):
                t = m['tape']
                w = os.path.join(base, proj + '.s4project', 'tapes', f'scene{int(sk) + 1}_track{ti + 1}_tape.wav')
                secs = None
                if os.path.exists(w):
                    with wave.open(w) as x:
                        secs = x.getnframes() / x.getframerate()
                print(f'TAPE {f[:-5]} s{sk} T{ti + 1}: length={t["length"]} speed={t["speed"]} tempo={d["tempo"]} wav={secs and round(secs, 3)}s')
