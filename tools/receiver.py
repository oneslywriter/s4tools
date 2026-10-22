"""Localhost-only receiver for test exports: PUT /upload/<name> saves the body into ./uploads/<name>."""
import os, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(OUT, exist_ok=True)


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', 'http://localhost:8765')
        self.send_header('Access-Control-Allow-Methods', 'PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_PUT(self):
        name = re.sub(r'[^A-Za-z0-9 ._-]', '_', os.path.basename(self.path))
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n)
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(data)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(f'saved {name} {len(data)}'.encode())


HTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8766), H).serve_forever()
