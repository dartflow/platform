#!/usr/bin/python3 -I
"""Root bootstrap only: password stays on VPS; emit its SCRAM verifier privately.

Feed the four GitHub public environment variables as JSON on stdin. Capture stdout
privately to install the verifier through the database management connection.
Never invoke from CI, log stdout, or overwrite an existing immutable bundle.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
from urllib.parse import urlsplit

SPECS = {
    'staging': ('dartflow-staging', 'https://staging.dartflow.nl', 'dsnqnvbckkqpzadblshu'),
    'production': ('dartflow-production', 'https://dartflow.nl', 'wlrnowuownakqqgjxnbb'),
}
KEYS = {'DARTFLOW_APP_ORIGIN', 'DARTFLOW_DATA_MODE', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'}


def trusted(path, directory=False):
    for component in [*reversed(path.parents), path]:
        item = component.lstat()
        if item.st_uid != 0 or item.st_mode & 0o022 or stat.S_ISLNK(item.st_mode):
            raise ValueError('Untrusted bootstrap path')
    if directory and not path.is_dir():
        raise ValueError('Expected bootstrap directory')


def exclusive(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', choices=SPECS, required=True)
    parser.add_argument('--config-id', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'dg-nxttrack-01':
        raise ValueError('Bootstrap requires root on the fixed VPS')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}', args.config_id):
        raise ValueError('Invalid configuration identifier')
    site, origin, ref = SPECS[args.environment]
    values = json.loads(input())
    if not isinstance(values, dict) or set(values) != KEYS or any(not isinstance(v, str) or not 1 <= len(v) <= 4096 or any(ord(c) < 33 or ord(c) >= 127 for c in v) for v in values.values()):
        raise ValueError('Invalid public configuration')
    if values['DARTFLOW_APP_ORIGIN'] != origin or values['DARTFLOW_DATA_MODE'] != 'supabase' or values['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/') != f'https://{ref}.supabase.co' or not values['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].startswith('sb_publishable_'):
        raise ValueError('Public configuration does not match fixed environment')
    root = Path('/etc/dg-sites') / site
    trusted(root, directory=True)
    policy = json.loads((root / 'deploy.json').read_text())
    if args.config_id not in policy['allowedConfigIds'] or policy['backend']['projectRef'] != ref:
        raise ValueError('Configuration not authorized by root policy')
    bundle = root / 'configs' / args.config_id
    trusted(bundle, directory=True)
    if bundle.stat().st_mode & 0o077:
        raise ValueError('Configuration directory must be root-only')
    public_path, runtime_path = bundle / 'public.json', bundle / 'runtime.env'
    public_data = (json.dumps(values, indent=2, sort_keys=True) + '\n').encode()
    if public_path.exists() or runtime_path.exists():
        trusted(public_path)
        trusted(runtime_path)
        if public_path.stat().st_mode & 0o077 or runtime_path.stat().st_mode & 0o077 or json.loads(public_path.read_text()) != values:
            raise ValueError('Existing immutable configuration differs')
        runtime = runtime_path.read_text()
        match = re.fullmatch(r'DARTFLOW_DATABASE_URL="postgresql://dartflow_app:([a-f0-9]{64})@db\.' + ref + r'\.supabase\.co:5432/postgres\?sslmode=verify-full"\n', runtime)
        if not match:
            raise ValueError('Unexpected existing runtime configuration')
        password = match[1]
    else:
        password = secrets.token_hex(32)
        connection = f'postgresql://dartflow_app:{password}@db.{ref}.supabase.co:5432/postgres?sslmode=verify-full'
        exclusive(runtime_path, f'DARTFLOW_DATABASE_URL="{connection}"\n'.encode())
        exclusive(public_path, public_data)
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    client_key = hmac.digest(salted, b'Client Key', 'sha256')
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.digest(salted, b'Server Key', 'sha256')
    encode = lambda value: base64.b64encode(value).decode()
    verifier = f'SCRAM-SHA-256$4096:{encode(salt)}${encode(stored_key)}:{encode(server_key)}'
    # Credential verifier: the caller must consume this without logging it.
    print(json.dumps({'environment': args.environment, 'configId': args.config_id, 'verifier': verifier}))


if __name__ == '__main__':
    main()
