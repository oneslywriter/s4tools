"""What S4T VERIFY's project.json says per test track (device, the values under test, effect slots, sends).
usage: verify_dump.py project.json"""
import json, sys

d = json.load(open(sys.argv[1], encoding='utf-8'))['data']
v = lambda b, k: (b[k]['value'], b[k].get('mode', '')) if b and k in b else None
KEYS = {'disc': ['speed', 'tempo', 'start', 'length', 'offset', 'level', 'reverse'], 'tape': ['speed', 'length', 'level'], 'poly': ['pitch', 'level']}
for s in sorted(d['scenes'], key=int):
    for t, tr in enumerate(d['scenes'][s]['tracks']):
        m = tr['material']
        dev = {0: 'disc', 1: 'tape', 2: 'poly', 4: 'BYPASS'}.get(m.get('selected', 0), '?')
        b = m.get(dev)
        info = {k: v(b, k) for k in KEYS.get(dev, [])} if b and 'sample_title' in b else 'no sample' if dev != 'BYPASS' else ''
        fx = ''.join(str((tr.get(sl) or {}).get('selected', '-')) for sl in ('granular', 'filter', 'color', 'space'))
        sends = tr.get('track_output', {}).get('track_output')
        extra = ' sends ' + str({k: x['value'] for k, x in sends.items()}) if sends else ''
        mods = [((tr.get(f'modulator{n}') or {}).get('follow') or {}).get('input_level', {}).get('mode') for n in range(1, 5)]
        extra += f' follow inputs {mods}' if any(mods) else ''
        print(f'S{int(s) + 1} T{t + 1} {dev:6} fx[{fx}] {info}{extra}')
print('audio', d['settings']['audio_settings'])
print('meter', d['settings']['meter_settings'])
print('mixer T4', {k: d['global_slots']['mixer']['mix']['mix'][k] for k in ('level4', 'pan4')})
