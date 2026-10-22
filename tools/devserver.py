"""Static server for the app (localhost only) that also accepts PUT /upload/<name> for test exports.
usage: devserver.py <port> <webroot> [extdir ...]   (uploads go to ./uploads next to this script;
GET /ext/<n>/<file> reads the n-th extdir (from 0), read-only, for test material that stays where it is;
GET /ext/index.json lists the WAVs of all of them as "<n>/<file>")"""
import functools, os, re, sys, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

EXTS = sys.argv[3:]

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(OUT, exist_ok=True)


class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if EXTS and self.path.startswith('/ext/'):
            rel = urllib.parse.unquote(self.path[5:].split('?')[0])
            if rel == 'index.json':
                body = __import__('json').dumps([f'{n}/{f}' for n, d in enumerate(EXTS) if os.path.isdir(d)
                                                 for f in sorted(os.listdir(d)) if f.lower().endswith('.wav')]).encode()
                ctype = 'application/json'
            else:
                n, _, name = rel.partition('/')
                p = os.path.join(EXTS[int(n)], os.path.basename(name)) if n.isdigit() and int(n) < len(EXTS) else ''
                if not os.path.isfile(p):
                    self.send_error(404)
                    return
                with open(p, 'rb') as f:
                    body = f.read()
                ctype = 'audio/wav'
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_PUT(self):
        if not self.path.startswith('/upload/'):
            self.send_error(404)
            return
        name = re.sub(r'[^A-Za-z0-9 ._-]', '_', os.path.basename(self.path))
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n)
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(data)
        body = f'saved {name} {len(data)}'.encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


port, root = int(sys.argv[1]), sys.argv[2]
ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=root)).serve_forever()
