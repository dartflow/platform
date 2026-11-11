#!/usr/bin/python3 -I
"""Reviewed operator upgrade for the two existing Dartflow sites; never a CI entrypoint."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import stat
import subprocess
import tempfile
from datetime import datetime, timezone

SITES = {'staging': ('staging.dartflow.nl', 'dsnqnvbckkqpzadblshu', 4174, 'dg-dartflow-deploy', 'dg-dartflow-deploy-helper'),
         'production': ('dartflow.nl', 'wlrnowuownakqqgjxnbb', 4175, 'dg-dartflow-production-deploy', 'dg-dartflow-production-deploy-helper')}
EXTRACTORS = {'staging': '/usr/local/libexec/dartflow-extract-source.py',
              'production': '/usr/local/libexec/dartflow-production-extract-source.py'}
BACKUPS = Path('/var/backups/dartflow')


def reviewed_install_mode(path):
    # The unprivileged fixed entry reads helper source to verify its pinned hash.
    public_code = {'/usr/local/bin/' + values[3] for values in SITES.values()} | {'/usr/local/libexec/' + values[4] for values in SITES.values()}
    if str(path) in public_code:
        return 0o755
    if str(path) in EXTRACTORS.values():
        # The isolated, unprivileged builder opens this source with Python.
        return 0o755
    if str(path) in {'/etc/sudoers.d/dartflow-' + env for env in SITES}:
        return 0o440
    raise ValueError('Unknown reviewed install path')


def trusted(path, directory=False):
    path = Path(path)
    info = path.lstat()
    if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode) or (directory and not stat.S_ISDIR(info.st_mode)):
        raise ValueError('Untrusted operator path')
    return path


def trusted_render_path(path, directory=False):
    """Reject writable ancestors and symlinks before any reviewed code is read."""
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Reviewed render path must be an absolute protected path')
    current = Path(path.anchor)
    for index, part in enumerate(path.parts[1:]):
        current /= part
        info = current.lstat()
        final = index == len(path.parts) - 2
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('Reviewed render path is not root-owned and protected')
        if not final or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('Reviewed render ancestor is not a directory')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Reviewed render input is not a single regular file')
    return path


def read_reviewed(path, maximum=524288):
    path = trusted_render_path(path)
    before = path.lstat()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino) or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_nlink != 1:
            raise ValueError('Reviewed render input changed or is untrusted')
        with os.fdopen(fd, 'rb') as stream:
            fd = -1
            data = stream.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError('Reviewed render input exceeds its size limit')
        return data
    finally:
        if fd >= 0:
            os.close(fd)


def installed_file_mode(path):
    return stat.S_IMODE(trusted_render_path(path).lstat().st_mode)


def atomic(path, content, mode=0o600):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.v15-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content.encode() if isinstance(content, str) else content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def secret_file(path, encoding='base64'):
    path = Path(path)
    if not path.exists():
        value = base64.b64encode(secrets.token_bytes(32)).decode() if encoding == 'base64' else secrets.token_hex(32)
        atomic(path, value + '\n')
    trusted(path)
    if path.stat().st_mode & 0o077:
        raise ValueError('Secret is not root-only')
    return path.read_text().strip()


def install_mail_tick():
    script = '''#!/usr/bin/python3 -I
import pathlib,sys,urllib.request
sites={'staging':4174,'production':4175}
env=sys.argv[1] if len(sys.argv)==2 else ''
if env not in sites:raise SystemExit(1)
source=pathlib.Path('/srv/sites/dartflow-'+env+'/current/.runtime.env')
values={}
for line in source.read_text().splitlines():
 key,sep,value=line.partition('=')
 if sep:values[key]=value.strip().strip('"')
token=values.get('DARTFLOW_MAIL_WORKER_TOKEN','')
if len(token)!=64:raise SystemExit('Mailworker nog niet geconfigureerd')
req=urllib.request.Request('http://127.0.0.1:'+str(sites[env])+'/api/mail/process',data=b'{}',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
try:
 with urllib.request.urlopen(req,timeout=160) as response:
  response.read(65537)
  if response.status!=200:raise SystemExit(1)
except Exception:raise SystemExit('Mailworker tijdelijk niet beschikbaar')
'''
    atomic('/usr/local/libexec/dartflow-mail-tick.py', script, 0o700)
    for env in SITES:
        unit = f'''[Unit]
Description=Dartflow {env} durable mail dispatch
After=dartflow-{env}.service
[Service]
Type=oneshot
User=root
ExecStart=/usr/bin/python3 -I /usr/local/libexec/dartflow-mail-tick.py {env}
TimeoutStartSec=175
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ProtectProc=invisible
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
IPAddressDeny=any
IPAddressAllow=localhost
CapabilityBoundingSet=
MemoryMax=64M
TasksMax=8
'''
        timer = f'''[Unit]
Description=Dartflow {env} mail dispatch schedule
[Timer]
OnBootSec=60
OnUnitInactiveSec=30
RandomizedDelaySec=3
Unit=dartflow-mail-{env}.service
[Install]
WantedBy=timers.target
'''
        atomic(f'/etc/systemd/system/dartflow-mail-{env}.service', unit, 0o644)
        atomic(f'/etc/systemd/system/dartflow-mail-{env}.timer', timer, 0o644)


def update_extractors(reviewed, apply=False):
    """Directed repair only; caller holds the existing host-wide build lock."""
    changes = []
    for env, (_, ref, port, _, _) in SITES.items():
        extractor_path = EXTRACTORS[env]
        data = reviewed[env][extractor_path]
        policy_path = Path('/etc/dg-sites/dartflow-' + env + '/deploy.json')
        old_source = read_reviewed(extractor_path)
        old_mode = installed_file_mode(extractor_path)
        old_policy = read_reviewed(policy_path, 65536)
        policy = json.loads(old_policy)
        if policy['repository'] != 'dartflow/platform' or policy['backend']['projectRef'] != ref or policy['port'] != port:
            raise ValueError('Existing extractor policy identity differs')
        if policy['extractorSha256'] != hashlib.sha256(old_source).hexdigest():
            raise ValueError('Installed extractor differs from its protected policy')
        digest = hashlib.sha256(data).hexdigest()
        policy_changed = policy['extractorSha256'] != digest
        policy['extractorSha256'] = digest
        changes.append({'environment': env, 'path': extractor_path, 'policyPath': policy_path,
                        'oldSource': old_source, 'oldPolicy': old_policy, 'data': data,
                        'oldMode': old_mode, 'mode': reviewed_install_mode(extractor_path), 'policyChanged': policy_changed,
                        'policy': json.dumps(policy, indent=2) + '\n', 'sha256': digest})
    if len({item['sha256'] for item in changes}) != 1:
        raise ValueError('The two reviewed extractors must have identical source')
    report = {'changesApplied': False, 'environments': {item['environment']: {'extractorSha256': item['sha256'], 'installedMode': format(item['oldMode'], '04o'), 'requiredMode': format(item['mode'], '04o'), 'requiresUpdate': item['oldSource'] != item['data'] or item['oldMode'] != item['mode']} for item in changes}}
    if not apply or not any(item['requiresUpdate'] for item in report['environments'].values()):
        return report
    trusted_render_path(BACKUPS, directory=True)
    backup = BACKUPS / ('v15-extractor-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700)
    for item in changes:
        atomic(backup / (item['environment'] + '-extractor.py'), item['oldSource'])
        atomic(backup / (item['environment'] + '-deploy.json'), item['oldPolicy'])
    try:
        for item in changes:
            atomic(item['path'], item['data'], item['mode'])
            if item['policyChanged']:
                atomic(item['policyPath'], item['policy'])
        for item in changes:
            if hashlib.sha256(read_reviewed(item['path'])).hexdigest() != item['sha256'] or installed_file_mode(item['path']) != item['mode'] or json.loads(read_reviewed(item['policyPath'], 65536))['extractorSha256'] != item['sha256']:
                raise ValueError('Installed extractor repair verification failed')
    except BaseException:
        for item in changes:
            atomic(item['path'], item['oldSource'], item['oldMode'])
            atomic(item['policyPath'], item['oldPolicy'])
        raise
    return {**report, 'changesApplied': True, 'backup': str(backup), 'environments': {
        env: {**item, 'previousInstalledMode': item['installedMode'], 'installedMode': item['requiredMode'], 'requiresUpdate': False}
        for env, item in report['environments'].items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renders', type=Path, required=True, help='Directory with staging/ and production/ reviewed render outputs')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--extractor-only', action='store_true', help='Repair only both reviewed extractors and their policy hashes; preserve all configuration and services')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'dg-nxttrack-01':
        raise ValueError('Only the authorized root operator on dg-nxttrack-01 may run this')
    # One existing host build lock; never replace its inode.
    lock = os.open('/run/lock/dg-build.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        if os.fstat(lock).st_uid != 0:
            raise ValueError('Untrusted shared build lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        reviewed = {}
        trusted_render_path(args.renders, directory=True)
        for env, (host, ref, port, entry, helper) in SITES.items():
            root = args.renders / env
            manifest = json.loads(read_reviewed(root / 'manifest.json', 65536))
            if manifest['environment'] != env or manifest['repository'] != 'dartflow/platform':
                raise ValueError('Wrong reviewed render identity')
            files = [EXTRACTORS[env]] if args.extractor_only else ['/usr/local/libexec/' + helper, '/usr/local/bin/' + entry, '/etc/sudoers.d/dartflow-' + env, EXTRACTORS[env]]
            reviewed[env] = {}
            for name in files:
                data = read_reviewed(root / name.lstrip('/'))
                if hashlib.sha256(data).hexdigest() != manifest['files'][name]['sha256']:
                    raise ValueError('Reviewed render digest differs')
                trusted(name)
                reviewed[env][name] = data
            if not args.extractor_only:
                subprocess.run(['/usr/sbin/visudo', '-cf', str(root / ('etc/sudoers.d/dartflow-' + env))], check=True, stdout=subprocess.DEVNULL)
        if args.extractor_only:
            print(json.dumps(update_extractors(reviewed, args.apply), indent=2))
            return
        if not args.apply:
            print(json.dumps({'validated': True, 'environments': list(SITES), 'changesApplied': False}))
            return
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = Path('/var/backups/dartflow') / ('v15-host-' + stamp)
        backup.mkdir(mode=0o700, parents=True, exist_ok=False)
        os.chmod(backup.parent, 0o700)
        report = {'backup': str(backup), 'environments': {}}
        for env, (host, ref, port, entry, helper) in SITES.items():
            site = 'dartflow-' + env
            base = trusted('/etc/dg-sites/' + site, True)
            policy_path = trusted(base / 'deploy.json')
            policy = json.loads(policy_path.read_text())
            if policy['backend']['projectRef'] != ref or policy['port'] != port:
                raise ValueError('Existing host identity differs')
            old_bundle = trusted(base / 'configs' / (env + '-2026-11-11-v1'), True)
            public = json.loads(trusted(old_bundle / 'public.json').read_text())
            if public['DARTFLOW_APP_ORIGIN'] != 'https://' + host or public['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/') != 'https://' + ref + '.supabase.co':
                raise ValueError('Existing public backend differs')
            config_id = env + '-2026-11-11-v15-1'
            bundle = base / 'configs' / config_id
            if bundle.exists():
                raise ValueError('Immutable v15 bundle already exists; review before a second upgrade')
            turn = trusted(base / 'turn-secret').read_text().strip()
            if len(base64.b64decode(turn, validate=True)) != 32:
                raise ValueError('Invalid environment TURN key')
            values = {'DARTFLOW_ENV': env,
                      'DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY': secret_file(base / 'integrations.key'),
                      'DARTFLOW_MAIL_WORKER_TOKEN': secret_file(base / 'mail-worker.token', 'hex'),
                      'DARTFLOW_MAIL_TEST_RECIPIENTS': 'info@dgwebservices.nl',
                      'DARTFLOW_MAIL_ALLOWED_FROM': 'noreply@dartflow.nl',
                      'DARTFLOW_MAIL_ALLOWED_REPLY_TO': 'support@dartflow.nl',
                      'DARTFLOW_MAIL_MAX_MODE': 'test' if env == 'staging' else 'live',
                      'DARTFLOW_TURN_SECRET': turn,
                      'DARTFLOW_TURN_URLS': ','.join(f'turn:128.140.93.95:{3478 if env == "staging" else 3479}?transport={transport}' for transport in ['udp', 'tcp'])}
            runtime = trusted(old_bundle / 'runtime.env').read_text().rstrip() + '\n' + ''.join(key + '=' + value + '\n' for key, value in values.items())
            reviewed_helper = {'__name__': 'reviewed_v15_helper', '__file__': '/usr/local/libexec/' + helper}
            exec(compile(reviewed[env]['/usr/local/libexec/' + helper], '<reviewed-v15-helper>', 'exec'), reviewed_helper)
            reviewed_helper['runtime_values'](runtime, public)
            bundle.mkdir(mode=0o700)
            atomic(bundle / 'public.json', json.dumps(public, sort_keys=True) + '\n')
            atomic(bundle / 'runtime.env', runtime)
            for name, data in reviewed[env].items():
                destination = backup / name.lstrip('/')
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copyfile(name, destination)
                os.chmod(destination, 0o600)
                atomic(name, data, reviewed_install_mode(name))
            policy_backup = backup / ('deploy-' + env + '.json')
            shutil.copyfile(policy_path, policy_backup)
            os.chmod(policy_backup, 0o600)
            policy['allowedConfigIds'].append(config_id)
            policy['extractorSha256'] = hashlib.sha256(reviewed[env][EXTRACTORS[env]]).hexdigest()
            atomic(policy_path, json.dumps(policy, indent=2) + '\n')
            caddy = trusted('/etc/caddy/sites/' + site + '.caddy')
            original = caddy.read_text()
            shutil.copyfile(caddy, backup / (site + '.caddy'))
            if '@dartflow_mail_worker' not in original:
                amended = original.replace('{', '{\n    @dartflow_mail_worker path /api/mail/process\n    respond @dartflow_mail_worker 404', 1)
                atomic(caddy, amended, 0o644)
            report['environments'][env] = {'configId': config_id, 'runtimeKeys': sorted(values), 'googleManagementToken': 'not_configured'}
        subprocess.run(['/usr/bin/caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['/usr/bin/systemctl', 'reload', 'caddy'], check=True)
        install_mail_tick()
        subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
        subprocess.run(['/usr/sbin/visudo', '-c'], check=True, stdout=subprocess.DEVNULL)
        # Timers start only after the corresponding v15 app is verified.
        print(json.dumps(report, indent=2))
    finally:
        os.close(lock)


if __name__ == '__main__':
    main()
