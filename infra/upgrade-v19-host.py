#!/usr/bin/python3 -I
"""Reviewed fixed-host v19 PIN provisioning; never invoked by CI/deploy runners.

Default: read-only host preflight. --apply creates two NEW protected config
bundles and updates only their existing helper/entry/sudoers/config allowlist.
No app, service, database, Caddy, Milo or existing config bundle is modified.
"""
import argparse
import ast
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import subprocess
import sys
import tempfile
import types

HOST = 'dg-nxttrack-01'
BASELINE_SHA = '0503413f96fcf2288f48f5dbacc9bd54ea42e823'
BACKUPS = Path('/var/backups/dartflow')
LOCK = Path('/run/lock/dg-build.lock')
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
SPECS = {
    'staging': {'site': 'dartflow-staging', 'entry': 'dg-dartflow-deploy', 'helper': 'dg-dartflow-deploy-helper', 'extractor': 'dartflow-extract-source.py', 'guardian': 'dartflow-lock-guardian.py', 'gate': 'dartflow-release-gate.mjs', 'runner': 'run-dart-stg', 'host': 'staging.dartflow.nl', 'ref': 'dsnqnvbckkqpzadblshu', 'port': 4174},
    'production': {'site': 'dartflow-production', 'entry': 'dg-dartflow-production-deploy', 'helper': 'dg-dartflow-production-deploy-helper', 'extractor': 'dartflow-production-extract-source.py', 'guardian': 'dartflow-production-lock-guardian.py', 'gate': 'dartflow-production-release-gate.mjs', 'runner': 'run-dart-prd', 'host': 'dartflow.nl', 'ref': 'wlrnowuownakqqgjxnbb', 'port': 4175},
}
CURRENT_IDS = {env: env + '-2026-11-11-v15-mail-1' for env in SPECS}
NEW_IDS = {env: env + '-2026-11-12-v19-pin-1' for env in SPECS}
PIN_VERSION = 'v1'
PIN_KEYS = {'DARTFLOW_PLAYER_PIN_PEPPERS', 'DARTFLOW_PLAYER_PIN_PEPPER_VERSION'}


class Refused(ValueError):
    pass


class LockBusy(Refused):
    pass


def require(ok, reason):
    if not ok:
        raise Refused(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate protected JSON key')
        result[key] = value
    return result


def trusted(path, directory=False, private=False):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'Protected path must be absolute')
    for part in [*reversed(path.parents), path]:
        info = part.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022 and not stat.S_ISLNK(info.st_mode), 'Untrusted protected path')
        require(stat.S_ISDIR(info.st_mode) if part != path or directory else stat.S_ISREG(info.st_mode), 'Protected path type differs')
        if part == path and private:
            require(not info.st_mode & 0o077, 'Protected configuration/backup is not private')
        if part == path and not directory:
            require(info.st_nlink == 1, 'Hardlinked protected file refused')
    return path


def read(path, maximum=524288, private=False):
    path = trusted(path, private=private)
    before = path.lstat()
    require(before.st_size <= maximum, 'Protected input exceeds bound')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        require((info.st_dev, info.st_ino, info.st_size) == (before.st_dev, before.st_ino, before.st_size), 'Protected file changed while opening')
        data = os.read(fd, maximum + 1)
        require(len(data) <= maximum, 'Protected input exceeds bound')
        return data
    finally:
        os.close(fd)


def json_value(data):
    return json.loads(data, object_pairs_hook=unique_object)


def run(arguments, timeout=30):
    result = subprocess.run(arguments, env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    require(result.returncode == 0, 'Fixed read-only validation failed; raw output withheld')
    require(len(result.stdout) <= 1024 * 1024, 'Validation output exceeds bound')
    return result.stdout


def entry_binding(data):
    """Read literal pins without executing entry or runner-owned source."""
    values = {}
    for node in ast.parse(data).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            key = node.targets[0].id
            if key in {'HOST', 'RUNNER', 'HELPER_SHA256'}:
                require(key not in values, 'Duplicate entry pin')
                values[key] = ast.literal_eval(node.value)
            elif key == 'HELPER':
                require(key not in values and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'Path' and len(node.value.args) == 1 and not node.value.keywords, 'Invalid fixed helper path')
                values[key] = ast.literal_eval(node.value.args[0])
    require(set(values) == {'HOST', 'RUNNER', 'HELPER_SHA256', 'HELPER'}, 'Missing entry pins')
    return values


def validate_pins(entry, sudoers, spec, helper_hash):
    require(re.fullmatch('[a-f0-9]{64}', helper_hash), 'Invalid helper digest')
    require(entry_binding(entry) == {'HOST': HOST, 'RUNNER': spec['runner'], 'HELPER_SHA256': helper_hash, 'HELPER': '/usr/local/libexec/' + spec['helper']}, 'Entry helper/account/host binding differs')
    pins = re.findall(rb'sha256:([a-f0-9]{64})\b', sudoers)
    require(pins == [helper_hash.encode()] * 2, 'Sudoers helper digests differ')
    active = [line for line in sudoers.decode().splitlines() if line.strip() and not line.lstrip().startswith('#')]
    require(len(active) == 2 and all(line.startswith(spec['runner'] + ' ALL=(root) NOPASSWD: sha256:' + helper_hash + ' /usr/local/libexec/' + spec['helper'] + ' ^') for line in active), 'Sudoers scope differs')
    require(' ^deploy ' in active[0] and ' ^rollback ' in active[1], 'Only fixed deploy/rollback sudo rules are permitted')


def policy_with_config(policy, environment):
    result = json.loads(json.dumps(policy))
    spec = SPECS[environment]
    require(result.get('repository') == 'dartflow/platform' and result.get('integrationBranch') == 'main' and result.get('backend') == {'projectRef': spec['ref']} and result.get('port') == spec['port'], 'Existing environment policy identity differs')
    ids = result.get('allowedConfigIds')
    require(isinstance(ids, list) and len(ids) == len(set(ids)) and CURRENT_IDS[environment] in ids and NEW_IDS[environment] not in ids, 'Existing immutable config allowlist differs')
    ids.append(NEW_IDS[environment])
    return result


def pin_runtime(original, encoded):
    require(isinstance(original, bytes) and isinstance(encoded, str) and re.fullmatch(r'[A-Za-z0-9+/]{43}=', encoded), 'Invalid new PIN runtime material')
    require(base64.b64encode(base64.b64decode(encoded, validate=True)).decode() == encoded, 'Noncanonical new PIN material')
    require(not any(line.strip().startswith(b'DARTFLOW_PLAYER_PIN_') for line in original.splitlines()), 'Existing PIN configuration requires an explicit rotation plan')
    separator = b'' if original.endswith(b'\n') else b'\n'
    result = original + separator + ('DARTFLOW_PLAYER_PIN_PEPPERS=' + PIN_VERSION + ':' + encoded + '\nDARTFLOW_PLAYER_PIN_PEPPER_VERSION=' + PIN_VERSION + '\n').encode()
    require(len(result) <= 32768, 'New protected runtime exceeds the native bundle budget')
    return result


def helper_module(source, environment):
    module = types.ModuleType('reviewed_v19_' + environment)
    module.__file__ = '/usr/local/libexec/' + SPECS[environment]['helper']
    exec(compile(source, module.__file__, 'exec'), module.__dict__)
    spec = SPECS[environment]
    require((module.SITE, module.PUBLIC_HOST, module.PORT, module.BACKEND_REF, module.REPOSITORY, module.INTEGRATION_BRANCH, module.RUNNER) == (spec['site'], spec['host'], spec['port'], spec['ref'], 'dartflow/platform', 'main', spec['runner']), 'Reviewed helper fixed environment differs')
    require(set(module.PUBLIC_KEYS) == {'DARTFLOW_APP_ORIGIN', 'DARTFLOW_DATA_MODE', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'} and PIN_KEYS <= module.PLAYER_PIN_RUNTIME_KEYS, 'Reviewed runtime/public boundary differs')
    return module


def manifest_files(spec):
    return {'/usr/local/libexec/' + spec[key] for key in ['helper', 'extractor', 'guardian', 'gate']} | {'/usr/local/libexec/dartflow-probe-lock-lifetime.py', '/usr/local/bin/' + spec['entry'], '/etc/sudoers.d/' + spec['site'], '/etc/systemd/system/' + spec['site'] + '.service', '/etc/dg-sites/' + spec['site'] + '/deploy.example.json'}


def prepare(renders, expected_manifests):
    trusted(renders, directory=True)
    plans = {}
    for environment, spec in SPECS.items():
        root = trusted(renders / environment, directory=True)
        manifest_raw = read(root / 'manifest.json', 65536)
        require(digest(manifest_raw) == expected_manifests[environment], 'Reviewed manifest fingerprint differs')
        manifest = json_value(manifest_raw)
        require(manifest.get('format') == 'dartflow-fixed-broker-v1' and manifest.get('environment') == environment and manifest.get('repository') == 'dartflow/platform' and manifest.get('integrationBranch') == 'main' and manifest.get('site') == spec['site'] and manifest.get('projectRef') == spec['ref'] and manifest.get('port') == spec['port'], 'Reviewed manifest fixed identity differs')
        require(set(manifest.get('files', {})) == manifest_files(spec), 'Reviewed manifest file set differs')
        reviewed = {}
        for name, measurement in manifest['files'].items():
            data = read(root / name.lstrip('/'))
            require(measurement == {'sha256': digest(data), 'bytes': len(data)}, 'Reviewed source digest/size differs')
            reviewed[name] = data
        helper_path, entry_path, sudoers_path = '/usr/local/libexec/' + spec['helper'], '/usr/local/bin/' + spec['entry'], '/etc/sudoers.d/' + spec['site']
        module = helper_module(reviewed[helper_path], environment)
        policy = module.read_policy()  # Existing root policy, tool hashes and real isolated accounts.
        policy_path = Path('/etc/dg-sites') / spec['site'] / 'deploy.json'
        policy_raw = read(policy_path, 65536, private=True)
        require(json_value(policy_raw) == policy, 'Existing policy changed while validating')
        new_policy = policy_with_config(policy, environment)
        for key, pin in [('gate', 'gateSha256'), ('extractor', 'extractorSha256'), ('guardian', 'guardianSha256')]:
            path = '/usr/local/libexec/' + spec[key]
            require(read(path) == reviewed[path] and digest(reviewed[path]) == policy[pin], 'Unrelated validator update requires separate review')
        old_files = {name: read(name) for name in [helper_path, entry_path, sudoers_path]}
        old_hash, new_hash = digest(old_files[helper_path]), digest(reviewed[helper_path])
        validate_pins(old_files[entry_path], old_files[sudoers_path], spec, old_hash)
        validate_pins(reviewed[entry_path], reviewed[sudoers_path], spec, new_hash)
        require(old_files[entry_path] == reviewed[entry_path].replace(new_hash.encode(), old_hash.encode()) and old_files[sudoers_path] == reviewed[sudoers_path].replace(new_hash.encode(), old_hash.encode()), 'Entry/sudoers change exceeds the helper pin update')
        run(['/usr/sbin/visudo', '-cf', str(root / sudoers_path.lstrip('/'))])
        config_root = trusted(policy_path.parent / 'configs', directory=True)
        old_bundle = trusted(config_root / CURRENT_IDS[environment], directory=True, private=True)
        require(stat.S_IMODE(old_bundle.stat().st_mode) == 0o700, 'Existing bundle mode differs')
        public_raw, runtime_raw = read(old_bundle / 'public.json', 32768, private=True), read(old_bundle / 'runtime.env', 32768, private=True)
        require(all(stat.S_IMODE((old_bundle / name).stat().st_mode) == 0o600 for name in ['public.json', 'runtime.env']), 'Existing immutable bundle files must remain 0600')
        public = json_value(public_raw)
        module.read_bundle(CURRENT_IDS[environment], spec['ref'])
        existing = module.runtime_values(runtime_raw.decode(), public)
        require(not (set(existing) & module.PLAYER_PIN_RUNTIME_KEYS), 'An existing PIN bundle requires a rotation review')
        probe = pin_runtime(runtime_raw, base64.b64encode(bytes(32)).decode())
        require(set(module.runtime_values(probe.decode(), public)) == set(existing) | PIN_KEYS, 'New PIN runtime changes unrelated variables')
        destination = config_root / NEW_IDS[environment]
        require(not destination.exists() and not destination.is_symlink(), 'Immutable v19 configuration already exists; no reuse/overwrite permitted')
        current = Path('/srv/sites') / spec['site'] / 'current'
        require(current.is_symlink() and current.lstat().st_uid == 0, 'Existing current link is not root-owned')
        target = os.readlink(current)
        require(re.fullmatch(r'releases/' + BASELINE_SHA[:12] + r'-[1-9][0-9]*-[1-9][0-9]*', target), 'Existing active release is not the approved v18 baseline')
        metadata = module.metadata(current.parent, target[9:], policy)
        require(metadata['sha'] == BASELINE_SHA and metadata['configId'] == CURRENT_IDS[environment] and module.health(metadata), 'Existing active app/config baseline is not healthy')
        modes = {helper_path: 0o755, entry_path: 0o755, sudoers_path: 0o440, str(policy_path): 0o600}
        old_files[str(policy_path)] = policy_raw
        for name, mode in modes.items():
            require(stat.S_IMODE(trusted(name).stat().st_mode) == mode and trusted(name).stat().st_gid == 0, 'Existing native control file mode/group differs')
        plans[environment] = {'spec': spec, 'module': module, 'old': old_files, 'new': {helper_path: reviewed[helper_path], entry_path: reviewed[entry_path], sudoers_path: reviewed[sudoers_path], str(policy_path): (json.dumps(new_policy, indent=2) + '\n').encode()}, 'modes': modes, 'newPolicy': new_policy, 'publicRaw': public_raw, 'runtimeRaw': runtime_raw, 'public': public, 'oldBundle': old_bundle, 'destination': destination, 'oldHelperHash': old_hash, 'newHelperHash': new_hash, 'manifestHash': digest(manifest_raw)}
    return plans


def unit(name):
    properties = ['ActiveState', 'MainPID', 'ActiveEnterTimestamp']
    return dict(line.split('=', 1) for line in run(['/usr/bin/systemctl', 'show', name, *sum([['-p', key] for key in properties], [])]).decode().splitlines() if '=' in line)


def baseline():
    apps = {}
    for site in ['dartflow-staging', 'dartflow-production', 'milobingo-staging']:
        state = unit(site + '.service')
        require(state['ActiveState'] == 'active' and int(state['MainPID']) > 0, 'Existing required app is not active')
        apps[site] = {'current': os.readlink('/srv/sites/' + site + '/current'), **state}
    protected_files = [Path('/usr/local/bin/dg-site-deploy'), Path('/etc/systemd/system/milobingo-staging.service'), Path('/etc/caddy/Caddyfile'), *sorted(Path('/etc/caddy/sites').glob('*.caddy'))]
    return {'applications': apps, 'protectedFiles': {str(path): digest(read(path)) for path in protected_files}, 'caddy': unit('caddy.service'), 'sharedLock': lock_identity()}


def lock_identity():
    info = LOCK.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o660 and (info.st_dev, info.st_ino) == (29, 6), 'Existing shared buildlock identity differs')
    return {'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid, 'gid': info.st_gid, 'mode': '0660'}


def atomic(path, data, mode):
    path = Path(path)
    trusted(path.parent, directory=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.v19-pin-', dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def controls_unchanged(plans):
    for plan in plans.values():
        require(all(read(name) == data for name, data in plan['old'].items()), 'Native control file changed since preflight')
        require(all(stat.S_IMODE(trusted(name).stat().st_mode) == mode for name, mode in plan['modes'].items()), 'Native control mode changed since preflight')
        require(read(plan['oldBundle'] / 'public.json', private=True) == plan['publicRaw'] and read(plan['oldBundle'] / 'runtime.env', private=True) == plan['runtimeRaw'], 'Existing immutable config changed since preflight')


def apply(plans, before):
    trusted(BACKUPS, directory=True, private=True)
    backup = BACKUPS / ('v19-pin-host-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700)
    report = {'backup': str(backup), 'environments': {}, 'changesApplied': True, 'servicesRestarted': False, 'existingBundlesChanged': False, 'secretsPrinted': False}
    for environment, plan in plans.items():
        for name, data in plan['old'].items():
            destination = backup / environment / name.lstrip('/')
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            atomic(destination, data, 0o600)
    controls_unchanged(plans)
    require(baseline() == before, 'Application/Caddy/Milo/lock baseline changed before apply')
    generated = {environment: base64.b64encode(secrets.token_bytes(32)).decode() for environment in SPECS}
    require(len(set(generated.values())) == len(SPECS), 'Environment PIN material must differ')
    installed = []
    created = []
    try:
        for environment, plan in plans.items():
            runtime = pin_runtime(plan['runtimeRaw'], generated[environment])
            parsed = plan['module'].runtime_values(runtime.decode(), plan['public'])
            require(set(parsed) == set(plan['module'].runtime_values(plan['runtimeRaw'].decode(), plan['public'])) | PIN_KEYS, 'New config modifies unknown runtime fields')
            destination = plan['destination']
            destination.mkdir(mode=0o700)  # Exclusive; never replace an immutable bundle.
            created.append(str(destination))
            atomic(destination / 'public.json', plan['publicRaw'], 0o600)
            atomic(destination / 'runtime.env', runtime, 0o600)
            require(read(destination / 'public.json', private=True) == plan['publicRaw'] and read(destination / 'runtime.env', private=True).startswith(plan['runtimeRaw']), 'New config did not preserve exact public/runtime baseline bytes')
            plan['module'].read_bundle(NEW_IDS[environment], plan['spec']['ref'])
        # A partially updated pin chain denies deployment; global buildlock keeps
        # normal deploy/rollback outside this short management transaction.
        for environment, plan in plans.items():
            for name, data in plan['new'].items():
                require(read(name) == plan['old'][name] and stat.S_IMODE(trusted(name).stat().st_mode) == plan['modes'][name], 'Native control file changed during apply')
                installed.append((environment, name))
                atomic(name, data, plan['modes'][name])
        run(['/usr/sbin/visudo', '-c'])
        for environment, plan in plans.items():
            require(plan['module'].read_policy() == plan['newPolicy'], 'Installed native policy differs')
            validate_pins(read('/usr/local/bin/' + plan['spec']['entry']), read('/etc/sudoers.d/' + plan['spec']['site']), plan['spec'], digest(read('/usr/local/libexec/' + plan['spec']['helper'])))
            require(read(plan['oldBundle'] / 'public.json', private=True) == plan['publicRaw'] and read(plan['oldBundle'] / 'runtime.env', private=True) == plan['runtimeRaw'], 'Existing config changed during apply')
            report['environments'][environment] = {'configId': NEW_IDS[environment], 'copiedConfigId': CURRENT_IDS[environment], 'pepperVersion': PIN_VERSION, 'hostGeneratedBits': 256, 'oldHelperSha256': plan['oldHelperHash'], 'newHelperSha256': plan['newHelperHash'], 'reviewedManifestSha256': plan['manifestHash'], 'publicBytesPreserved': True, 'runtimeBaselineBytesPreserved': True, 'newRuntimeKeys': sorted(PIN_KEYS)}
        require(baseline() == before, 'Application/Caddy/Milo/lock baseline changed during apply')
        atomic(backup / 'upgrade-proof.json', (json.dumps(report, indent=2) + '\n').encode(), 0o600)
    except BaseException:
        for environment, name in reversed(installed):
            plan = plans[environment]
            current = read(name)
            require(current in [plan['new'][name], plan['old'][name]], 'Concurrent control change prevents automatic recovery')
            if current != plan['old'][name]:
                atomic(name, plan['old'][name], plan['modes'][name])
        run(['/usr/sbin/visudo', '-c'])
        require(baseline() == before, 'Application baseline changed; root recovery required')
        # Keep newly generated secrets root-only, unapproved and unused for audit.
        # Never erase/reuse/overwrite an immutable ID after a partial application.
        raise Refused('Upgrade failed; prior control files restored; newly created private config IDs require root review') from None
    finally:
        generated.clear()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renders', type=Path, required=True)
    parser.add_argument('--staging-manifest-sha256', required=True)
    parser.add_argument('--production-manifest-sha256', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname() == HOST, 'Authorized root on the fixed target host required')
    os.umask(0o077)
    trusted(Path(__file__), private=False)
    manifests = {env: getattr(args, env + '_manifest_sha256') for env in SPECS}
    require(all(re.fullmatch('[a-f0-9]{64}', value) for value in manifests.values()), 'Provide both reviewed manifest fingerprints')
    lock_identity()
    descriptor = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        require((os.fstat(descriptor).st_dev, os.fstat(descriptor).st_ino) == (29, 6), 'Shared lock descriptor identity differs')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise LockBusy('Existing buildlock busy; no upgrade started') from None
        before = baseline()
        plans = prepare(args.renders, manifests)
        run(['/usr/sbin/visudo', '-c'])
        controls_unchanged(plans)
        require(baseline() == before, 'Read-only preflight observed a changed application baseline')
        if args.apply:
            result = apply(plans, before)
        else:
            result = {'validated': True, 'changesApplied': False, 'hostSecretsGenerated': False, 'environments': {env: {'configId': NEW_IDS[env], 'oldHelperSha256': plan['oldHelperHash'], 'newHelperSha256': plan['newHelperHash'], 'reviewedManifestSha256': plan['manifestHash']} for env, plan in plans.items()}}
        print(json.dumps(result, indent=2, sort_keys=True))
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, Refused) else 'Fixed v19 upgrade refused; raw protected diagnostics withheld'
        print(json.dumps({'status': 'failed', 'reason': message, 'secretsPrinted': False}), file=sys.stderr)
        sys.exit(75 if isinstance(error, LockBusy) else 1)
