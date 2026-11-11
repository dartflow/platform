#!/usr/bin/python3 -I
"""Reviewable, additive bootstrap for the two fixed Dartflow environments.

Default: inspect rendered artifacts and print a plan. --apply is root-only on
dg-nxttrack-01. Runtime/public provider values are deliberately not accepted.
No runner is registered and no Dartflow app is started by this installer.
"""
import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import subprocess
import sys
import tempfile
import urllib.request

HOST = 'dg-nxttrack-01'
NODE = '/opt/node-v24.18.0-linux-x64/bin/node'
# Observed on the target on 2026-11-11; the renderer's example npm path was absent.
NPM = '/opt/node-v24.18.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js'
CADDY = '/usr/bin/caddy'
CADDY_MAIN = Path('/etc/caddy/Caddyfile')
CADDY_SITES = Path('/etc/caddy/sites')
DATABASE_CA = Path('/usr/local/share/dg-certificates/supabase-prod-ca-bundle.crt')
DATABASE_CA_SHA256 = '6ecd239038a7db063a6619b71742372ecfe06c0b0ec12a9993fee4445bf0d4d6'
GLOBAL_LOCK = Path('/run/lock/dg-build.lock')
ENV = {'PATH': str(Path(NODE).parent) + ':/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
CONFIG_RE = r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}'
SPECS = {
    'staging': {'site': 'dartflow-staging', 'suffix': 'stg', 'entry': 'dg-dartflow-deploy', 'helper': 'dg-dartflow-deploy-helper', 'extractor': 'dartflow-extract-source.py', 'guardian': 'dartflow-lock-guardian.py', 'gate': 'dartflow-release-gate.mjs', 'origin': 'https://staging.dartflow.nl', 'port': 4174, 'workflow': 'deploy-staging.yml'},
    'production': {'site': 'dartflow-production', 'suffix': 'prd', 'entry': 'dg-dartflow-production-deploy', 'helper': 'dg-dartflow-production-deploy-helper', 'extractor': 'dartflow-production-extract-source.py', 'guardian': 'dartflow-production-lock-guardian.py', 'gate': 'dartflow-production-release-gate.mjs', 'origin': 'https://dartflow.nl', 'port': 4175, 'workflow': 'deploy-production.yml'},
}
MILO_FILES = [Path('/usr/local/bin/dg-site-deploy'), Path('/etc/systemd/system/milobingo-staging.service'), Path('/etc/caddy/sites/milobingo-staging.caddy')]


class Refused(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(args, capture=False, timeout=20):
    result = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    require(result.returncode == 0, 'Required fixed host command failed: ' + Path(args[0]).name)
    return result.stdout.decode().strip() if capture else None


def trusted(path, directory=False):
    path = Path(path)
    require(path.is_absolute(), 'Expected absolute protected path')
    for component in [*reversed(path.parents), path]:
        info = component.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022 and not stat.S_ISLNK(info.st_mode), 'Expected root-owned immutable input or destination path')
    require(path.is_dir() if directory else path.is_file(), 'Protected path has wrong file type')
    return path


def read_input(stream):
    raw = stream.read(4097)
    require(len(raw) <= 4096, 'Bootstrap request is too large')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate bootstrap request key')
            result[key] = value
        return result
    value = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(value, dict) and set(value) == set(SPECS), 'Specify exactly staging and production; no credential values are accepted')
    for name in SPECS:
        entry = value[name]
        require(isinstance(entry, dict) and set(entry) == {'configId'} and isinstance(entry['configId'], str) and re.fullmatch(CONFIG_RE, entry['configId']), 'Each environment requires only a safe immutable configId')
    return value


def paths(spec):
    site = spec['site']
    return {
        '/usr/local/bin/' + spec['entry']: 0o755,
        **{'/usr/local/libexec/' + spec[name]: 0o755 for name in ['helper', 'extractor', 'guardian', 'gate']},
        '/usr/local/libexec/dartflow-probe-lock-lifetime.py': 0o755,
        '/etc/sudoers.d/' + site: 0o440,
        '/etc/systemd/system/' + site + '.service': 0o644,
        '/etc/dg-sites/' + site + '/deploy.example.json': 0o600,
    }


def load_render(directory, name, protected=False):
    root = Path(directory).resolve()
    if protected:
        trusted(root, directory=True)
        trusted(root / 'manifest.json')
    manifest = json.loads((root / 'manifest.json').read_text())
    spec = SPECS[name]
    require(manifest.get('format') == 'dartflow-fixed-broker-v1' and manifest.get('environment') == name, 'Rendered environment identity differs')
    for key, value in spec.items():
        require(manifest.get(key) == value, 'Rendered fixed host contract differs: ' + key)
    require(manifest.get('repository') == 'dartflow/platform' and manifest.get('integrationBranch') == 'main', 'Rendered repository contract differs')
    require(isinstance(manifest.get('projectRef'), str) and re.fullmatch('[a-z0-9]{20}', manifest['projectRef']), 'Rendered backend identity is missing')
    require(set(manifest['files']) == set(paths(spec)), 'Rendered file allowlist differs')
    files = {}
    for absolute, description in manifest['files'].items():
        source = root / absolute.lstrip('/')
        require(not source.is_symlink() and source.is_file(), 'Rendered file must be regular')
        if protected:
            trusted(source)
        data = source.read_bytes()
        require(description == {'sha256': digest(data), 'bytes': len(data)}, 'Rendered file digest differs')
        files[absolute] = data
    return {'manifest': manifest, 'files': files}


def service_state():
    return run(['/usr/bin/systemctl', 'show', 'milobingo-staging.service', '--property=ActiveState,SubState,MainPID', '--value'], capture=True)


def milo_health():
    with urllib.request.urlopen('https://milo-staging.dgwebservices.nl/api/health', timeout=12) as response:
        require(response.status == 200, 'Milo HTTPS baseline failed')
        value = json.loads(response.read(65537))
    require(value.get('status') == 'ok', 'Milo health baseline is unhealthy')
    return {key: value.get(key) for key in ['status', 'revision', 'releaseId', 'configVersion']}


def baseline():
    state = service_state()
    require('active' in state.splitlines() and 'running' in state.splitlines(), 'Milo must be healthy before bootstrap')
    current = Path('/srv/sites/milobingo-staging/current')
    require(current.is_symlink(), 'Milo current release must remain a symlink')
    return {'serviceState': state, 'current': os.readlink(current), 'files': {str(path): digest(trusted(path).read_bytes()) for path in MILO_FILES}, 'health': milo_health()}


def ensure_directory(path, mode, uid=0, gid=0):
    path = Path(path)
    if path.exists() or path.is_symlink():
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, gid, mode), 'Existing Dartflow directory differs from approved ownership/mode')
    else:
        trusted(path.parent, directory=True)
        path.mkdir(mode=mode)
        os.chown(path, uid, gid)
        path.chmod(mode)


def create_accounts():
    records = {}
    dg_gid = grp.getgrnam('dg-build').gr_gid
    for spec in SPECS.values():
        for kind in ['run', 'build', 'app']:
            name = kind + '-dart-' + spec['suffix']
            home = '/home/' + name if kind == 'run' else ('/var/lib/dg-build/' if kind == 'build' else '/srv/sites/') + spec['site']
            shell = '/bin/bash' if kind == 'run' else '/usr/sbin/nologin'
            created = False
            try:
                person = pwd.getpwnam(name)
            except KeyError:
                if kind == 'run':
                    require(not Path(home).exists() and not Path(home).is_symlink(), 'Refusing an existing home for a new runner account')
                run(['/usr/sbin/useradd', '--system', '--user-group', '--home-dir', home, '--shell', shell, '--password', '!', '--create-home' if kind == 'run' else '--no-create-home', name])
                person = pwd.getpwnam(name)
                created = True
            require(person.pw_uid != 0 and person.pw_dir == home and person.pw_shell == shell and grp.getgrgid(person.pw_gid).gr_name == name, 'Existing dedicated account identity differs')
            if kind == 'run' and dg_gid not in os.getgrouplist(name, person.pw_gid):
                run(['/usr/sbin/usermod', '--append', '--groups', 'dg-build', name])
            allowed = {person.pw_gid, dg_gid} if kind == 'run' else {person.pw_gid}
            require(set(os.getgrouplist(name, person.pw_gid)) == allowed, 'Dedicated account has unexpected supplementary groups')
            if kind == 'run':
                if created:
                    require(not Path(home).is_symlink(), 'Unexpected runner home link')
                    Path(home).chmod(0o700)
                ensure_directory(home, 0o700, person.pw_uid, person.pw_gid)
            records[name] = {'uid': person.pw_uid, 'gid': person.pw_gid}
    require(len({record['uid'] for record in records.values()}) == 6 and len({record['gid'] for record in records.values()}) == 6, 'All Dartflow identities must be separate')
    for name in ['run-mil-stg', 'build-mil-stg', 'app-mil-stg']:
        sibling = pwd.getpwnam(name)
        require(sibling.pw_uid not in {r['uid'] for r in records.values()} and sibling.pw_gid not in {r['gid'] for r in records.values()}, 'Milo identities must never be reused')
    return records


def site_directories(spec, config_id, accounts):
    app = accounts['app-dart-' + spec['suffix']]
    build = accounts['build-dart-' + spec['suffix']]
    for path in ['/etc/dg-sites', '/srv/sites', '/var/lib/dg-build', '/usr/local/libexec']:
        if not Path(path).exists():
            ensure_directory(path, 0o755)
        trusted(path, directory=True)
    ensure_directory('/srv/sites/' + spec['site'], 0o750, 0, app['gid'])
    ensure_directory('/srv/sites/' + spec['site'] + '/releases', 0o750, 0, app['gid'])
    ensure_directory('/srv/sites/' + spec['site'] + '/shared', 0o750, app['uid'], app['gid'])
    ensure_directory('/var/lib/dg-build/' + spec['site'], 0o750, 0, build['gid'])
    ensure_directory('/etc/dg-sites/' + spec['site'], 0o700)
    ensure_directory('/etc/dg-sites/' + spec['site'] + '/configs', 0o700)
    ensure_directory('/etc/dg-sites/' + spec['site'] + '/configs/' + config_id, 0o700)


def atomic_new_file(path, data, mode, installed):
    path = Path(path)
    trusted(path.parent, directory=True)
    if path.exists() or path.is_symlink():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == mode and path.read_bytes() == data, 'Refusing to overwrite a differing existing host file')
        return
    fd, temporary = tempfile.mkstemp(prefix='.dartflow-bootstrap-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fchown(stream.fileno(), 0, 0)
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)
        installed.append((path, digest(data)))
    finally:
        Path(temporary).unlink(missing_ok=True)


def site_lock(spec, installed):
    # /run/lock is commonly root-owned sticky 1777; do not chmod or replace it.
    parent = GLOBAL_LOCK.parent.stat()
    require(parent.st_uid == 0 and stat.S_ISDIR(parent.st_mode) and (not parent.st_mode & 0o022 or parent.st_mode & stat.S_ISVTX), 'Unsafe shared lock directory')
    path = GLOBAL_LOCK.parent / (spec['site'] + '.deploy.lock')
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except FileExistsError:
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, 'Existing Dartflow site lock differs')
    else:
        os.fchmod(fd, 0o600)
        os.fsync(fd)
        os.close(fd)
        installed.append((path, digest(b'')))


def caddy_fragment(spec):
    fragment = (spec['origin'].removeprefix('https://') + ' {\n'
            '    @sensitive path /auth/callback /api/auth/* /scherm/* /api/screen/*\n'
            '    log_skip @sensitive\n'
            '    reverse_proxy 127.0.0.1:' + str(spec['port']) + '\n}\n')
    if spec['site'] == 'dartflow-production':
        fragment += '\nwww.dartflow.nl {\n    redir https://dartflow.nl{uri} permanent\n}\n'
    return fragment.encode()


def caddy_fingerprint():
    trusted(CADDY_MAIN)
    trusted(CADDY_SITES, directory=True)
    return {str(path): digest(trusted(path).read_bytes()) for path in [CADDY_MAIN, *sorted(CADDY_SITES.glob('*.caddy'))]}


def caddy_install(fragments):
    before = caddy_fingerprint()
    require(re.search(rb'^\s*import\s+/etc/caddy/sites/\*\.caddy\s*$', CADDY_MAIN.read_bytes(), re.MULTILINE), 'Verified Caddy import contract differs')
    new = {}
    for path, content in fragments.items():
        if path.exists() or path.is_symlink():
            require(not path.is_symlink() and trusted(path).read_bytes() == content, 'Existing Dartflow Caddy fragment differs')
        else:
            new[path] = content
    installed = []
    reload_attempted = False
    try:
        with tempfile.TemporaryDirectory(prefix='.dartflow-bootstrap-', dir='/etc/caddy') as directory:
            directory = Path(directory)
            config = CADDY_MAIN.read_bytes() + b'\n'
            for path, content in new.items():
                candidate = directory / path.name
                candidate.write_bytes(content)
                candidate.chmod(0o600)
                config += ('import ' + str(candidate) + '\n').encode()
            validation = directory / 'Caddyfile'
            validation.write_bytes(config)
            validation.chmod(0o600)
            run([CADDY, 'validate', '--config', str(validation), '--adapter', 'caddyfile'], timeout=30)
            require(caddy_fingerprint() == before, 'Caddy files changed during validation')
            for path, content in new.items():
                atomic_new_file(path, content, 0o644, installed)
            run([CADDY, 'validate', '--config', str(CADDY_MAIN), '--adapter', 'caddyfile'], timeout=30)
            reload_attempted = True
            run(['/usr/bin/systemctl', 'reload', 'caddy.service'], timeout=30)
    except BaseException:
        for path, checksum in reversed(installed):
            require(not path.is_symlink() and digest(path.read_bytes()) == checksum, 'Caddy candidate changed; root recovery required')
            path.unlink()
        require(caddy_fingerprint() == before, 'Caddy restoration differs; root recovery required')
        if installed or reload_attempted:
            run([CADDY, 'validate', '--config', str(CADDY_MAIN), '--adapter', 'caddyfile'], timeout=30)
        if reload_attempted:
            run(['/usr/bin/systemctl', 'reload', 'caddy.service'], timeout=30)
        raise
    return [str(path) for path in new]


def apply(rendered, request, database_ca):
    require(os.geteuid() == 0 and socket.gethostname() == HOST, 'Apply requires root on the one verified target host')
    for binary in [NODE, NPM, CADDY, '/usr/sbin/visudo', '/usr/sbin/useradd', '/usr/sbin/usermod']:
        trusted(binary)
        require(os.access(binary, os.X_OK), 'Required fixed executable is unavailable')
    require(run([NODE, '--version'], capture=True) == 'v24.18.0' and run([NPM, '--version'], capture=True) == '11.16.0', 'Pinned toolchain differs')
    require(run(['/usr/bin/systemctl', '--version'], capture=True).startswith('systemd 255 '), 'Reviewed systemd v255 descriptor contract differs')
    require(re.match(r'v2\.(?:[89]|[1-9][0-9])\.', run([CADDY, 'version'], capture=True)), 'Caddy log_skip requires version 2.8 or newer')
    ca_data = trusted(database_ca).read_bytes()
    require(len(ca_data) == 2738 and digest(ca_data) == DATABASE_CA_SHA256, 'Reviewed Supabase public CA bundle differs')
    group = grp.getgrnam('dg-build')
    info = GLOBAL_LOCK.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == group.gr_gid and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o660, 'Existing shared build lock contract differs')
    lock = os.open(GLOBAL_LOCK, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('Existing shared build lock is occupied; no bootstrap changes made') from None
        old = baseline()
        for spec in SPECS.values():
            current = Path('/srv/sites/' + spec['site'] + '/current')
            require(not current.exists() and not current.is_symlink(), 'Bootstrap refuses an environment with an existing current release')
            with socket.socket() as connection:
                connection.settimeout(1)
                require(connection.connect_ex(('127.0.0.1', spec['port'])) == 111, 'Fixed Dartflow port is occupied or unconfirmed')
        accounts = create_accounts()
        installed = []
        ensure_directory(DATABASE_CA.parent, 0o755)
        atomic_new_file(DATABASE_CA, ca_data, 0o644, installed)
        for name, spec in SPECS.items():
            site_directories(spec, request[name]['configId'], accounts)
            rendered_files = rendered[name]['files']
            for source, mode in paths(spec).items():
                data, target = rendered_files[source], Path(source)
                if source.endswith('/deploy.example.json'):
                    policy = json.loads(data)
                    policy['accounts'] = {account: records for account, records in accounts.items() if account.endswith('-' + spec['suffix'])}
                    policy['allowedConfigIds'] = [request[name]['configId']]
                    policy['node'], policy['npm'] = NODE, NPM
                    data = (json.dumps(policy, indent=2) + '\n').encode()
                    target = target.with_name('deploy.json')
                if source.startswith('/etc/sudoers.d/'):
                    with tempfile.NamedTemporaryFile(prefix='dartflow-sudoers-', dir='/run') as candidate:
                        candidate.write(data)
                        candidate.flush()
                        run(['/usr/sbin/visudo', '-cf', candidate.name])
                atomic_new_file(target, data, mode, installed)
            site_lock(spec, installed)
        run(['/usr/sbin/visudo', '-c'])
        run(['/usr/bin/systemd-analyze', 'verify', *['/etc/systemd/system/' + spec['site'] + '.service' for spec in SPECS.values()]], timeout=30)
        run(['/usr/bin/systemctl', 'daemon-reload'])
        fragments = {CADDY_SITES / (spec['site'] + '.caddy'): caddy_fragment(spec) for spec in SPECS.values()}
        caddy_files = caddy_install(fragments)
        require(baseline() == old, 'Milo baseline changed; root investigation required, no automatic Milo modification')
        now = GLOBAL_LOCK.lstat()
        require((now.st_dev, now.st_ino, now.st_uid, now.st_gid, now.st_mode) == (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode), 'Shared build lock metadata changed unexpectedly')
        return {'status': 'bootstrapped_not_deployed', 'hostname': HOST, 'accounts': accounts, 'installedFiles': [str(path) for path, _ in installed], 'caddyFiles': caddy_files, 'miloBaselinePreserved': old, 'runtimeSecretsCreated': False, 'runnersRegistered': False, 'dartflowServicesStarted': False}
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render-staging', type=Path, required=True)
    parser.add_argument('--render-production', type=Path, required=True)
    parser.add_argument('--database-ca', type=Path, required=True, help='Reviewed public 2021+2025 Supabase CA bundle; never a credential')
    parser.add_argument('--staging-manifest-sha256')
    parser.add_argument('--production-manifest-sha256')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    request = read_input(sys.stdin.buffer)
    if args.apply:
        for name in SPECS:
            expected = getattr(args, name + '_manifest_sha256')
            require(isinstance(expected, str) and re.fullmatch('[a-f0-9]{64}', expected), 'Apply requires both externally reviewed render-manifest digests')
            manifest_path = trusted(Path(getattr(args, 'render_' + name)).resolve() / 'manifest.json')
            require(digest(manifest_path.read_bytes()) == expected, 'Reviewed render-manifest digest differs')
    rendered = {name: load_render(getattr(args, 'render_' + name), name, protected=args.apply) for name in SPECS}
    require(args.database_ca.is_file() and digest(args.database_ca.read_bytes()) == DATABASE_CA_SHA256, 'Reviewed Supabase public CA bundle is required')
    if args.apply:
        result = apply(rendered, request, args.database_ca)
    else:
        result = {'status': 'plan_only_no_host_changes', 'expectedHost': HOST, 'hostVerified': False, 'environments': {name: {'site': spec['site'], 'origin': spec['origin'], 'loopback': '127.0.0.1:' + str(spec['port']), 'configId': request[name]['configId'], 'installPaths': sorted(path.replace('/deploy.example.json', '/deploy.json') for path in paths(spec)), 'renderManifestSha256': digest((Path(getattr(args, 'render_' + name)) / 'manifest.json').read_bytes())} for name, spec in SPECS.items()}, 'runtimeValuesAccepted': False, 'databaseCa': {'path': str(DATABASE_CA), 'sha256': DATABASE_CA_SHA256}, 'dartflowServicesStarted': False, 'runnersRegistered': False}
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        # Neither stdin nor provider/runtime data is ever interpolated here.
        print('Dartflow bootstrap refused or incomplete: ' + (str(error) if isinstance(error, Refused) else type(error).__name__) + '. Inspect the fixed host contract; no credential values logged.', file=sys.stderr)
        sys.exit(1)
