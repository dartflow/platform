#!/usr/bin/env python3
"""Public, read-only release checks for the native DartFlow player package."""
import argparse
import html
import http.client
import json
import re

PACKAGE = 'nl.dartflow.app'
PLAY_FINGERPRINT = 'DE:54:EB:62:ED:D3:10:AA:F9:39:0F:47:6D:AF:73:E2:94:13:75:CE:EE:BE:DC:0B:89:D8:8D:E2:D4:EC:3E:F1'
ENVIRONMENTS = {
    'production': ('dartflow.nl', 'wlrnowuownakqqgjxnbb', PACKAGE),
    'staging': ('staging.dartflow.nl', 'dsnqnvbckkqpzadblshu', PACKAGE + '.staging'),
}
LEGAL_PATHS = ('/privacy', '/account-verwijderen', '/communityregels', '/voorwaarden')
REQUIRED_FEATURES = {'resumable-guest-play', 'versioned-play-modes', 'private-guest-results', 'manual', 'offline-score-conflicts'}
JSON_PATHS = ('/api/health', '/api/ready', '/api/player/v1/capabilities', '/.well-known/assetlinks.json')


def get_public(host, path, *, html_document=False):
    """Fixed HTTPS hosts, GET only, certificate verification, no redirects, bounded body."""
    if host not in {value[0] for value in ENVIRONMENTS.values()} or path not in JSON_PATHS + LEGAL_PATHS:
        raise ValueError('Alleen vaste openbare DartFlow-releasechecks zijn toegestaan.')
    expected = 'text/html' if html_document else 'application/json'
    limit = 524288 if html_document else 131072
    connection = http.client.HTTPSConnection(host, timeout=20)
    try:
        connection.request('GET', path, headers={'Accept': expected, 'Cache-Control': 'no-cache', 'User-Agent': 'DartFlow-Player-Release-Check/1'})
        response = connection.getresponse()
        body = response.read(limit + 1)
        if response.status != 200 or len(body) > limit or response.getheader('Content-Type', '').split(';')[0].strip().lower() != expected:
            raise ValueError(f'{host}{path} moet zonder redirect HTTP 200 met begrensde {expected} geven.')
        text = body.decode('utf-8')
        return text if html_document else json.loads(text)
    finally:
        connection.close()


def validate_arguments(sha, fingerprint):
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('Een volledige lowercase release-SHA van 40 hextekens is vereist.')
    if fingerprint.upper() != PLAY_FINGERPRINT:
        raise ValueError('Gebruik het vastgelegde Play App Signing-certificaat voor nl.dartflow.app, niet het uploadcertificaat.')


def validate_capabilities(data, environment):
    host, reference, package = ENVIRONMENTS[environment]
    origin = f'https://{host}'
    if not isinstance(data, dict) or type(data.get('apiVersion')) is not int or data.get('apiVersion') != 1 or data.get('origin') != origin or data.get('environment') != environment or data.get('local') is not False or data.get('localUsers') != []:
        raise ValueError(f'{environment}: het productiegeschikte native spelerscontract is niet bevestigd.')
    auth = data.get('auth')
    if not isinstance(auth, dict) or auth.get('url') != f'https://{reference}.supabase.co' or auth.get('redirectScheme') != package or auth.get('callbackUrl') != f'{origin}/auth/callback?native_client={package}':
        raise ValueError(f'{environment}: Auth-project of native terugkeerroute wijkt af.')
    if data.get('authentication') != 'Bearer' or data.get('permissions') != 'existing-player-domain-rights':
        raise ValueError(f'{environment}: bestaande spelersrechten en bearer-auth zijn niet bevestigd.')
    features = data.get('features')
    if not isinstance(features, list) or not REQUIRED_FEATURES.issubset(set(value for value in features if isinstance(value, str))):
        raise ValueError(f'{environment}: hervatbaar gastspel, spelvormen, privéresultaten, handleiding of offline-conflictbediening ontbreken.')


def validate_health(health, ready, sha, environment):
    if not isinstance(health, dict) or health.get('status') != 'ok' or health.get('mode') != 'supabase' or health.get('sha') != sha:
        raise ValueError(f'{environment}: gezonde Supabase-build met de exacte release-SHA ontbreekt.')
    if not isinstance(ready, dict) or ready.get('status') != 'ready' or ready.get('database') != 'ok' or ready.get('auth') != 'reachable' or ready.get('sha') != sha:
        raise ValueError(f'{environment}: database en Auth zijn niet gereed op dezelfde release-SHA.')


def validate_associations(associations, fingerprint):
    if isinstance(associations, list):
        for entry in associations:
            if not isinstance(entry, dict):
                continue
            target = entry.get('target')
            if isinstance(target, dict) and isinstance(entry.get('relation'), list) and 'delegate_permission/common.handle_all_urls' in entry['relation'] and target.get('namespace') == 'android_app' and target.get('package_name') == PACKAGE and isinstance(target.get('sha256_cert_fingerprints'), list) and fingerprint.upper() in target['sha256_cert_fingerprints']:
                return
    raise ValueError('Productie App Links bevestigen nl.dartflow.app met het echte Play App Signing-certificaat niet.')


def validate_legal(document, path):
    if not isinstance(document, str):
        raise ValueError(f'{path}: een openbaar HTML-document is vereist.')
    text = html.unescape(document).lower()
    if '<html' not in text or 'dartflow' not in text or 'info@dartflow.nl' not in text or 'info@dgwebservices.nl' in text:
        raise ValueError(f'{path}: openbare DartFlow-pagina of actuele contactgegevens ontbreken.')


def check_release(sha, fingerprint, fetch=get_public):
    validate_arguments(sha, fingerprint)
    for environment, (host, _, _) in ENVIRONMENTS.items():
        validate_health(fetch(host, '/api/health'), fetch(host, '/api/ready'), sha, environment)
        validate_capabilities(fetch(host, '/api/player/v1/capabilities'), environment)
    validate_associations(fetch('dartflow.nl', '/.well-known/assetlinks.json'), fingerprint)
    for path in LEGAL_PATHS:
        validate_legal(fetch('dartflow.nl', path, html_document=True), path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--fingerprint', required=True)
    args = parser.parse_args()
    try:
        check_release(args.sha, args.fingerprint)
    except (ValueError, OSError, http.client.HTTPException) as error:
        parser.exit(1, f'Spelersapp Play-preflight gestopt: {error}\n')
    print(json.dumps({'package': PACKAGE, 'sha': args.sha, 'productionAndStagingReady': True, 'appLinks': True, 'legalPages': True, 'readOnly': True}))


if __name__ == '__main__':
    main()
