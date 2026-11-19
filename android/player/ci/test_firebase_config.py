import base64
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import firebase_config as check


APP_ID = '1:123456789:android:abcdef0123'
KEY = 'public-sdk-key-that-must-never-be-printed'


def config(package='nl.dartflow.app'):
    raw = {'project_info': {'project_id': 'dartflow', 'project_number': '123456789'}, 'client': [{'client_info': {'mobilesdk_app_id': APP_ID, 'android_client_info': {'package_name': package}}, 'api_key': [{'current_key': KEY}]}]}
    return {'configFileContents': base64.b64encode(json.dumps(raw).encode()).decode()}


class FirebaseConfigTest(unittest.TestCase):
    def fetch(self, path, token):
        self.assertEqual(token, 'temporary-token')
        if path == check.ROOT:
            return {'projectId': 'dartflow', 'projectNumber': '123456789'}
        if path.endswith('pageSize=100'):
            return {'apps': [{'name': f'projects/dartflow/androidApps/{APP_ID}', 'appId': APP_ID, 'packageName': 'nl.dartflow.app', 'state': 'ACTIVE'}]}
        if path.endswith('/config'):
            return config()
        self.fail('Unexpected route: ' + path)

    def test_inspection_validates_exact_package_and_redacts_values(self):
        result = check.inspect('temporary-token', self.fetch)
        text = json.dumps(result)
        self.assertTrue(result['productionConfigured'])
        self.assertFalse(result['deliveryTested'])
        self.assertFalse(result['fcmSendPermissionTested'])
        self.assertNotIn(KEY, text)
        self.assertNotIn(APP_ID, text)
        self.assertFalse(result['apps'][1]['registered'])

    def test_private_local_config_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            check.inspect('temporary-token', self.fetch, directory)
            output = Path(directory) / 'nl.dartflow.app.firebase-options.json'
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(output.read_text())['apiKey'], KEY)
            with self.assertRaises(FileExistsError):
                check.inspect('temporary-token', self.fetch, directory)

    def test_wrong_package_or_project_rejected(self):
        for response, package in ((config('another.package'), 'nl.dartflow.app'), (config(), 'nl.dartflow.app.staging')):
            with self.assertRaises(check.InspectionError):
                check.sdk_options(response, package, APP_ID, '123456789')
        with self.assertRaises(check.InspectionError):
            check.sdk_options(config(), 'nl.dartflow.app', APP_ID, '999')

    def test_pagination_is_bounded_and_does_not_fetch_unrelated_configs(self):
        visited = []
        def fetch(path, token):
            visited.append(path)
            if path == check.ROOT:
                return {'projectId': 'dartflow', 'projectNumber': '123456789'}
            return {'apps': [], 'nextPageToken': 'same-token'}
        with self.assertRaises(check.InspectionError):
            check.inspect('temporary-token', fetch)
        self.assertEqual(len(visited), 3)

    def test_http_transport_is_get_only_with_fixed_verified_host(self):
        calls = []
        class Response:
            status = 200
            def read(self, size):
                return b'{}'
            def getheader(self, key, default=''):
                return 'application/json; charset=utf-8'
        class Connection:
            def __init__(self, host, timeout):
                self.host = host
                self.calls = []
            def request(self, method, path, **kwargs):
                self.calls.append((method, path, kwargs))
                calls.append((method, path, kwargs))
            def getresponse(self):
                return Response()
            def close(self):
                pass
        with patch('firebase_config.http.client.HTTPSConnection', side_effect=Connection) as factory:
            self.assertEqual(check.get_json(check.ROOT, 'temporary-token'), {})
            connection = factory.call_args
            self.assertEqual(connection.args, ('firebase.googleapis.com',))
            self.assertEqual(calls[0][0:2], ('GET', check.ROOT))
            self.assertNotIn('body', calls[0][2])
        for route in ('https://attacker.invalid', '/v1beta1/projects/other', check.ROOT + ':addFirebase', check.ROOT + '/androidApps'):
            with self.assertRaises(check.InspectionError):
                check.get_json(route, 'temporary-token')


if __name__ == '__main__':
    unittest.main()
