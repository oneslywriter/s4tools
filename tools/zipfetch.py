"""Fetch selected entries of a remote zip with HTTP range requests, without downloading the whole zip.
Groove MIDI Dataset: saves info.csv and up to N full 4/4 grooves (no fills), spread over the tempo range.
usage: zipfetch.py <url> <outdir> <capMB> <count>"""
import csv, io, os, struct, sys, urllib.request, zlib

URL, OUT, CAP, COUNT = sys.argv[1], sys.argv[2], float(sys.argv[3]) * 1e6, int(sys.argv[4])
total = 0


def get(start, end):  # inclusive byte range
    global total
    req = urllib.request.Request(URL, headers={'Range': f'bytes={start}-{end}'})
    with urllib.request.urlopen(req, timeout=180) as r:
        if r.status != 206:
            raise SystemExit(f'server ignored the range request ({r.status}), stopping')
        data = r.read()
    total += len(data)
    return data


with urllib.request.urlopen(urllib.request.Request(URL, method='HEAD'), timeout=60) as r:
    size = int(r.headers['Content-Length'])

# end of central directory (zip64 when the zip is over 4 GB)
tail = get(size - 65536, size - 1)
i = tail.rfind(b'PK\x05\x06')
n_entries, cd_size, cd_off = struct.unpack('<HII', tail[i + 10:i + 20])
if 0xFFFFFFFF in (cd_size, cd_off) or n_entries == 0xFFFF:
    j = tail.rfind(b'PK\x06\x07', 0, i)
    z64 = struct.unpack('<Q', tail[j + 8:j + 16])[0]
    z = get(z64, z64 + 55)
    assert z[:4] == b'PK\x06\x06', 'no zip64 end record'
    n_entries, cd_size, cd_off = struct.unpack('<QQQ', z[32:56])

cd = get(cd_off, cd_off + cd_size - 1)
entries, p = {}, 0
while p + 46 <= len(cd) and cd[p:p + 4] == b'PK\x01\x02':
    method = struct.unpack('<H', cd[p + 10:p + 12])[0]
    csize, usize = struct.unpack('<II', cd[p + 20:p + 28])
    nl, el, cl = struct.unpack('<HHH', cd[p + 28:p + 34])
    lho = struct.unpack('<I', cd[p + 42:p + 46])[0]
    name = cd[p + 46:p + 46 + nl].decode('utf-8', 'replace')
    extra, q = cd[p + 46 + nl:p + 46 + nl + el], 0
    while q + 4 <= len(extra):
        hid, hl = struct.unpack('<HH', extra[q:q + 4])
        if hid == 1:
            vals, k = extra[q + 4:q + 4 + hl], 0
            for field in ('usize', 'csize', 'lho'):
                if {'usize': usize, 'csize': csize, 'lho': lho}[field] == 0xFFFFFFFF:
                    v = struct.unpack('<Q', vals[k:k + 8])[0]
                    k += 8
                    usize, csize, lho = (v, csize, lho) if field == 'usize' else (usize, v, lho) if field == 'csize' else (usize, csize, v)
        q += 4 + hl
    entries[name] = (method, csize, usize, lho)
    p += 46 + nl + el + cl
print(f'{len(entries)} entries listed, {total / 1e6:.2f} MB so far')


def fetch(name):
    method, csize, usize, lho = entries[name]
    h = get(lho, lho + 29)
    nl, el = struct.unpack('<HH', h[26:30])
    start = lho + 30 + nl + el
    data = get(start, start + csize - 1)
    if method == 8:
        data = zlib.decompressobj(-15).decompress(data)
    elif method != 0:
        raise ValueError(f'compression method {method}')
    assert len(data) == usize, name
    return data


info = next(n for n in entries if n.endswith('info.csv'))
prefix = info[:-len('info.csv')]
raw = fetch(info)
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'info.csv'), 'wb') as f:
    f.write(raw)
rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8'))))
cands = [r for r in rows if r['beat_type'] == 'beat' and r['time_signature'] == '4-4' and r['audio_filename']
         and 15 <= float(r['duration']) <= 60 and prefix + r['audio_filename'] in entries]
cands.sort(key=lambda r: (int(r['bpm']), r['id']))
print(f'{len(rows)} performances, {len(cands)} full 4/4 grooves of 15-60 s with audio')
# evenly over the tempo-sorted list, skipping repeats of the same style at the same tempo
picked, seen = [], set()
for k in range(COUNT):
    for r in cands[int(k * len(cands) / COUNT):]:
        key = (r['bpm'], r['style'].split('/')[0])
        if key not in seen and r not in picked:
            seen.add(key)
            picked.append(r)
            break
saved = []
for r in picked:
    name = prefix + r['audio_filename']
    if total + entries[name][1] > CAP:
        print('cap reached, stopping')
        break
    data = fetch(name)
    out = f"gmd_{r['id'].replace('/', '-')}_{r['style'].replace('/', '-')}_{r['bpm']}bpm_{float(r['duration']):.1f}s.wav"
    with open(os.path.join(OUT, out), 'wb') as f:
        f.write(data)
    saved.append(out)
    print(f'{out}  {len(data) / 1e6:.1f} MB  (downloaded so far {total / 1e6:.1f} MB)')
print(f'saved {len(saved)} files, downloaded {total / 1e6:.1f} MB in total')
