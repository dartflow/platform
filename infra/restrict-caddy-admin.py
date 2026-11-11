#!/usr/bin/python3 -I
"""Restrict the existing Caddy admin TCP listener for six fixed Dartflow UIDs.

Only inet/dartflow_admin_guard is created. No existing rules, chains, global
policies, accounts, Caddy settings or Milo resources are changed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess
import sys

HOST = 'dg-nxttrack-01'
NFT = '/usr/sbin/nft'
TABLE = 'dartflow_admin_guard'
CHAIN = 'output'
POLICIES = {
    'stg': Path('/etc/dg-sites/dartflow-staging/deploy.json'),
    'prd': Path('/etc/dg-sites/dartflow-production/deploy.json'),
}
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}


class Refused(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate configuration key')
        result[key] = value
    return result


def trusted(path):
    path = Path(path)
    require(path.is_absolute(), 'Protected input path must be absolute')
    for part in [*reversed(path.parents), path]:
        info = part.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022 and not stat.S_ISLNK(info.st_mode), 'Expected protected root-owned input')
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Protected input must be a regular file')
    return path


def policy_uids():
    identities = {}
    for suffix, path in POLICIES.items():
        path = trusted(path)
        require(stat.S_IMODE(path.stat().st_mode) == 0o600 and path.stat().st_size <= 65536, 'Protected deploy policy mode or size differs')
        policy = json.loads(path.read_bytes(), object_pairs_hook=unique_object)
        expected = {kind + '-dart-' + suffix for kind in ['run', 'build', 'app']}
        require(isinstance(policy, dict) and isinstance(policy.get('accounts'), dict) and set(policy['accounts']) == expected, 'Fixed deploy account policy differs')
        for name in sorted(expected):
            person = pwd.getpwnam(name)
            require(policy['accounts'][name] == {'uid': person.pw_uid, 'gid': person.pw_gid} and person.pw_uid > 0, 'Live account identity differs from root policy')
            identities[name] = person.pw_uid
    uids = sorted(identities.values())
    require(len(uids) == 6 and len(set(uids)) == 6, 'Six distinct nonroot Dartflow UIDs are required')
    milo = {pwd.getpwnam(name).pw_uid for name in ['run-mil-stg', 'build-mil-stg', 'app-mil-stg']}
    require(not set(uids) & (milo | {0}), 'Root and Milo UIDs must remain outside this guard')
    return identities


def match(left, right):
    return {'match': {'op': '==', 'left': left, 'right': right}}


def objects(uids):
    require(len(uids) == 6 and len(set(uids)) == 6 and all(type(uid) is int and uid > 0 for uid in uids), 'Invalid fixed UID set')
    result = [
        {'table': {'family': 'inet', 'name': TABLE}},
        {'chain': {'family': 'inet', 'table': TABLE, 'name': CHAIN, 'type': 'filter', 'hook': 'output', 'prio': -10, 'policy': 'accept'}},
    ]
    for protocol, address in [('ip', {'prefix': {'addr': '127.0.0.0', 'len': 8}}), ('ip6', '::1')]:
        result.append({'rule': {'family': 'inet', 'table': TABLE, 'chain': CHAIN, 'expr': [
            match({'meta': {'key': 'skuid'}}, {'set': sorted(uids)}),
            match({'payload': {'protocol': protocol, 'field': 'daddr'}}, address),
            match({'payload': {'protocol': 'tcp', 'field': 'dport'}}, 2019),
            {'reject': {'type': 'tcp reset'}},
        ]}})
    return result


def batch(uids):
    expected = objects(uids)
    # CREATE refuses concurrent creation instead of appending rules to any table
    # another root action might install after our read-only existence check.
    return {'nftables': [{'create': item} if index < 2 else {'add': item} for index, item in enumerate(expected)]}


def semantic(value):
    require(isinstance(value, dict) and set(value) == {'nftables'} and isinstance(value['nftables'], list), 'Invalid owned table metadata')
    result = []
    for item in value['nftables']:
        require(isinstance(item, dict) and len(item) == 1, 'Invalid owned table object')
        kind, body = next(iter(item.items()))
        if kind == 'metainfo':
            continue
        require(kind in ['table', 'chain', 'rule'] and isinstance(body, dict), 'Owned table contains an unexpected object')
        normalized = {key: content for key, content in body.items() if key != 'handle'}
        result.append({kind: normalized})
    return result


def nft(arguments, payload=None):
    result = subprocess.run([NFT, *arguments], input=payload, env=CLEAN_ENV, stdin=subprocess.DEVNULL if payload is None else None, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 131072, 'Fixed nft operation failed or returned oversized metadata')
    if not result.stdout.strip():
        return None
    return json.loads(result.stdout, object_pairs_hook=unique_object)


def read_owned(execute=nft):
    listing = execute(['--json', '--numeric', 'list', 'tables'])
    require(isinstance(listing, dict) and isinstance(listing.get('nftables'), list), 'Cannot verify existing nft tables')
    existing = [item['table'] for item in listing['nftables'] if isinstance(item, dict) and 'table' in item]
    if not any(item.get('family') == 'inet' and item.get('name') == TABLE for item in existing):
        return None
    return semantic(execute(['--json', '--numeric', 'list', 'table', 'inet', TABLE]))


def enforce(uids, apply=False, execute=nft):
    expected = objects(uids)
    current = read_owned(execute)
    if current is not None:
        require(current == expected, 'Existing owned table differs; no replacement or flush is allowed')
        return 'already_exact'
    require(apply, 'Owned guard table is missing')
    payload = json.dumps(batch(uids), separators=(',', ':')).encode()
    execute(['--check', '--json', '--file', '-'], payload)
    current = read_owned(execute)
    if current is not None:
        require(current == expected, 'Owned table changed during validation; refusing mutation')
        return 'already_exact'
    execute(['--json', '--file', '-'], payload)
    require(read_owned(execute) == expected, 'Installed guard did not match the complete expected table')
    return 'created_and_verified'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname() == HOST, 'Fixed root target host required')
    trusted(NFT)
    identities = policy_uids()
    uids = sorted(identities.values())
    status = enforce(uids, apply=args.apply) if args.apply or args.verify else 'plan_only_no_kernel_changes'
    print(json.dumps({'status': status, 'host': HOST, 'family': 'inet', 'table': TABLE, 'chain': CHAIN, 'accounts': identities, 'destinationPort': 2019, 'destinations': ['127.0.0.0/8', '::1'], 'expectedSha256': hashlib.sha256(json.dumps(objects(uids), sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'miloAndRootExcluded': True}, sort_keys=True))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, Refused) else 'Caddy admin guard failed; inspect the fixed policy and nft metadata.', file=sys.stderr)
        sys.exit(1)
