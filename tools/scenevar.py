"""Do saved S-4 projects keep different effect values per scene? For each project with 2+ scenes, count
tracks whose granular/filter/color/space block differs between scenes; also print scene_settings.
usage: scenevar.py dir"""
import glob, json, os, sys

for path in sorted(glob.glob(os.path.join(sys.argv[1], '*.json'))):
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception:
        continue
    d = d.get('data', d)
    scenes = d.get('scenes') or {}
    if len(scenes) < 2:
        continue
    diff = {}
    for slot in ('granular', 'filter', 'color', 'space'):
        n = 0
        for t in range(4):
            vals = set()
            for sc in scenes.values():
                trs = sc.get('tracks') or []
                if t < len(trs):
                    vals.add(json.dumps(trs[t].get(slot), sort_keys=True))
            if len(vals) > 1:
                n += 1
        diff[slot] = n
    ss = (d.get('settings') or {}).get('scene_settings')
    print(f"{os.path.basename(path):24} scenes {len(scenes):3d} | tracks differing between scenes: {diff} | scene_settings {json.dumps(ss)}")
