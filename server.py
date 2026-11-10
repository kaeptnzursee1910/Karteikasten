#!/usr/bin/env python3
"""Startet den Karteikasten im Heimnetz und leitet KI-Anfragen an den lokalen Modellserver weiter.

    python3 server.py                       # Ollama auf diesem Rechner
    python3 server.py --ziel http://127.0.0.1:1234   # z. B. LM Studio
    python3 server.py --port 9000

Danach auf dem iPad die angezeigte Adresse (http://<IP>:8080) öffnen.
Anfragen an /ki/... gehen an den Modellserver; so sind keine CORS-Einstellungen nötig.
Nur Python-Standardbibliothek, keine Installation nötig.
"""
import argparse
import http.server
import os
import socket
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PREFIX = "/ki/"


def lan_addresses():
    addrs = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # es wird nichts gesendet
            addrs.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.add(info[4][0])
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith("127."))


class Handler(http.server.SimpleHTTPRequestHandler):
    target = "http://127.0.0.1:11434"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # App-Dateien nicht hart cachen, damit Updates sofort ankommen
        if not self.path.startswith(PREFIX):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.rstrip("/") + "/" == PREFIX:
            self.send_response(200)
            self.send_header("X-Karteikasten-Proxy", "1")
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"Proxy zu {self.target}".encode())
            return
        if self.path.startswith(PREFIX):
            return self.proxy()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith(PREFIX):
            return self.proxy()
        self.send_error(405)

    def proxy(self):
        url = self.target.rstrip("/") + "/" + self.path[len(PREFIX):]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth
        req = urllib.request.Request(url, data=body, headers=headers, method=self.command)
        try:
            resp = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as e:
            resp = e
        except (urllib.error.URLError, OSError) as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            msg = f"Modellserver unter {self.target} nicht erreichbar: {getattr(e, 'reason', e)}"
            self.wfile.write(('{"error": "%s"}' % msg.replace('"', "'")).encode())
            return
        self.send_response(resp.status if hasattr(resp, "status") else resp.code)
        self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        # Antwort stückweise weitergeben, damit Streaming funktioniert
        try:
            while True:
                chunk = resp.read1(8192) if hasattr(resp, "read1") else resp.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            resp.close()

    def log_message(self, fmt, *args):
        if self.path.startswith(PREFIX) and ("/api/chat" in self.path or "/chat/" in self.path):
            sys.stderr.write("KI-Anfrage: %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description="Karteikasten im Heimnetz bereitstellen")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--ziel", default=os.environ.get("KI_SERVER", "http://127.0.0.1:11434"),
                    help="Adresse des Modellservers (Standard: Ollama auf diesem Rechner)")
    ap.add_argument("--nur-lokal", action="store_true", help="nur auf diesem Rechner erreichbar")
    args = ap.parse_args()

    Handler.target = args.ziel
    host = "127.0.0.1" if args.nur_lokal else "0.0.0.0"
    httpd = http.server.ThreadingHTTPServer((host, args.port), Handler)
    print("Karteikasten läuft.")
    print(f"  Auf diesem Rechner: http://localhost:{args.port}")
    if not args.nur_lokal:
        for a in lan_addresses():
            print(f"  Im Heimnetz (z. B. iPad): http://{a}:{args.port}")
    print(f"  KI-Anfragen gehen an: {args.ziel}")
    print("Beenden mit Strg+C.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")


if __name__ == "__main__":
    main()
