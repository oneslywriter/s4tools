"""Zip copies of S-4 test projects (reads the backup, writes only into the test folder).
usage: mkzips.py <outdir> <name>=<srcdir>[+<extra_src>:<arcprefix>] ..."""
import os, sys, zipfile

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for spec in sys.argv[2:]:
    name, rest = spec.split('=', 1)
    parts = rest.split('+')
    target = os.path.join(out, name + '.zip')
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=1, strict_timestamps=False) as z:
        for i, p in enumerate(parts):
            if ':' in p[2:]:
                src, arcprefix = p.rsplit(':', 1)
            else:
                src, arcprefix = p, ''
            base = os.path.dirname(src.rstrip('\\/'))
            if os.path.isfile(src):
                z.write(src, arcprefix + os.path.basename(src))
                continue
            for root, dirs, files in os.walk(src):
                rel = os.path.relpath(root, base).replace('\\', '/')
                if not files and not dirs:
                    z.writestr(zipfile.ZipInfo(arcprefix + rel + '/'), b'')
                for f in files:
                    z.write(os.path.join(root, f), arcprefix + rel + '/' + f)
    print(name, round(os.path.getsize(target) / 1e6, 1), 'MB')
