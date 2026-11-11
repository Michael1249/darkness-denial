"""Serve the built site (public/) the way GitHub Pages does, under /darkness-denial/.

Pages are served without the .html extension and folders through index.html, so links
behave exactly as on michael1249.github.io/darkness-denial. Rebuild with `npx quartz build`
and refresh; there is no hot reload.
Usage: python3 scripts/preview.py [port]
"""
import http.server
import os
import sys
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
BASE = "/darkness-denial"


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        if not path.startswith(BASE):
            return os.path.join(ROOT, "__missing__")
        rel = path[len(BASE):].lstrip("/")
        full = os.path.join(ROOT, rel)
        for candidate in (full, full + ".html", os.path.join(full, "index.html")):
            if os.path.isfile(candidate):
                return candidate
        return full

    def send_head(self):
        if urllib.parse.urlsplit(self.path).path == "/":
            self.send_response(302)
            self.send_header("Location", BASE + "/")
            self.end_headers()
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
