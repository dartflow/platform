#!/usr/bin/env python3
"""Inspect existing DartFlow Firebase Android registrations using GET requests only.

The access token is accepted only through FIREBASE_ACCESS_TOKEN. No Google account,
project, IAM, API, app registration, or credential is created or changed. SDK values
are never printed. Optional local config files are private and contain public SDK
configuration, not a service-account key or a token.
"""
import argparse
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
from urllib.parse import urlencode, quote

HOST = 'firebase.googleapis.com'
PROJECT = 'dartflow'
ROOT = f'/v1beta1/projects/{PROJECT}'
PACKAGES = ('nl.dartflow.app', 'nl.dartflow.app.staging', 'nl.dartflow.app.dev')
SCOPE = 'https://www.googleapis.com/auth/firebase.readonly'


class InspectionError(ValueError):
    pass


def get_json(path, token):
    """Fixed host/project, GET only, empty body, verified TLS, no redirects."""
    if not re.fullmatch(r'/v1beta1/projects/dartflow(?:/androidApps(?:\?pageSize=100(?:&pageToken=[A-Za-z0-9%_.~+-]*)?|/[A-Za-z0-9:%_.~-]+/config))?', path):
        raise InspectionError('Alleen de vaste Firebase-project- en Android-app-leesroutes zijn toegestaan.')
    if not token or len(token) > 16384 or re.search(r'[\s\x00-\x1f\x7f]', token):
        raise InspectionError('Een geldig tijdelijk toegangstoken is vereist.')
    connection = http.client.HTTPSConnection(HOST, timeout=20)
    try:
        connection.request('GET', path, headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json', 'User-Agent': 'DartFlow-Firebase-Read-Only/1'})
        response = connection.getresponse()
        body = response.read(1048577)
        if response.status != 200:
            # Never echo Google's body; it can contain account/configuration data.
            raise InspectionError(f'Firebase GET is geweigerd (HTTP {response.status}); controleer bestaande API- en leesrechten. Er is niets gewijzigd.')
        if len(body) > 1048576 or response.getheader('Content-Type', '').split(';')[0].strip() != 'application/json':
            raise InspectionError('Firebase gaf geen begrensd JSON-antwoord.')
        result = json.loads(body)
        if not isinstance(result, dict):
            raise InspectionError('Firebase gaf geen geldig object.')
        return result
    finally:
        connection.close()


def sdk_options(response, package, app_id, project_number):
    try:
        decoded = base64.b64decode(response['configFileContents'], validate=True)
        if len(decoded) > 524288:
            raise ValueError()
        config = json.loads(decoded)
        project = config['project_info']
        if project['project_id'] != PROJECT or str(project['project_number']) != project_number:
            raise ValueError()
        clients = [client for client in config['client'] if client.get('client_info', {}).get('android_client_info', {}).get('package_name') == package]
        if len(clients) != 1 or clients[0]['client_info']['mobilesdk_app_id'] != app_id:
            raise ValueError()
        key = clients[0]['api_key'][0]['current_key']
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,200}', key):
            raise ValueError()
        return {'projectId': PROJECT, 'applicationId': app_id, 'senderId': project_number, 'apiKey': key, 'packageName': package}
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise InspectionError(f'{package}: SDK-configuratie komt niet overeen met het bestaande project en de exacte appregistratie.') from error


def inspect(token, fetch=get_json, config_dir=None):
    project = fetch(ROOT, token)
    number = str(project.get('projectNumber', ''))
    if project.get('projectId') != PROJECT or not re.fullmatch(r'[0-9]{1,30}', number):
        raise InspectionError('Het bestaande Firebase-project dartflow is niet bevestigd.')
    apps, seen = [], set()
    path = ROOT + '/androidApps?pageSize=100'
    for _ in range(20):
        page = fetch(path, token)
        if not isinstance(page.get('apps', []), list):
            raise InspectionError('Ongeldige Android-app-lijst.')
        apps.extend(page.get('apps', []))
        next_page = page.get('nextPageToken')
        if not next_page:
            break
        if not isinstance(next_page, str) or len(next_page) > 4096 or next_page in seen:
            raise InspectionError('Ongeldige of herhaalde paginering; inspectie gestopt.')
        seen.add(next_page)
        path = ROOT + '/androidApps?' + urlencode({'pageSize': 100, 'pageToken': next_page})
    else:
        raise InspectionError('Te veel Android-app-pagina’s; inspectie gestopt.')
    results = []
    for package in PACKAGES:
        matching = [app for app in apps if isinstance(app, dict) and app.get('packageName') == package and app.get('state', 'ACTIVE') == 'ACTIVE']
        if len(matching) > 1:
            raise InspectionError(f'{package}: meerdere actieve registraties; geen configuratie geselecteerd.')
        if not matching:
            results.append({'package': package, 'registered': False, 'sdkConfigValidated': False})
            continue
        app = matching[0]
        app_id = app.get('appId', '')
        if not re.fullmatch(r'1:[0-9]+:android:[a-fA-F0-9]+', app_id) or app.get('name') not in (f'projects/{PROJECT}/androidApps/{app_id}', f'projects/{number}/androidApps/{app_id}'):
            raise InspectionError(f'{package}: onverwachte app-resource.')
        options = sdk_options(fetch(ROOT + '/androidApps/' + quote(app_id, safe=':') + '/config', token), package, app_id, number)
        canonical = json.dumps(options, sort_keys=True, separators=(',', ':')).encode()
        result = {'package': package, 'registered': True, 'sdkConfigValidated': True, 'sdkConfigSha256': hashlib.sha256(canonical).hexdigest()}
        if config_dir is not None:
            directory = Path(config_dir)
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            if directory.is_symlink() or directory.stat().st_mode & 0o077:
                raise InspectionError('De lokale configuratiemap moet privé zijn (0700) en mag geen symlink zijn.')
            output = directory / (package + '.firebase-options.json')
            # No overwrite/symlink following, even with a caller-supplied directory.
            descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(canonical + b'\n')
            result['localConfigWritten'] = True
        results.append(result)
    return {'project': PROJECT, 'readOnly': True, 'oauthScope': SCOPE, 'apps': results, 'productionConfigured': results[0]['sdkConfigValidated'], 'deliveryTested': False, 'fcmSendPermissionTested': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-dir', help='Optionele private lokale map; SDK-waarden worden nooit naar stdout geschreven.')
    args = parser.parse_args()
    try:
        result = inspect(os.environ.get('FIREBASE_ACCESS_TOKEN', ''), config_dir=args.config_dir)
    except InspectionError as error:
        # InspectionError messages are fixed local diagnostics, never Google bodies.
        parser.exit(1, f'Firebase-inspectie gestopt: {error}\n')
    except (OSError, http.client.HTTPException, json.JSONDecodeError):
        # No exception repr: never include a token, SDK key, response body or path.
        parser.exit(1, 'Firebase-inspectie gestopt: bestaande projectconfiguratie/leesrechten konden niet veilig worden bevestigd. Er is niets in Google gewijzigd.\n')
    print(json.dumps(result, sort_keys=True))
    if not result['productionConfigured']:
        parser.exit(2, 'De productiepackage heeft geen bestaande bruikbare Firebase-registratie. Een bevoegde projectbeheerder moet de inrichting afronden.\n')


if __name__ == '__main__':
    main()
