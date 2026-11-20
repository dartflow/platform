"""Offline tests; no Google credentials or live application data are used."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('player_ready', Path(__file__).with_name('check_release_readiness.py'))
ready = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ready)
SHA = 'a' * 40


def fixture():
    data = {}
    for environment, (host, reference, package) in ready.ENVIRONMENTS.items():
        origin = f'https://{host}'
        data[(host, '/api/health')] = {'status': 'ok', 'mode': 'supabase', 'sha': SHA}
        data[(host, '/api/ready')] = {'status': 'ready', 'database': 'ok', 'auth': 'reachable', 'sha': SHA}
        data[(host, '/api/player/v1/capabilities')] = {'apiVersion': 1, 'origin': origin, 'environment': environment, 'local': False, 'localUsers': [], 'features': sorted(ready.REQUIRED_FEATURES), 'authentication': 'Bearer', 'permissions': 'existing-player-domain-rights', 'auth': {'url': f'https://{reference}.supabase.co', 'redirectScheme': package, 'callbackUrl': f'{origin}/auth/callback?native_client={package}'}}
    data[('dartflow.nl', '/.well-known/assetlinks.json')] = [{'relation': ['delegate_permission/common.handle_all_urls'], 'target': {'namespace': 'android_app', 'package_name': ready.PACKAGE, 'sha256_cert_fingerprints': [ready.PLAY_FINGERPRINT]}}]
    for path in ready.LEGAL_PATHS:
        data[('dartflow.nl', path)] = '<html><body>DartFlow info@dartflow.nl</body></html>'
    return data


class Readiness(unittest.TestCase):
    def run_fixture(self, data):
        calls = []
        def fetch(host, path, **kwargs):
            calls.append((host, path, kwargs))
            return data[(host, path)]
        ready.check_release(SHA, ready.PLAY_FINGERPRINT, fetch)
        return calls

    def test_full_player_contract_and_both_exact_release_identities(self):
        calls = self.run_fixture(fixture())
        self.assertEqual(len(calls), 11)
        self.assertEqual(sum(bool(options.get('html_document')) for _, _, options in calls), 4)
        self.assertFalse(any('/oche/' in path for _, path, _ in calls))

    def test_rejects_different_sha_or_unhealthy_database_auth_and_local_build(self):
        for host, path, field, value in [('dartflow.nl', '/api/health', 'sha', 'b'*40), ('staging.dartflow.nl', '/api/ready', 'sha', 'b'*40), ('dartflow.nl', '/api/ready', 'auth', 'unavailable'), ('staging.dartflow.nl', '/api/ready', 'database', 'schema_mismatch'), ('dartflow.nl', '/api/health', 'mode', 'local')]:
            data = fixture();data[(host, path)][field] = value
            with self.subTest(host=host, field=field), self.assertRaises(ValueError):self.run_fixture(data)

    def test_rejects_wrong_package_origin_auth_reference_or_local_capabilities(self):
        for field, value in [('origin', 'https://staging.dartflow.nl'), ('local', True), ('localUsers', [{}]), ('environment', 'staging'), ('authentication', 'Cookie'), ('apiVersion', 2)]:
            data = fixture();data[('dartflow.nl', '/api/player/v1/capabilities')][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):self.run_fixture(data)
        for field, value in [('url', 'https://dsnqnvbckkqpzadblshu.supabase.co'), ('redirectScheme', 'nl.dartflow.ochelive'), ('callbackUrl', 'https://example.invalid/callback')]:
            data = fixture();data[('dartflow.nl', '/api/player/v1/capabilities')]['auth'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):self.run_fixture(data)

    def test_rejects_backend_without_each_new_native_feature(self):
        for feature in ready.REQUIRED_FEATURES:
            data=fixture();data[('dartflow.nl','/api/player/v1/capabilities')]['features'].remove(feature)
            with self.subTest(feature=feature),self.assertRaises(ValueError):self.run_fixture(data)

    def test_rejects_missing_or_upload_only_association_and_wrong_cli_identity(self):
        for associations in [[], {}, [{'target': {'package_name': 'nl.dartflow.ochelive'}}]]:
            with self.assertRaises(ValueError):ready.validate_associations(associations, ready.PLAY_FINGERPRINT)
        with self.assertRaises(ValueError):ready.validate_arguments(SHA, ':'.join(['97']*32))
        with self.assertRaises(ValueError):ready.validate_arguments('local-unreleased', ready.PLAY_FINGERPRINT)

    def test_rejects_wrong_legal_contact_non_html_or_missing_page(self):
        for text in ['<html>DartFlow info@dgwebservices.nl</html>', 'DartFlow info@dartflow.nl', '<html>Login</html>']:
            with self.assertRaises(ValueError):ready.validate_legal(text, '/privacy')

    def test_fixed_https_get_rejects_redirect_wrong_mime_and_oversized_body(self):
        class Response:
            status = 200
            mime = 'application/json'
            body = b'{}'
            def read(self, limit):self.limit = limit;return self.body[:limit]
            def getheader(self, name, default):return self.mime
        class Connection:
            def __init__(self, *args, **kwargs):self.response = Response();self.calls=[]
            def request(self, *args, **kwargs):self.calls.append((args, kwargs))
            def getresponse(self):return self.response
            def close(self):self.closed=True
        for status, mime, body in [(302, 'application/json', b'{}'), (200, 'text/html', b'{}'), (200, 'application/json', b'x'*131073)]:
            connection=Connection();connection.response.status=status;connection.response.mime=mime;connection.response.body=body
            with patch.object(ready.http.client, 'HTTPSConnection', return_value=connection), self.assertRaises(ValueError):ready.get_public('dartflow.nl', '/api/health')
            self.assertTrue(connection.closed)
            self.assertEqual(connection.calls[0][0][0], 'GET')
        with self.assertRaises(ValueError):ready.get_public('localhost', '/api/health')
        with self.assertRaises(ValueError):ready.get_public('dartflow.nl', '/api/account/deletion')


if __name__ == '__main__':unittest.main()
