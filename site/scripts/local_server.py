#!/usr/bin/env python3
"""Start or reuse ExcelBomb on loopback; never contact an external service."""
import argparse
import functools
import http.server
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:8769/'

class LocalHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

def probe():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(URL + 'index.html', timeout=1) as response:
            html = response.read(20000).decode('utf-8', errors='replace')
            return 'ExcelBomb' in html and 'id="tool-tabs"' in html
    except (OSError, urllib.error.URLError):
        return False

def serve():
    handler = functools.partial(LocalHandler, directory=str(ROOT / 'dist'))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 8769), handler)
    print('ExcelBomb:', URL, flush=True)
    server.serve_forever()

def launch():
    if not probe():
        logs = Path.home() / 'Library' / 'Logs' / 'ExcelBomb'
        logs.mkdir(parents=True, exist_ok=True)
        with (logs / 'server.log').open('ab') as log:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--serve'], cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        for _ in range(40):
            if probe():
                break
            if process.poll() is not None:
                raise RuntimeError('本地端口 8769 已被其他程序使用，或服务启动失败。请查看 ~/Library/Logs/ExcelBomb/server.log。')
            time.sleep(.1)
        else:
            raise RuntimeError('本地服务启动超时，请稍后重新双击启动。')
    print('ExcelBomb 已就绪：' + URL)
    if os.environ.get('EXCELBOMB_NO_BROWSER') != '1':
        webbrowser.open(URL)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()
    try:
        serve() if args.serve else launch()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
