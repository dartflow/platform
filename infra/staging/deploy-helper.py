#!/usr/bin/python3 -I
"""Dartflow-only native release helper. Install root-owned only after review.

Descriptor traversal, trusted-tool checks and artifact sealing adapt the reviewed
Milo native-v1 security primitives (milobingo/platform infra/staging/deploy-helper.py,
source SHA256 ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8).
The policy, GitHub source/gate, npm build, config and activation flow are Dartflow-specific.
"""
import contextlib
import fcntl
import grp
import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, unquote, urlsplit

SITE = 'dartflow-staging'
HOST = 'dg-nxttrack-01'
PUBLIC_HOST = 'staging.dartflow.nl'
PORT = 4174
REPOSITORY = 'dartflow/platform'
INTEGRATION_BRANCH = 'main'
DEPLOYMENT_WORKFLOW = 'deploy-staging.yml'
BACKEND_REF = 'dsnqnvbckkqpzadblshu'
BUILD_PREFIX = 'dg-dartflow-staging-build-'
GUARDIAN_PREFIX = 'dg-dartflow-staging-lock-'
SIBLING_ACCOUNTS = ('run-dart-prd', 'build-dart-prd', 'app-dart-prd')
SERVICE = SITE + '.service'
RUNNER = 'run-dart-stg'
BUILDER = 'build-dart-stg'
APP = 'app-dart-stg'
ROOT_UID = 0
SITE_ROOT = Path('/srv/sites/dartflow-staging')
BUILD_ROOT = Path('/var/lib/dg-build/dartflow-staging')
CONFIG_ROOT = Path('/etc/dg-sites/dartflow-staging/configs')
POLICY = Path('/etc/dg-sites/dartflow-staging/deploy.json')
GLOBAL_LOCK = Path('/run/lock/dg-build.lock')
SITE_LOCK = Path('/run/lock/dartflow-staging.deploy.lock')
EXTRACTOR = Path('/usr/local/libexec/dartflow-extract-source.py')
GATE = '/usr/local/libexec/dartflow-release-gate.mjs'
GUARDIAN = Path('/usr/local/libexec/dartflow-lock-guardian.py')
PUBLIC_KEYS = ('DARTFLOW_APP_ORIGIN', 'DARTFLOW_DATA_MODE', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL')
NOFOLLOW = os.O_NOFOLLOW | os.O_CLOEXEC
DIRECTORY = NOFOLLOW | os.O_DIRECTORY | os.O_RDONLY
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
BUILD_LOCK_FDS = ()
SHA_RE = r'[a-f0-9]{40}'
RUN_RE = r'[1-9][0-9]{0,19}-[1-9][0-9]{0,9}'
CONFIG_RE = r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}'
RELEASE_RE = r'[a-f0-9]{12}-' + RUN_RE

class Refused(ValueError):
    pass

class LockBusy(Refused):
    pass

class ActivationFailed(Refused):
    pass

def require(condition, message='Deployment boundary refused'):
    if not condition:
        raise Refused(message)

def trusted_path(path, directory=False):
    path = Path(path)
    require(path.is_absolute(), 'Trusted path must be absolute')
    for component in [*reversed(path.parents), path]:
        item = component.lstat()
        require(item.st_uid == ROOT_UID and not item.st_mode & 0o022
                and not stat.S_ISLNK(item.st_mode), 'Unsafe root-owned path')
    require(path.is_dir() if directory else path.is_file(), 'Wrong trusted file type')
    return path

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result

def trusted_tool(value):
    """Allow installed tool symlinks only when every traversed component is trusted."""
    require(isinstance(value, str) and value.startswith('/'), 'Invalid tool path')
    pending, resolved, links = value.split('/')[1:], [], 0
    while pending:
        part = pending.pop(0)
        if part in ['', '.']:
            continue
        if part == '..':
            require(bool(resolved), 'Tool path escapes root')
            resolved.pop()
            continue
        path = Path('/').joinpath(*resolved, part)
        item = path.lstat()
        require(item.st_uid == ROOT_UID, 'Tool path is not root-owned')
        if stat.S_ISLNK(item.st_mode):
            links += 1
            require(links <= 40, 'Tool symlink cycle')
            target = os.readlink(path)
            if target.startswith('/'):
                resolved = []
            pending = target.split('/') + pending
        else:
            require(not item.st_mode & 0o022, 'Writable tool path')
            require(not pending or stat.S_ISDIR(item.st_mode), 'Invalid tool directory')
            resolved.append(part)
    require(stat.S_ISREG(Path('/').joinpath(*resolved).stat().st_mode), 'Invalid tool executable')

def open_directory(root_fd, parts):
    fd = os.dup(root_fd)
    try:
        for part in parts:
            require(part not in ['', '.', '..'] and '/' not in part, 'Unsafe directory component')
            child = os.open(part, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise

def safe_link(root_fd, parent_parts, target):
    """Resolve every link relative to held directory descriptors, never outside root."""
    require(target and not target.startswith('/'), 'Absolute or empty artifact link')
    pending, resolved, links = list(parent_parts) + target.split('/'), [], 0
    while pending:
        part = pending.pop(0)
        if part in ['', '.']:
            continue
        if part == '..':
            require(bool(resolved), 'Artifact link escapes release')
            resolved.pop()
            continue
        fd = open_directory(root_fd, resolved)
        try:
            item = os.stat(part, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISLNK(item.st_mode):
                links += 1
                require(links <= 40, 'Artifact link cycle')
                link = os.readlink(part, dir_fd=fd)
                require(not link.startswith('/'), 'Artifact link escapes release')
                pending = link.split('/') + pending
            else:
                require(not pending or stat.S_ISDIR(item.st_mode), 'Artifact link traverses a file')
                require(stat.S_ISDIR(item.st_mode) or stat.S_ISREG(item.st_mode), 'Artifact link targets special file')
                resolved.append(part)
        finally:
            os.close(fd)

def copy_tree(source_fd, destination_fd, app_gid, root_fd=None, parts=(), budget=None):
    """Seal only regular files/directories and safe internal relative links."""
    root_fd = source_fd if root_fd is None else root_fd
    budget = {'bytes': 0, 'files': 0, 'digest': hashlib.sha256(), 'maxBytes': 2 * 1024 ** 3, 'maxFiles': 150000} if budget is None else budget
    require(len(parts) <= 64, 'Artifact directory depth exceeds limit')
    for name in sorted(os.listdir(source_fd)):
        require(not name.startswith('.env') and name not in ['.runtime.env', '.release.env', '.release.json', '.git', '.local'], 'Private or reserved artifact file')
        item = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        budget['files'] += 1
        require(budget['files'] <= budget['maxFiles'], 'Artifact contains too many files')
        if stat.S_ISDIR(item.st_mode):
            budget['digest'].update(json.dumps(['directory', *parts, name]).encode() + b'\0')
            child = os.open(name, DIRECTORY, dir_fd=source_fd)
            os.mkdir(name, 0o750, dir_fd=destination_fd)
            target = os.open(name, DIRECTORY, dir_fd=destination_fd)
            try:
                require(os.fstat(child).st_ino == item.st_ino, 'Artifact directory changed')
                copy_tree(child, target, app_gid, root_fd, (*parts, name), budget)
                os.fchown(target, ROOT_UID, app_gid)
                os.fchmod(target, 0o550)
            finally:
                os.close(child)
                os.close(target)
        elif stat.S_ISREG(item.st_mode):
            require(item.st_nlink == 1, 'Hardlinked artifact file')
            budget['bytes'] += item.st_size
            require(budget['bytes'] <= budget['maxBytes'], 'Artifact is too large')
            budget['digest'].update(json.dumps(['file', *parts, name, item.st_size, bool(item.st_mode & 0o111)]).encode() + b'\0')
            source = os.open(name, os.O_RDONLY | NOFOLLOW, dir_fd=source_fd)
            target = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600, dir_fd=destination_fd)
            try:
                before = os.fstat(source)
                require((before.st_dev, before.st_ino, before.st_nlink) ==
                        (item.st_dev, item.st_ino, 1), 'Artifact file changed')
                remaining = item.st_size
                while remaining:
                    block = os.read(source, min(1024 * 1024, remaining))
                    require(bool(block), 'Artifact file truncated')
                    budget['digest'].update(block)
                    view = memoryview(block)
                    while view:
                        view = view[os.write(target, view):]
                    remaining -= len(block)
                after = os.fstat(source)
                require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                        (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Artifact file changed during sealing')
                os.fchown(target, ROOT_UID, app_gid)
                os.fchmod(target, 0o550 if item.st_mode & 0o111 else 0o440)
                os.fsync(target)
            finally:
                os.close(source)
                os.close(target)
        elif stat.S_ISLNK(item.st_mode):
            link = os.readlink(name, dir_fd=source_fd)
            safe_link(root_fd, parts, link)
            budget['digest'].update(json.dumps(['symlink', *parts, name, link]).encode() + b'\0')
            os.symlink(link, name, dir_fd=destination_fd)
            os.chown(name, ROOT_UID, app_gid, dir_fd=destination_fd, follow_symlinks=False)
        else:
            raise ValueError('Special artifact file refused')
    os.fsync(destination_fd)
    return budget

def file_digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def arguments(values):
    require(isinstance(values, list) and bool(values), 'Missing fixed operation')
    if values[0] == 'deploy':
        require(len(values) == 4 and re.fullmatch(SHA_RE, values[1]) and re.fullmatch(RUN_RE, values[2]) and re.fullmatch(CONFIG_RE, values[3]), 'Invalid deployment identity')
    elif values[0] == 'rollback':
        require(len(values) == 2 and re.fullmatch(RELEASE_RE, values[1]), 'Invalid known release ID')
    else:
        raise Refused('Unknown fixed operation')
    return tuple(values)


def read_json(path, limit=65536, private=True):
    path = trusted_path(path)
    info = path.lstat()
    require(info.st_nlink == 1 and info.st_size <= limit and (not private or not info.st_mode & 0o077), 'Unsafe policy metadata')
    fd = os.open(path, os.O_RDONLY | NOFOLLOW)
    try:
        require(os.fstat(fd).st_ino == info.st_ino, 'Metadata changed')
        data = os.read(fd, limit + 1)
        require(len(data) <= limit, 'Metadata exceeds bound')
        return json.loads(data, object_pairs_hook=unique_object)
    finally:
        os.close(fd)


def read_policy():
    policy = read_json(POLICY)
    fields = {'version', 'repository', 'integrationBranch', 'requiredChecks', 'port', 'node', 'npm', 'gateSha256', 'extractorSha256', 'guardianSha256', 'backend', 'accounts', 'allowedConfigIds', 'minFreeBytes', 'minFreeInodes', 'maxSourceBytes', 'maxSourceFiles', 'maxArtifactBytes', 'maxArtifactFiles', 'buildMemoryMax', 'buildCpuQuota', 'buildTimeoutSeconds', 'healthAttempts', 'healthPauseSeconds', 'serviceTimeoutSeconds'}
    require(isinstance(policy, dict) and set(policy) == fields and policy['version'] == 1, 'Incomplete fixed policy')
    require(policy['repository'] == REPOSITORY, 'Wrong fixed repository')
    require(policy['integrationBranch'] == INTEGRATION_BRANCH, 'Wrong fixed integration branch')
    require(isinstance(policy['backend'], dict) and set(policy['backend']) == {'projectRef'} and isinstance(policy['backend']['projectRef'], str) and policy['backend']['projectRef'] == BACKEND_REF, 'Missing dedicated Dartflow backend identity')
    checks = policy['requiredChecks']
    require(isinstance(checks, list) and 1 <= len(checks) <= 10, 'Missing exact CI policy')
    for check in checks:
        require(isinstance(check, dict) and set(check) == {'workflow', 'jobs', 'events'} and re.fullmatch(r'[A-Za-z0-9_.-]+\.ya?ml', check.get('workflow', '')) and isinstance(check['jobs'], list) and check['jobs'] and all(isinstance(j, str) and 1 <= len(j) <= 120 for j in check['jobs']) and check['events'] == ['push'], 'Unsafe required checks')
    require(type(policy['port']) is int and policy['port'] == PORT and PORT != 4173, 'Wrong fixed environment port')
    for name in ['node', 'npm']:
        trusted_tool(policy[name])
        require(os.access(policy[name], os.X_OK), 'Pinned tool unavailable')
    for name, path in [('gateSha256', GATE), ('extractorSha256', EXTRACTOR), ('guardianSha256', GUARDIAN)]:
        trusted_path(path)
        require(isinstance(policy[name], str) and re.fullmatch('[a-f0-9]{64}', policy[name]) and file_digest(path) == policy[name], 'Trusted validator digest differs')
    accounts = policy['accounts']
    require(isinstance(accounts, dict) and set(accounts) == {RUNNER, BUILDER, APP}, 'Missing dedicated identities')
    actual = [pwd.getpwnam(name) for name in [RUNNER, BUILDER, APP]]
    for person in actual:
        require(accounts[person.pw_name] == {'uid': person.pw_uid, 'gid': person.pw_gid} and person.pw_uid != 0, 'Dedicated account identity differs')
    require(len({p.pw_uid for p in actual}) == 3 and len({p.pw_gid for p in actual}) == 3, 'Accounts must be isolated')
    siblings = [pwd.getpwnam(name) for name in ['run-mil-stg', 'build-mil-stg', 'app-mil-stg']]
    for name in SIBLING_ACCOUNTS:
        try:
            siblings.append(pwd.getpwnam(name))
        except KeyError:
            pass  # The other dedicated environment need not be installed yet.
    reserved_uids = {1001, 990, 996} | {p.pw_uid for p in siblings}
    reserved_gids = {1002, 983, 987} | {p.pw_gid for p in siblings}
    require(not {p.pw_uid for p in actual} & reserved_uids and not {p.pw_gid for p in actual} & reserved_gids, 'Milo identities or sibling environment identities cannot be reused')
    for person in actual:
        allowed = {person.pw_gid}
        if person.pw_name == RUNNER:
            allowed.add(grp.getgrnam('dg-build').gr_gid)
        require(set(os.getgrouplist(person.pw_name, person.pw_gid)) <= allowed, 'Sibling or privileged supplemental group refused')
    require(isinstance(policy['allowedConfigIds'], list) and policy['allowedConfigIds'] and all(isinstance(c, str) and re.fullmatch(CONFIG_RE, c) for c in policy['allowedConfigIds']), 'Missing approved configuration IDs')
    for key, minimum, maximum in [('minFreeBytes', 4 * 1024**3, 1024**5), ('minFreeInodes', 50000, 10000000), ('maxSourceBytes', 1, 2 * 1024**3), ('maxSourceFiles', 1, 250000), ('maxArtifactBytes', 1, 8 * 1024**3), ('maxArtifactFiles', 1, 250000), ('buildTimeoutSeconds', 60, 1800), ('healthAttempts', 1, 30), ('healthPauseSeconds', 1, 5), ('serviceTimeoutSeconds', 5, 60)]:
        require(type(policy[key]) is int and minimum <= policy[key] <= maximum, 'Missing bounded resource policy')
    require(isinstance(policy['buildMemoryMax'], str) and re.fullmatch(r'[1-9][0-9]{0,2}[GM]', policy['buildMemoryMax']) and isinstance(policy['buildCpuQuota'], str) and re.fullmatch(r'[1-9][0-9]{0,3}%', policy['buildCpuQuota']), 'Missing build cgroup budget')
    return policy


def request_body(stream, operation):
    body = stream.read(8193)
    require(len(body) <= 8192, 'Credential input exceeds bound')
    value = json.loads(body, object_pairs_hook=unique_object)
    require(isinstance(value, dict), 'Invalid credential input')
    if operation == 'deploy':
        token = value.get('githubToken')
        require(set(value) == {'githubToken'} and isinstance(token, str) and 8 <= len(token) <= 4096 and all(33 <= ord(c) < 127 for c in token), 'Missing ephemeral GitHub credential')
    else:
        require(value == {}, 'Rollback does not accept credentials')
    return value


def public_values(values):
    require(isinstance(values, dict) and set(values) == set(PUBLIC_KEYS) and all(isinstance(v, str) and 1 <= len(v) <= 4096 and all(33 <= ord(c) < 127 for c in v) for v in values.values()), 'Invalid public configuration')
    require(values['DARTFLOW_APP_ORIGIN'] == 'https://' + PUBLIC_HOST and values['DARTFLOW_DATA_MODE'] == 'supabase', 'Wrong fixed environment origin or mode')
    parsed = urlsplit(values['NEXT_PUBLIC_SUPABASE_URL'])
    require(parsed.scheme == 'https' and parsed.hostname and re.fullmatch(r'[a-z0-9]{20}\.supabase\.co', parsed.hostname) and not parsed.username and not parsed.password and not parsed.port and parsed.path in ['', '/'] and not parsed.query and not parsed.fragment, 'Wrong public backend origin')
    require(values['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].startswith('sb_publishable_'), 'Wrong public key type')
    return values


def public_hash(values):
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def validate_database(value, public):
    require(isinstance(value, str) and 1 <= len(value) <= 16384 and all(33 <= ord(c) < 127 for c in value), 'Invalid runtime database value')
    parsed = urlsplit(value)
    ref = urlsplit(public['NEXT_PUBLIC_SUPABASE_URL']).hostname.split('.')[0]
    require(parsed.scheme in ['postgres', 'postgresql'] and parsed.password and parsed.path not in ['', '/'] and not parsed.fragment and parsed.port in [None, 5432], 'Incomplete runtime database connection')
    user = unquote(parsed.username or '')
    require((parsed.hostname == f'db.{ref}.supabase.co' and user == 'dartflow_app') or (parsed.hostname and parsed.hostname.endswith('.pooler.supabase.com') and user == f'dartflow_app.{ref}'), 'Runtime database must use the dedicated same-project app role')
    require(parse_qs(parsed.query, keep_blank_values=True) == {'sslmode': ['verify-full']}, 'Runtime database requires verified TLS without overrides')


def runtime_values(text, public):
    """Parse a fixed server-only allowlist using an unambiguous EnvironmentFile subset."""
    allowed = {'DARTFLOW_DATABASE_URL', 'DARTFLOW_ENV', 'DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY',
               'DARTFLOW_MAIL_ALLOWED_FROM', 'DARTFLOW_MAIL_ALLOWED_REPLY_TO', 'DARTFLOW_MAIL_TEST_RECIPIENTS', 'DARTFLOW_MAIL_MAX_MODE',
               'DARTFLOW_MAIL_WORKER_TOKEN', 'DARTFLOW_ADMIN_REQUIRE_MFA', 'SUPABASE_MANAGEMENT_TOKEN',
               'DARTFLOW_TURN_SECRET', 'DARTFLOW_TURN_URLS'}
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        require(separator and key in allowed and key not in result, 'Unknown or duplicate runtime variable')
        if value.startswith('"'):
            require(len(value) >= 2 and value.endswith('"'), 'Unterminated runtime value')
            value = value[1:-1]
        require(0 < len(value) <= 16384 and all(33 <= ord(c) < 127 for c in value)
                and not any(c in value for c in ['\\', '"', "'"]), 'Unsafe runtime value')
        result[key] = value
    require('DARTFLOW_DATABASE_URL' in result, 'Missing runtime database')
    validate_database(result['DARTFLOW_DATABASE_URL'], public)
    expected_environment = 'staging' if SITE.endswith('-staging') else 'production'
    if 'DARTFLOW_ENV' in result:
        require(result['DARTFLOW_ENV'] == expected_environment, 'Runtime environment differs')
    if 'DARTFLOW_MAIL_MAX_MODE' in result:
        require(result['DARTFLOW_MAIL_MAX_MODE'] in ['log', 'test', 'live'], 'Invalid mail ceiling')
        require(expected_environment != 'staging' or result['DARTFLOW_MAIL_MAX_MODE'] != 'live', 'Staging cannot send unrestricted mail')
    if 'DARTFLOW_ADMIN_REQUIRE_MFA' in result:
        require(result['DARTFLOW_ADMIN_REQUIRE_MFA'] in ['true', 'false'], 'Invalid MFA setting')
    for key in ['DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY', 'DARTFLOW_TURN_SECRET']:
        if key in result:
            require(re.fullmatch(r'[A-Za-z0-9+/]{43}=', result[key]), 'Expected per-environment 256-bit key')
    if 'DARTFLOW_MAIL_WORKER_TOKEN' in result:
        require(re.fullmatch('[a-f0-9]{64}', result['DARTFLOW_MAIL_WORKER_TOKEN']), 'Invalid mail worker token')
    for key in ['DARTFLOW_MAIL_ALLOWED_FROM', 'DARTFLOW_MAIL_ALLOWED_REPLY_TO', 'DARTFLOW_MAIL_TEST_RECIPIENTS']:
        if key in result:
            require(all(re.fullmatch(r'[^@,\s<>]+@[^@,\s<>]+\.[^@,\s<>]+', address) for address in result[key].split(',')), 'Invalid mail boundary')
    if 'DARTFLOW_TURN_URLS' in result:
        require(all(re.fullmatch(r'turns?:[A-Za-z0-9.\[\]:-]+(?:\?transport=(?:udp|tcp))?', url) for url in result['DARTFLOW_TURN_URLS'].split(',')), 'Invalid TURN endpoint')
    return result


def read_bundle(config_id, project_ref):
    require(isinstance(config_id, str) and re.fullmatch(CONFIG_RE, config_id), 'Unsafe configuration ID')
    root = trusted_path(CONFIG_ROOT / config_id, directory=True)
    require(not root.stat().st_mode & 0o077, 'Configuration directory must be root-only')
    public_path, runtime_path = root / 'public.json', root / 'runtime.env'
    values = public_values(read_json(public_path, 32768))
    require(urlsplit(values['NEXT_PUBLIC_SUPABASE_URL']).hostname == project_ref + '.supabase.co', 'Bundle does not match approved Dartflow backend')
    trusted_path(runtime_path)
    info = runtime_path.lstat()
    require(info.st_nlink == 1 and not info.st_mode & 0o077 and info.st_size <= 32768, 'Unsafe protected runtime configuration')
    fd = os.open(runtime_path, os.O_RDONLY | NOFOLLOW)
    try:
        text = os.read(fd, 32769).decode('utf-8')
    finally:
        os.close(fd)
    runtime_values(text, values)
    return {'id': config_id, 'public': values, 'publicHash': public_hash(values), 'runtimePath': runtime_path, 'runtimeHash': file_digest(runtime_path)}


def capacity(path, policy, extra_bytes=0, extra_files=0):
    disk = os.statvfs(path)
    require(disk.f_bavail * disk.f_frsize >= policy['minFreeBytes'] + extra_bytes and disk.f_favail >= policy['minFreeInodes'] + extra_files, 'Insufficient build or artifact capacity')


def open_lock(path, shared=False):
    parent = path.parent.stat()
    require(parent.st_uid in [0, ROOT_UID] and (not parent.st_mode & 0o022 or parent.st_mode & stat.S_ISVTX), 'Unsafe lock directory')
    fd = os.open(path, os.O_RDWR | os.O_CREAT | NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == ROOT_UID and info.st_nlink == 1 and not info.st_mode & 0o007, 'Unsafe lock file')
        if info.st_mode & 0o070:
            require(shared and info.st_gid == grp.getgrnam('dg-build').gr_gid and not info.st_mode & 0o011, 'Wrong shared lock permissions')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise LockBusy('Deployment lock occupied') from None
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextlib.contextmanager
def deployment_locks(global_path=GLOBAL_LOCK, site_path=SITE_LOCK):
    # Both deploy and rollback use this same order; exit 75 is possible only here.
    global_fd = open_lock(global_path, shared=True)
    site_fd = None
    try:
        site_fd = open_lock(site_path)
        yield (global_fd, site_fd)
    finally:
        if site_fd is not None:
            os.close(site_fd)
        os.close(global_fd)


def guardian_state(unit):
    result = subprocess.run(['/usr/bin/systemctl', 'show', unit, '--property=ActiveState,SubState', '--value'], env=CLEAN_ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, check=False)
    require(len(result.stdout) <= 256, 'Oversized guardian state')
    return set(result.stdout.decode().splitlines()) if result.returncode == 0 else set()


def start_guardian(lock_fds, run, policy):
    require(re.fullmatch(RUN_RE, run), 'Invalid guardian run')
    trusted_path(GUARDIAN)
    require(file_digest(GUARDIAN) == policy['guardianSha256'], 'Guardian digest differs')
    unit = GUARDIAN_PREFIX + run + '.service'
    start = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19]
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe', '--service-type=notify', '--unit=' + unit, '--uid=root', '--gid=root', '--property=NotifyAccess=main', '--property=TimeoutStartSec=10', '--property=TimeoutStopSec=infinity', '--property=KillMode=process', '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes', '--property=PrivateTmp=yes', '--property=CapabilityBoundingSet=', '--property=TasksMax=32', '--property=MemoryMax=64M', '--property=CPUQuota=10%', '/usr/bin/python3', '-I', str(GUARDIAN), run, str(os.getpid()), start]
    process = subprocess.Popen(args, stdin=lock_fds[0], stdout=lock_fds[1], stderr=subprocess.DEVNULL, env=CLEAN_ENV, close_fds=True)
    # Startup failures still leave the helper's own descriptors locked. No source
    # or package code runs before the guardian has verified its pidfd and FDs.
    for _ in range(15):
        state = guardian_state(unit)
        if {'active', 'running'} <= state:
            return {'unit': unit, 'client': process}
        require('failed' not in state and process.poll() in [None, 0], 'Guardian startup failed')
        time.sleep(1)
    raise Refused('Guardian readiness timed out; no build started')


def finish_guardian(guardian):
    unit = guardian['unit']
    subprocess.run(['/usr/bin/systemctl', 'kill', '--kill-whom=main', '--signal=SIGUSR1', unit], env=CLEAN_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False)
    for _ in range(20):
        state = guardian_state(unit)
        if 'inactive' in state or (not state and guardian['client'].poll() == 0):
            try:
                guardian['client'].wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            return
        time.sleep(1)
    raise Refused('Guardian retains deployment locks; inspect fixed build units and perform root recovery')


def command(argv, **options):
    return subprocess.run(argv, env=CLEAN_ENV, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)


def github_gate(policy, sha, token, run):
    run_id, attempt = run.split('-')
    payload = {'repository': policy['repository'], 'integrationBranch': policy['integrationBranch'], 'sha': sha, 'requiredChecks': policy['requiredChecks'], 'githubToken': token, 'deploymentRun': {'id': run_id, 'attempt': int(attempt)}, 'deploymentWorkflow': DEPLOYMENT_WORKFLOW}
    result = subprocess.run([policy['node'], GATE, '--stdin'], input=json.dumps(payload).encode(), env=CLEAN_ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=90, check=True)
    require(len(result.stdout) <= 65536, 'Oversized release-gate evidence')
    evidence = json.loads(result.stdout, object_pairs_hook=unique_object)
    require(isinstance(evidence, dict) and evidence.get('status') == 'passed' and evidence.get('sha') == sha and isinstance(evidence.get('ciRunUrl'), str) and re.fullmatch(r'https://github\.com/' + re.escape(policy['repository']) + r'/actions/runs/[1-9][0-9]*', evidence['ciRunUrl']), 'Exact commit CI gate refused')
    require(evidence.get('deploymentRunUrl') == 'https://github.com/' + policy['repository'] + '/actions/runs/' + run_id, 'Deployment run provenance differs')
    return evidence


def download_archive(policy, sha, token, destination):
    """HTTPS API/codeload only, with no shell or token-bearing files/command line."""
    target = 'https://api.github.com/repos/' + policy['repository'] + '/tarball/' + sha
    deadline = time.monotonic() + 120
    with destination.open('xb') as output:
        for redirect in range(4):
            url = urlsplit(target)
            require(url.scheme == 'https' and url.hostname in ['api.github.com', 'codeload.github.com'] and not url.username and not url.password and not url.port and not url.fragment, 'Untrusted source redirect')
            if url.hostname == 'codeload.github.com':
                require(url.path in ['/' + policy['repository'] + '/legacy.tar.gz/' + sha, '/' + policy['repository'] + '/tar.gz/' + sha], 'Source redirect identity differs')
            connection = http.client.HTTPSConnection(url.hostname, timeout=10)
            try:
                path = url.path + ('?' + url.query if url.query else '')
                connection.request('GET', path, headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'Dartflow-native-release-v1', 'Accept': 'application/vnd.github+json'})
                response = connection.getresponse()
                if response.status in [301, 302, 307, 308]:
                    require(redirect < 3, 'Too many archive redirects')
                    target = response.getheader('Location') or ''
                    continue
                require(response.status == 200, 'Exact GitHub archive unavailable')
                size = 0
                while True:
                    require(time.monotonic() <= deadline, 'Source download timeout')
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    require(size <= policy['maxSourceBytes'], 'Source archive exceeds resource bound')
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
                require(size > 0, 'Empty source archive')
                return
            finally:
                connection.close()
        raise Refused('Source redirect refused')


def build_command(argv, work, policy, run, stage, values=None, stdin=None):
    require(stage in ['extract', 'versions', 'install', 'build'], 'Unknown build stage')
    require(len(BUILD_LOCK_FDS) == 2 and all(fd >= 3 for fd in BUILD_LOCK_FDS), 'Build requires retained controller locks')
    env = {'PATH': f"{Path(policy['node']).parent}:{Path(policy['npm']).parent}:/usr/bin:/bin", 'HOME': str(work / 'home'), 'TMPDIR': str(work / 'tmp'), 'LANG': 'C.UTF-8', 'CI': 'true', 'NEXT_TELEMETRY_DISABLED': '1'}
    if values:
        require(set(values) <= set(PUBLIC_KEYS) | {'DARTFLOW_RELEASE_SHA', 'DARTFLOW_RELEASE_ID', 'DARTFLOW_BUILD_CONFIG_ID', 'DARTFLOW_RUNTIME_CONFIG_ID'}, 'Build secret or unknown variable refused')
        env.update(values)
    unit = BUILD_PREFIX + run + '-' + stage
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe', '--service-type=exec', '--unit=' + unit, '--uid=' + BUILDER, '--gid=' + BUILDER, '--working-directory=' + str(work / 'source'), '--property=KillMode=control-group', '--property=RuntimeMaxSec=' + str(policy['buildTimeoutSeconds']), '--property=TimeoutStopSec=10', '--property=UMask=0077', '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes', '--property=PrivateTmp=yes', '--property=ProtectProc=invisible', '--property=RestrictSUIDSGID=yes', '--property=CapabilityBoundingSet=', '--property=TasksMax=256', '--property=MemoryMax=' + policy['buildMemoryMax'], '--property=CPUQuota=' + policy['buildCpuQuota'], '--property=InaccessiblePaths=/etc/dg-sites /srv/sites /home/' + RUNNER, '--property=ReadWritePaths=' + str(work), '/usr/bin/env', '-i', *[key + '=' + value for key, value in env.items()], *argv]
    try:
        # systemd v255 preserves these extra FDs in the trusted --wait client.
        # Its D-Bus payload forwards only stdin/out/err to the unprivileged unit.
        # Thus even a delayed orphan client retains both locks until its unit ends.
        command(args, stdin=stdin, timeout=policy['buildTimeoutSeconds'] + 30, pass_fds=BUILD_LOCK_FDS)
    finally:
        # A timed-out systemd-run client is insufficient: terminate the actual build cgroup.
        subprocess.run(['/usr/bin/systemctl', 'stop', unit + '.service'], env=CLEAN_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
        stopped = subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', unit + '.service'], env=CLEAN_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
        require(stopped.returncode in [3, 4], 'Build cgroup could not be confirmed stopped')


def private_file(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def env_file(values):
    require(all(re.fullmatch('[A-Z_]+', key) and isinstance(value, str) and all(ord(c) >= 32 and ord(c) != 127 for c in value) for key, value in values.items()), 'Invalid release environment metadata')
    return ''.join(key + '="' + value.replace('\\', '\\\\').replace('"', '\\"') + '"\n' for key, value in sorted(values.items()))


def release_values(sha, run, bundle, policy):
    return {**bundle['public'], 'NODE_ENV': 'production', 'HOSTNAME': '127.0.0.1', 'PORT': str(policy['port']), 'DARTFLOW_RELEASE_SHA': sha, 'DARTFLOW_RELEASE_ID': run, 'DARTFLOW_BUILD_CONFIG_ID': bundle['id'], 'DARTFLOW_RUNTIME_CONFIG_ID': bundle['id']}


def metadata(root, name, policy):
    require(isinstance(name, str) and re.fullmatch(RELEASE_RE, name), 'Unknown release target')
    release = trusted_path(root / 'releases' / name, directory=True)
    data = read_json(release / '.release.json', 32768)
    fields = {'format', 'sha', 'releaseId', 'configId', 'port', 'publicConfigHash', 'runtimeConfigHash', 'artifactSha256', 'helperSha256', 'gateValidatorSha256', 'ciRunUrl', 'toolchain'}
    require(isinstance(data, dict) and set(data) == fields and data['format'] == 'dartflow-native-release-v1' and re.fullmatch(SHA_RE, data['sha']) and re.fullmatch(RUN_RE, data['releaseId']) and name == data['sha'][:12] + '-' + data['releaseId'] and data['port'] == policy['port'], 'Release identity differs')
    require(all(isinstance(data[k], str) and re.fullmatch('[a-f0-9]{64}', data[k]) for k in ['publicConfigHash', 'runtimeConfigHash', 'artifactSha256', 'helperSha256', 'gateValidatorSha256']), 'Missing release fingerprints')
    tools = data['toolchain']
    require(isinstance(tools, dict) and set(tools) == {'node', 'npm', 'nodeSha256', 'npmSha256'} and tools['node'] == '24.18.0' and tools['npm'] == '11.16.0' and all(isinstance(tools[key], str) and re.fullmatch('[a-f0-9]{64}', tools[key]) for key in ['nodeSha256', 'npmSha256']), 'Pinned toolchain evidence differs')
    require(isinstance(data['ciRunUrl'], str) and re.fullmatch(r'https://github\.com/' + re.escape(policy['repository']) + r'/actions/runs/[1-9][0-9]*', data['ciRunUrl']), 'Missing exact repository CI evidence')
    bundle = read_bundle(data['configId'], policy['backend']['projectRef'])
    require(data['configId'] in policy['allowedConfigIds'] and bundle['publicHash'] == data['publicConfigHash'] and bundle['runtimeHash'] == data['runtimeConfigHash'], 'Configuration was changed or revoked')
    runtime = release / '.runtime.env'
    require(runtime.is_symlink() and runtime.lstat().st_uid == ROOT_UID and os.readlink(runtime) == str(bundle['runtimePath']), 'Release runtime configuration link differs')
    expected = env_file(release_values(data['sha'], data['releaseId'], bundle, policy))
    release_env = trusted_path(release / '.release.env')
    require(not release_env.stat().st_mode & 0o077 and release_env.read_text() == expected, 'Release environment metadata differs')
    return data


def http_identity(meta, endpoint, public=False):
    connection = http.client.HTTPSConnection(PUBLIC_HOST, timeout=2) if public else http.client.HTTPConnection('127.0.0.1', meta['port'], timeout=2)
    try:
        connection.request('GET', endpoint, headers={'Host': PUBLIC_HOST, 'Cache-Control': 'no-cache'})
        response = connection.getresponse()
        raw = response.read(65537)
        if response.status != 200 or len(raw) > 65536:
            return False
        value = json.loads(raw)
        return (value.get('status'), value.get('sha'), value.get('releaseId'), value.get('buildConfigId'), value.get('runtimeConfigId')) == ('ready' if endpoint == '/api/ready' else 'ok', meta['sha'], meta['releaseId'], meta['configId'], meta['configId'])
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def health(meta):
    return all(http_identity(meta, endpoint, public) for public in [False, True] for endpoint in ['/api/health', '/api/ready'])


def service(action, policy):
    require(action in ['restart', 'stop'], 'Unknown fixed service action')
    require(len(BUILD_LOCK_FDS) == 2 and all(fd >= 3 for fd in BUILD_LOCK_FDS), 'App client requires retained controller locks')
    # The trusted synchronous v255 client retains the OFDs until its job ends.
    # RestartUnit/StopUnit send only unit/mode strings to PID1, never these FDs.
    command(['/usr/bin/systemctl', action, SERVICE], timeout=policy['serviceTimeoutSeconds'], pass_fds=BUILD_LOCK_FDS)


def point_current(root, name):
    require(re.fullmatch(RELEASE_RE, name), 'Unsafe release name')
    temporary = root / '.current-next'
    require(not temporary.exists() and not temporary.is_symlink(), 'Stale activation transaction')
    try:
        os.symlink('releases/' + name, temporary)
        os.replace(temporary, root / 'current')
        fd = os.open(root, DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def activate(root, name, policy, check=health, operate=service, read=metadata, pause=time.sleep, allow_unhealthy_current=False):
    next_meta = read(root, name, policy)
    current = root / 'current'
    previous = None
    if current.is_symlink():
        target = os.readlink(current)
        require(target.startswith('releases/') and target.count('/') == 1 and re.fullmatch(RELEASE_RE, target[9:]), 'Unsafe current link')
        previous = target[9:]
    else:
        require(not current.exists(), 'Current is not an atomic release link')
    try:
        previous_meta = read(root, previous, policy) if previous else None
    except (OSError, ValueError):
        require(allow_unhealthy_current, 'Existing release metadata invalid')
        previous_meta = None
    previous_healthy = previous_meta is not None and check(previous_meta)
    if previous and not allow_unhealthy_current:
        require(previous_healthy, 'Existing release health/readiness baseline failed')
    def wait_ready(meta):
        for attempt in range(policy['healthAttempts']):
            if check(meta):
                return True
            if attempt + 1 < policy['healthAttempts']:
                pause(policy['healthPauseSeconds'])
        return False
    try:
        # Includes interruption after replace/fsync and before the restart call.
        point_current(root, name)
        operate('restart', policy)
        require(wait_ready(next_meta), 'Candidate health/readiness failed')
    except Exception as failure:
        if previous_healthy:
            try:
                point_current(root, previous)
                operate('restart', policy)
                require(wait_ready(previous_meta), 'Recovered release health/readiness failed')
            except Exception:
                operate('stop', policy)
                raise ActivationFailed('Activation and recovery failed; service stopped') from failure
            raise ActivationFailed('Candidate failed; prior app and exact config recovered') from failure
        try:
            if previous:
                point_current(root, previous)
        finally:
            try:
                operate('stop', policy)
            finally:
                if not previous:
                    current.unlink(missing_ok=True)
        message = 'Rollback target failed without healthy fallback; service stopped' if previous else 'First installation failed; service stopped and no current release'
        raise ActivationFailed(message) from failure
    return next_meta


def standalone_contract(root, sha, bundle):
    for relative in [('server.js', False), ('public', True), ('.next/static', True), ('build-config.json', False)]:
        path = root / relative[0]
        require(not path.is_symlink() and (path.is_dir() if relative[1] else path.is_file()), 'Incomplete standalone output')
    marker = read_json(root / 'build-config.json', 8192, private=False)
    require(marker.get('format') == 'dartflow-build-config-v1' and marker.get('sourceSha') == sha and marker.get('configId') == bundle['id'] and marker.get('publicConfigHash') == bundle['publicHash'], 'Built public configuration marker differs')


def artifact_size(source_fd, policy, total=None, depth=0):
    require(depth <= 64, 'Artifact directory depth exceeds limit')
    total = {'bytes': 0, 'files': 0} if total is None else total
    for name in os.listdir(source_fd):
        item = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        total['files'] += 1
        require(total['files'] <= policy['maxArtifactFiles'], 'Too many artifact files')
        if stat.S_ISDIR(item.st_mode):
            child = os.open(name, DIRECTORY, dir_fd=source_fd)
            try:
                artifact_size(child, policy, total, depth + 1)
            finally:
                os.close(child)
        elif stat.S_ISREG(item.st_mode):
            require(item.st_nlink == 1, 'Hardlinked artifact refused')
            total['bytes'] += item.st_size
            require(total['bytes'] <= policy['maxArtifactBytes'], 'Artifact byte bound exceeded')
        else:
            require(stat.S_ISLNK(item.st_mode), 'Special artifact refused')
    return total


def deploy_release(policy, sha, run, config_id, token, gate=github_gate, download=download_archive, build=build_command, activate_release=activate):
    require(config_id in policy['allowedConfigIds'], 'Unapproved configuration ID')
    bundle = read_bundle(config_id, policy['backend']['projectRef'])
    for path in [SITE_ROOT, SITE_ROOT / 'releases', BUILD_ROOT, CONFIG_ROOT]:
        trusted_path(path, directory=True)
    builder, app = pwd.getpwnam(BUILDER), pwd.getpwnam(APP)
    require(SITE_ROOT.stat().st_gid == app.pw_gid and BUILD_ROOT.stat().st_gid == builder.pw_gid and not BUILD_ROOT.stat().st_mode & 0o007, 'Site/build ownership differs')
    for path in [SITE_ROOT, BUILD_ROOT]:
        capacity(path, policy)
    name = sha[:12] + '-' + run
    release, pending = SITE_ROOT / 'releases' / name, SITE_ROOT / 'releases' / ('.pending-' + name)
    require(not release.exists() and not release.is_symlink() and not pending.exists() and not pending.is_symlink(), 'Release ID already exists')
    # Independent trusted gate runs before package scripts and does not trust workflow assertions.
    evidence = gate(policy, sha, token, run)
    archive = BUILD_ROOT / ('.archive-' + run + '.tar.gz')
    require(not archive.exists() and not archive.is_symlink(), 'Unknown existing source archive retained')
    work = Path(tempfile.mkdtemp(prefix=run + '-', dir=BUILD_ROOT))
    try:
        for directory in ['source', 'home', 'tmp']:
            target = work / directory
            target.mkdir(mode=0o700)
            os.chown(target, builder.pw_uid, builder.pw_gid)
        os.chown(work, builder.pw_uid, builder.pw_gid)
        download(policy, sha, token, archive)
        token = None  # No credentials are forwarded beyond the trusted source acquisition.
        with archive.open('rb') as stream:
            build(['/usr/bin/python3', '-I', str(EXTRACTOR), str(policy['maxSourceBytes']), str(policy['maxSourceFiles'])], work, policy, run, 'extract', stdin=stream)
        versions = 'import subprocess,sys;sys.exit(0 if subprocess.check_output([sys.argv[1],"--version"]).decode().strip()==sys.argv[2] and subprocess.check_output([sys.argv[3],"--version"]).decode().strip()==sys.argv[4] else 1)'
        build(['/usr/bin/python3', '-I', '-c', versions, policy['node'], 'v24.18.0', policy['npm'], '11.16.0'], work, policy, run, 'versions')
        public = {**bundle['public'], 'DARTFLOW_RELEASE_SHA': sha, 'DARTFLOW_RELEASE_ID': run, 'DARTFLOW_BUILD_CONFIG_ID': config_id, 'DARTFLOW_RUNTIME_CONFIG_ID': config_id}
        build([policy['npm'], 'ci', '--no-audit', '--no-fund'], work, policy, run, 'install', values=public)
        build([policy['npm'], 'run', 'build'], work, policy, run, 'build', values=public)
        source_root = os.open(work / 'source', DIRECTORY)
        try:
            source_fd = open_directory(source_root, ['.next', 'standalone'])
        finally:
            os.close(source_root)
        try:
            measured = artifact_size(source_fd, policy)
            capacity(SITE_ROOT, policy, measured['bytes'], measured['files'])
            pending.mkdir(mode=0o750)
            destination_fd = os.open(pending, DIRECTORY)
            try:
                artifact = copy_tree(source_fd, destination_fd, app.pw_gid, budget={'bytes': 0, 'files': 0, 'digest': hashlib.sha256(), 'maxBytes': policy['maxArtifactBytes'], 'maxFiles': policy['maxArtifactFiles']})
            finally:
                os.close(destination_fd)
        finally:
            os.close(source_fd)
        capacity(SITE_ROOT, policy)
        standalone_contract(pending, sha, bundle)
        (pending / '.runtime.env').symlink_to(bundle['runtimePath'])
        private_file(pending / '.release.env', env_file(release_values(sha, run, bundle, policy)))
        meta = {'format': 'dartflow-native-release-v1', 'sha': sha, 'releaseId': run, 'configId': config_id, 'port': policy['port'], 'publicConfigHash': bundle['publicHash'], 'runtimeConfigHash': bundle['runtimeHash'], 'artifactSha256': artifact['digest'].hexdigest(), 'helperSha256': file_digest(__file__), 'gateValidatorSha256': policy['gateSha256'], 'ciRunUrl': evidence['ciRunUrl'], 'toolchain': {'node': '24.18.0', 'npm': '11.16.0', 'nodeSha256': file_digest(policy['node']), 'npmSha256': file_digest(policy['npm'])}}
        private_file(pending / '.release.json', json.dumps(meta, sort_keys=True) + '\n')
        os.chown(pending, ROOT_UID, app.pw_gid)
        pending.chmod(0o550)
        os.rename(pending, release)
        activate_release(SITE_ROOT, name, policy)
        return {'status': 'passed', 'site': SITE, 'sha': sha, 'releaseId': run, 'configId': config_id, 'ciRunUrl': evidence['ciRunUrl'], 'deploymentRunUrl': 'https://github.com/' + policy['repository'] + '/actions/runs/' + run.split('-')[0]}
    finally:
        archive.unlink(missing_ok=True)
        shutil.rmtree(work)
        # Never prune a sealed release or an active/previous config, even after a failed activation.
        if pending.exists():
            shutil.rmtree(pending)


def main():
    global BUILD_LOCK_FDS
    args = arguments(sys.argv[1:])
    require(os.geteuid() == 0 and socket.gethostname() == HOST, 'Wrong helper host or privilege')
    policy = read_policy()
    runner = pwd.getpwnam(RUNNER)
    require(os.environ.get('SUDO_USER') == RUNNER and os.environ.get('SUDO_UID') == str(runner.pw_uid) and os.environ.get('SUDO_GID') == str(runner.pw_gid), 'Wrong fixed sudo caller')
    body = request_body(sys.stdin.buffer, args[0])
    run = args[2] if args[0] == 'deploy' else args[1][13:]
    with deployment_locks() as lock_fds:
        BUILD_LOCK_FDS = lock_fds
        guardian = start_guardian(lock_fds, run, policy)
        try:
            if args[0] == 'deploy':
                result = deploy_release(policy, args[1], args[2], args[3], body['githubToken'])
            else:
                result = activate(SITE_ROOT, args[1], policy, allow_unhealthy_current=True)
                result = {'status': 'passed', 'operation': 'rollback', 'site': SITE, 'sha': result['sha'], 'releaseId': result['releaseId'], 'configId': result['configId']}
        finally:
            finish_guardian(guardian)
        print(json.dumps(result, sort_keys=True))


def interrupted(_signal, _frame):
    raise Refused('Operation interrupted')


if __name__ == '__main__':
    os.umask(0o077)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        main()
    except LockBusy:
        print('Dartflow deployment lock occupied; retry only this exit code after bounded delay.', file=sys.stderr)
        sys.exit(75)
    except Exception:
        print('Dartflow native operation refused or failed; inspect protected host evidence. No credential values logged.', file=sys.stderr)
        sys.exit(1)
