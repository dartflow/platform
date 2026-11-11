"""Offline redirect-contract tests. No requests, email, credentials or sessions."""
from contextlib import redirect_stdout, redirect_stderr
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse

spec = importlib.util.spec_from_file_location('auth_redirect_probe', Path(__file__).with_name('auth-redirect-live.py'))
redirects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(redirects)


def failed_token_location(target):
    return target + '#error=access_denied&error_code=otp_expired&error_description=Invalid+test+token'


class Response:
    def __init__(self, location):
        self.status = 303
        self.headers = {'Location': location}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class EffectiveRedirectContract(unittest.TestCase):
    def test_default_is_explicitly_not_run_and_accepts_no_secret_options(self):
        output = io.StringIO()
        with patch.object(redirects.urllib.request, 'build_opener') as build, redirect_stdout(output):
            self.assertEqual(redirects.main([]), 0)
        build.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['status'], 'not-run')
        error = io.StringIO()
        with redirect_stderr(error), self.assertRaises(SystemExit):
            redirects.main(['--token', 'must-never-be-echoed'])
        self.assertNotIn('must-never-be-echoed', error.getvalue())

    def test_localhost_fallback_is_diagnostic_failure_with_nonzero_exit(self):
        class Localhost:
            def open(self, request, timeout):
                return Response(failed_token_location('http://localhost:3000/'))
        output = io.StringIO()
        with patch.object(redirects.urllib.request, 'build_opener', return_value=Localhost()), redirect_stdout(output):
            self.assertEqual(redirects.main(['--run-target']), 1)
        result = json.loads(output.getvalue())
        self.assertFalse(result['configured'])
        for environment in result['results']:
            for probe in environment['probes']:
                self.assertEqual(probe['errorCode'], 'otp_expired')
                self.assertEqual(probe['effectiveTarget'], {'scheme': 'http', 'host': 'localhost:3000', 'path': '/'})
                self.assertFalse(probe['configured'])

    def test_each_https_environment_accepts_its_own_root_and_exact_callback_only(self):
        for environment, (_project, origin) in redirects.SITES.items():
            for kind, target in [('site-url', origin + '/'), ('callback', origin + '/auth/callback')]:
                with self.subTest(environment=environment, kind=kind):
                    self.assertTrue(redirects.inspect_redirect(environment, kind, 303, failed_token_location(target))['configured'])
            other = redirects.SITES['production' if environment == 'staging' else 'staging'][1]
            self.assertFalse(redirects.inspect_redirect(environment, 'callback', 303, failed_token_location(other + '/auth/callback'))['configured'])

    def test_auth_bearing_targets_are_rejected_without_leaking_target_or_value(self):
        secret = 'sensitive-value-that-must-never-appear'
        for location in [
            f'https://staging.dartflow.nl/auth/callback?code={secret}#error_code=otp_expired',
            f'https://staging.dartflow.nl/auth/callback#error_code=otp_expired&access_token={secret}',
            f'https://staging.dartflow.nl/auth/callback?refresh_token={secret}#error_code=otp_expired',
            f'https://staging.dartflow.nl/auth/callback#error_code=otp_expired&STATE={secret}',
            f'https://{secret}@staging.dartflow.nl/auth/callback#error_code=otp_expired',
            f'https://staging.dartflow.nl/{secret}#error_code=otp_expired',
            f'https://staging.dartflow.nl/auth/callback#token={redirects.MARKER}{secret}',
        ]:
            with self.subTest(locationKind=location.split(':', 1)[0]):
                result = redirects.inspect_redirect('staging', 'callback', 303, location)
                self.assertFalse(result['configured'])
                self.assertIsNone(result['effectiveTarget'])
                self.assertNotIn(secret, json.dumps(result))

    def test_external_insecure_wrong_status_and_non_error_responses_never_pass(self):
        for status, location in [
            (303, failed_token_location('https://external.example/auth/callback')),
            (303, failed_token_location('http://staging.dartflow.nl/auth/callback')),
            (302, failed_token_location('https://staging.dartflow.nl/auth/callback')),
            (200, failed_token_location('https://staging.dartflow.nl/auth/callback')),
            (303, 'https://staging.dartflow.nl/auth/callback#error_code=unexpected'),
            (303, 'https://staging.dartflow.nl/auth/callback'),
            (303, 'javascript:alert(1)'),
        ]:
            with self.subTest(status=status):
                self.assertFalse(redirects.inspect_redirect('staging', 'callback', status, location)['configured'])

    def test_requests_are_fixed_gets_with_fresh_impossible_tokens_and_no_credentials(self):
        requests = []
        class FixedTarget:
            def open(self, request, timeout):
                requests.append(request)
                assert timeout == 10
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
                return Response(failed_token_location(query.get('redirect_to', ['https://staging.dartflow.nl/'])[0]))
        opener = FixedTarget()
        for kind in ('site-url', 'callback'):
            self.assertTrue(redirects.probe('staging', kind, opener)['configured'])
        tokens = []
        for index, request in enumerate(requests):
            parsed = urllib.parse.urlsplit(request.full_url)
            query = urllib.parse.parse_qs(parsed.query)
            self.assertEqual((parsed.scheme, parsed.netloc, parsed.path), ('https', 'dsnqnvbckkqpzadblshu.supabase.co', '/auth/v1/verify'))
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.data)
            self.assertEqual(query['type'], ['magiclink'])
            self.assertEqual(set(query), {'type', 'token'} if index == 0 else {'type', 'token', 'redirect_to'})
            self.assertTrue(query['token'][0].startswith(redirects.MARKER))
            tokens.append(query['token'][0])
            self.assertEqual(dict(request.header_items()), {'Accept': 'application/json'})
        self.assertNotEqual(tokens[0], tokens[1])
        with self.assertRaises(ValueError):
            redirects.probe('external', 'callback', opener)

    def test_redirect_handlers_never_follow_and_opt_in_constructs_both_guards(self):
        self.assertIsNone(redirects.NoRedirect().redirect_request(None, None, 303, None, {}, 'https://external.example/'))
        response = Response('https://external.example/')
        self.assertIs(redirects.InspectStatus().https_response(None, response), response)
        with patch.object(redirects.urllib.request, 'build_opener') as build, patch.object(redirects, 'probe', return_value={'configured': True}):
            self.assertTrue(redirects.run_checks()['configured'])
        arguments = build.call_args.args
        self.assertTrue(any(isinstance(value, redirects.NoRedirect) for value in arguments))
        self.assertTrue(any(isinstance(value, redirects.InspectStatus) for value in arguments))

    def test_transport_failure_never_echoes_exception_request_or_synthetic_token(self):
        class Failure:
            def open(self, request, timeout):
                raise urllib.error.URLError('private-detail:' + request.full_url)
        result = redirects.probe('staging', 'callback', Failure())
        self.assertEqual(result['status'], 'request-failed')
        self.assertFalse(result['configured'])
        encoded = json.dumps(result)
        self.assertNotIn('private-detail', encoded)
        self.assertNotIn(redirects.MARKER, encoded)
        self.assertNotIn('http', encoded.replace('httpStatus', ''))


if __name__ == '__main__':
    unittest.main()
