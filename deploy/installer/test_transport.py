"""Real local HTTP transport; no public network or provisioning calls."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from gamma_installer import Failure, Host, probe_preview


class TransportTests(unittest.TestCase):
    def test_probe_does_not_follow_redirects(self):
        paths = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                paths.append(self.path)
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/unrelated-login')
                    self.end_headers()
                    return
                self.send_response(401)
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(b'{"code":"unauthorized"}')

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                origin = 'http://127.0.0.1:' + str(server.server_port)
                self.assertEqual(Host().request(origin + '/redirect')[0], 302)
                self.assertEqual(paths, ['/redirect'])
                code, headers, body = Host().request(origin + '/auth/session')
                self.assertEqual(code, 401)
                self.assertEqual(headers.get('Cache-Control'), 'no-store')
                self.assertEqual(body, b'{"code":"unauthorized"}')
            finally:
                server.shutdown()
                thread.join()


class PreviewProbeTests(unittest.TestCase):
    def test_live_probe_validates_fixture_without_disclosing_capability(self):
        body = b"<html>Known preview fixture</html>"
        requests = []

        class ProbeHost(Host):
            def uid(self, user):
                return os.getuid()

            def request(self, url, **kwargs):
                requests.append(url)
                return 200, {"Content-Type": "text/html", "Cache-Control": "no-store",
                             "Content-Security-Policy": "sandbox allow-scripts allow-forms"}, body

        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'probe.json'
            url = 'https://' + 'a' * 48 + '.preview.example.net/'
            probe = {'url': url, 'sha256': hashlib.sha256(body).hexdigest()}
            file.write_text(json.dumps(probe))
            file.chmod(0o600)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                probe_preview(ProbeHost(), {'preview_domain': 'preview.example.net'}, str(file))
            self.assertEqual(requests, [url])
            self.assertNotIn(url, output.getvalue())
            self.assertIn('verified', output.getvalue())
            for invalid in ('http://127.0.0.1/', url + '?token=secret', url.replace('example.net', 'evil.net')):
                file.write_text(json.dumps({**probe, 'url': invalid}))
                with self.assertRaises(Failure):
                    probe_preview(ProbeHost(), {'preview_domain': 'preview.example.net'}, str(file))
            self.assertEqual(requests, [url])
            file.write_text(json.dumps({**probe, 'sha256': '0' * 64}))
            with self.assertRaisesRegex(Failure, 'live Preview probe failed'):
                probe_preview(ProbeHost(), {'preview_domain': 'preview.example.net'}, str(file))
            file.chmod(0o644)
            with self.assertRaisesRegex(Failure, '0600'):
                probe_preview(ProbeHost(), {'preview_domain': 'preview.example.net'}, str(file))
