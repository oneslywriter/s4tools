"""Finds problems the S-4 leaves in its own projects. No third-party packages; reads the projects, changes nothing
unless asked.

Ghost audio: deleting a track's sample on the S-4 removes the sample's name from project.json but leaves its
audio file in the project folder. The S-4 finds a track's audio by file name (scene and track number:
discs/scene<N>_track<T>.wav, tapes/scene<N>_track<T>_tape.wav, tapes/scene<N>_track<T>_poly.wav), so the
next time the project loads, the deleted clip comes back. A file counts as a ghost when a DISC or POLY track
without a sample points at it and no track with a sample does (with KEEP SAMPLE a track can use another scene's
file). Seen on DISC (2 UH, 2026-10-25); POLY marks an empty track the same way. A TAPE is a recording and has
no sample name, so TAPEs aren't checked this way.

Unused files: audio in discs/ or tapes/ that no track in project.json points at, for information.

usage: s4doctor.py PATH [PATH ...] [--move-to DIR]
  PATH       a project (NAME.s4project) or a folder of them (the S-4's PROJECTS folder, in USB storage mode)
  --move-to  moves each ghost file into DIR/<project>/discs|tapes/ and lists it in DIR/moved.txt, so it can
             be put back. Nothing is ever deleted. Load the project on the S-4 afterwards to check."""
import json, os, shutil, sys
from datetime import datetime

FILES = {  # material block -> where its audio lives
    'disc': lambda s, t: f'discs/scene{s + 1}_track{t + 1}.wav',
    'tape': lambda s, t: f'tapes/scene{s + 1}_track{t + 1}_tape.wav',
    'poly': lambda s, t: f'tapes/scene{s + 1}_track{t + 1}_poly.wav',
}
SELECTED = {0: 'disc', 1: 'tape', 2: 'poly'}


def check(proj):
    """-> (ghosts, unused): ghosts = [(file, [where...])], unused = [file]"""
    data = json.load(open(os.path.join(proj, 'project.json'), encoding='utf-8'))['data']
    with_sample, without = {}, {}  # file -> [where]
    for key, scene in (data.get('scenes') or {}).items():
        for t, track in enumerate((scene or {}).get('tracks') or []):
            mat = (track or {}).get('material') or {}
            for kind, name in FILES.items():
                block = mat.get(kind)
                if not isinstance(block, dict):
                    continue
                if kind == 'disc' and block.get('library_sample_path'):
                    continue  # plays a sample from the S-4's library, not a project file
                s = block.get('scene_index', int(key))
                tr = block.get('track_index', t)
                if not isinstance(s, int) or not isinstance(tr, int):
                    continue
                where = f"scene {int(key) + 1} T{t + 1} ({kind.upper()}{'' if SELECTED.get(mat.get('selected')) == kind else ', not its current material'})"
                has = kind == 'tape' or block.get('sample_title') or block.get('sample_path')  # a tape has no name
                (with_sample if has else without).setdefault(name(s, tr), []).append(where)
    ghosts = [(f, w) for f, w in sorted(without.items()) if f not in with_sample and os.path.exists(os.path.join(proj, f))]
    used = set(with_sample) | set(without)
    unused = []
    for sub in ('discs', 'tapes'):
        folder = os.path.join(proj, sub)
        if os.path.isdir(folder):
            unused += [f'{sub}/{n}' for n in sorted(os.listdir(folder)) if n.lower().endswith('.wav') and f'{sub}/{n}' not in used]
    return ghosts, unused


def projects(path):
    if os.path.isfile(os.path.join(path, 'project.json')):
        return [path]
    if not os.path.isdir(path):
        sys.exit(f'not found: {path}')
    return [os.path.join(path, n) for n in sorted(os.listdir(path))
            if n.lower().endswith('.s4project') and os.path.isfile(os.path.join(path, n, 'project.json'))]


def main(args):
    move_to = None
    if '--move-to' in args:
        i = args.index('--move-to')
        if i + 1 >= len(args):
            sys.exit('--move-to needs a folder')
        move_to = args[i + 1]
        args = args[:i] + args[i + 2:]
    if not args:
        sys.exit(__doc__)
    found = moved = 0
    for path in args:
        for proj in projects(path):
            name = os.path.basename(os.path.normpath(proj))
            try:
                ghosts, unused = check(proj)
            except (OSError, ValueError, KeyError) as e:
                print(f'{name}: could not read project.json ({e})')
                continue
            if not ghosts and not unused:
                continue
            print(name)
            for f, where in ghosts:
                found += 1
                print(f'  ghost   {f}: {", ".join(where)} has no sample, but the file is still there, so the S-4 loads it again')
                if move_to:
                    src, dest = os.path.normpath(os.path.join(proj, f)), os.path.normpath(os.path.join(move_to, name, f))
                    if os.path.exists(dest):
                        print(f'          not moved: {dest} already exists')
                        continue
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    shutil.move(src, dest)
                    with open(os.path.join(move_to, 'moved.txt'), 'a', encoding='utf-8') as log:
                        log.write(f'{datetime.now():%Y-%m-%d %H:%M}  {src}  ->  {dest}\n')
                    moved += 1
                    print(f'          moved to {dest}')
            for f in unused:
                print(f'  unused  {f}: no track in project.json points at it (if a clip turns up in an empty scene, this may be why)')
    print(f'{found} ghost file{"" if found == 1 else "s"}' + (f', {moved} moved to {move_to} (listed in moved.txt)' if move_to else '' if not found else '; --move-to DIR moves them out of the project'))


if __name__ == '__main__':
    main(sys.argv[1:])
