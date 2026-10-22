"""After S4T VERIFY2 was played (verify2_play.js) and saved on the S-4: which scenes loaded and which mode names
the S-4 kept. A scene that loaded keeps T1's sample with its own scene_index; a name the S-4 doesn't know comes
back as '' (its default) or the scene is replaced by what the previous one had.
usage: verify2_saved.py saved_project.json exported_project.json"""
import json, sys

sv = json.load(open(sys.argv[1], encoding='utf-8'))['data']['scenes']
ex = json.load(open(sys.argv[2], encoding='utf-8'))['data']['scenes']


def t1(s, d):
    return d.get(str(s), {}).get('tracks', [{}])[0]


def mode_of(tr):
    g = (tr.get('granular') or {}).get('mosaic') or {}
    c = (tr.get('color') or {}).get('deform') or {}
    return {'mosaic.pitch': (g.get('pitch') or {}).get('mode'), 'mosaic.rand_pitch': (g.get('rand_pitch') or {}).get('mode'),
            'deform.crush': (c.get('crush') or {}).get('mode')}


for s in list(range(29, 51)) + [9, 10, 11, 19, 98, 99, 127]:
    a, b = t1(s, ex), t1(s, sv)
    da, db_ = (a.get('material') or {}).get('disc') or {}, (b.get('material') or {}).get('disc') or {}
    loaded = db_.get('scene_index') == s and db_.get('sample_title') == da.get('sample_title')
    line = f'scene {s + 1:3}: {"loaded" if loaded else "NOT loaded (scene_index %s)" % db_.get("scene_index")}'
    want = {k: v for k, v in mode_of(a).items() if v}
    if want:
        got = mode_of(b)
        line += '  ' + ', '.join(f'{k} {v!r} -> {got[k]!r}' for k, v in want.items())
    fa = [(a.get(f'modulator{n}') or {}).get('follow', {}).get('input_level', {}).get('mode') for n in range(1, 5)]
    if any(x is not None for x in fa):
        fb = [(b.get(f'modulator{n}') or {}).get('follow', {}).get('input_level', {}).get('mode') for n in range(1, 5)]
        line += f'  FOLLOW inputs {fa} -> {fb}'
    print(line)
