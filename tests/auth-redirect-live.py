#!/usr/bin/python3 -I
"""Optional, bounded effective-redirect check for the two owned Supabase projects.

No real token, email, phone, cookie, OAuth state or credential is accepted.
GET /verify with a fresh impossible nonhex token fails before user/session
changes, then redirects through the same GetReferrer used by Google OAuth.
Source basis (reviewed upstream; not a claim of the deployed server version):
https://github.com/supabase/auth/blob/1357a5b90faa0e575e25030dc690bb228fdce721/internal/api/verify.go
https://github.com/supabase/auth/blob/1357a5b90faa0e575e25030dc690bb228fdce721/internal/utilities/request.go
Network work requires --run-target. Never follow or print the resulting URL.
"""
import argparse
import json
import secrets
import urllib.parse
import urllib.request

SITES = {
    'staging': ('dsnqnvbckkqpzadblshu', 'https://staging.dartflow.nl'),
    'production': ('wlrnowuownakqqgjxnbb', 'https://dartflow.nl'),
}
MARKER = 'dartflow-redirect-probe-invalid-'
AUTH_FIELDS = {'code', 'access_token', 'refresh_token', 'id_token', 'provider_token',
               'provider_refresh_token', 'state', 'token', 'token_hash', 'code_verifier', 'code_challenge'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class InspectStatus(urllib.request.HTTPErrorProcessor):
    def http_response(self, request, response):
        return response

    https_response = http_response


class SafeArguments(argparse.ArgumentParser):
    def error(self, message):
        # Do not echo caller-supplied credentials disguised as unknown options.
        self.exit(2, 'Only --run-target or --help is supported. No token input is accepted.\n')


def inspect_redirect(environment, probe, status, location):
    if environment not in SITES or probe not in ('site-url', 'callback'):
        raise ValueError('Unknown fixed redirect probe')
    result = {'probe': probe, 'status': 'rejected', 'httpStatus': status,
              'configured': False, 'effectiveTarget': None, 'errorCode': None}
    if not isinstance(location, str) or not location or len(location) > 8192 or any(ord(c) < 32 or ord(c) == 127 for c in location) or MARKER in location:
        return result
    try:
        target = urllib.parse.urlsplit(location)
        query = urllib.parse.parse_qsl(target.query, keep_blank_values=True, max_num_fields=32)
        fragment = urllib.parse.parse_qsl(target.fragment, keep_blank_values=True, max_num_fields=32)
        fields = [(key.lower(), value) for key, value in query + fragment]
        # An auth-bearing result is never reported, even as a diagnostic target.
        if any(key in AUTH_FIELDS for key, _value in fields) or target.username is not None or target.password is not None:
            return result
        if target.scheme not in ('http', 'https') or not target.hostname:
            return result
        target.port  # Reject malformed ports without echoing the URL.
        # Only expected public paths are useful metadata; arbitrary paths may
        # themselves contain sensitive data and are deliberately omitted.
        if target.path not in ('', '/', '/auth/callback'):
            return result
        result['effectiveTarget'] = {'scheme': target.scheme, 'host': target.netloc, 'path': target.path}
        errors = [value for key, value in fields if key == 'error_code']
        if not errors or any(value != 'otp_expired' for value in errors):
            return result
        result['errorCode'] = 'otp_expired'
        expected = urllib.parse.urlsplit(SITES[environment][1])
        path_ok = target.path in ('', '/') if probe == 'site-url' else target.path == '/auth/callback'
        configured = status == 303 and target.scheme == 'https' and target.netloc == expected.netloc and path_ok
        result.update({'configured': configured, 'status': 'accepted' if configured else 'not-configured'})
    except (ValueError, TypeError):
        return result
    return result


def probe(environment, kind, opener):
    if environment not in SITES or kind not in ('site-url', 'callback'):
        raise ValueError('Unknown fixed redirect probe')
    project, origin = SITES[environment]
    # Generated email token hashes are hex (optionally pkce_-prefixed); this
    # deliberately different marker cannot be a generated verification token.
    parameters = {'type': 'magiclink', 'token': MARKER + secrets.token_hex(32)}
    if kind == 'callback':
        parameters['redirect_to'] = origin + '/auth/callback'
    request = urllib.request.Request('https://' + project + '.supabase.co/auth/v1/verify?' + urllib.parse.urlencode(parameters),
                                     headers={'Accept': 'application/json'}, method='GET')
    try:
        with opener.open(request, timeout=10) as response:
            return inspect_redirect(environment, kind, response.status, response.headers.get('Location', ''))
    except Exception:
        # urllib exceptions may include the complete request URL: never echo it.
        return {'probe': kind, 'status': 'request-failed', 'httpStatus': None,
                'configured': False, 'effectiveTarget': None, 'errorCode': None}


def run_checks():
    opener = urllib.request.build_opener(NoRedirect(), InspectStatus())
    results = []
    for environment, (project, _origin) in SITES.items():
        checks = [probe(environment, kind, opener) for kind in ('site-url', 'callback')]
        results.append({'environment': environment, 'projectRef': project,
                        'configured': all(check['configured'] for check in checks), 'probes': checks})
    configured = all(result['configured'] for result in results)
    return {'status': 'configured' if configured else 'not-configured', 'configured': configured, 'results': results}


def main(argv=None):
    parser = SafeArguments(description='Opt-in effective redirect checks for the two fixed DartFlow Supabase projects.')
    parser.add_argument('--run-target', action='store_true')
    args = parser.parse_args(argv)
    if not args.run_target:
        print(json.dumps({'status': 'not-run', 'configured': False, 'results': []}))
        return 0
    result = run_checks()
    print(json.dumps(result, indent=2))
    return 0 if result['configured'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
