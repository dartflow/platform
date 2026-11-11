#!/usr/bin/python3 -I
"""Reviewed bootstrap for the two fixed DartFlow runners; never called by CI.

Run as root on dg-nxttrack-01 with --apply. Stdin is JSON containing exactly
stagingToken and productionToken. Tokens are never command arguments or files.
No account creation, existing registration removal/replacement, or svc.sh runs.
"""
import hashlib
import grp
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

VERSION = '2.338.2'
URL = 'https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz'
SHA256 = 'baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40'
REPOSITORY = 'https://github.com/dartflow/platform'
HOST = 'dg-nxttrack-01'
MAX_ARCHIVE = 512 * 1024**2
MAX_UNPACKED = 2 * 1024**3
MAX_FILES = 50000
MAX_OUTPUT = 2 * 1024**2
SPECS = (
    {'environment': 'staging', 'account': 'run-dart-stg', 'name': 'dg-nxttrack-01-dartflow-staging', 'tokenKey': 'stagingToken', 'unit': 'dartflow-actions-staging.service'},
    {'environment': 'production', 'account': 'run-dart-prd', 'name': 'dg-nxttrack-01-dartflow-production', 'tokenKey': 'productionToken', 'unit': 'dartflow-actions-production.service'},
)
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}


class Refused(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'Duplicate bootstrap input key')
        value[key] = item
    return value


def read_tokens(stream):
    raw = stream.read(16385)
    require(len(raw) <= 16384, 'Bootstrap input exceeds bound')
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError):
        raise Refused('Bootstrap requires bounded token JSON') from None
    require(isinstance(value, dict) and set(value) == {'stagingToken', 'productionToken'}, 'Both fixed runner registration tokens are required')
    require(all(isinstance(token, str) and 8 <= len(token) <= 4096 and all(33 <= ord(c) < 127 for c in token) for token in value.values()), 'Invalid runner registration token format')
    return value


def safe_member_name(value):
    require(isinstance(value, str) and value and '\\' not in value and '\x00' not in value, 'Unsafe runner archive path')
    path = PurePosixPath(value)
    require(not path.is_absolute() and '..' not in path.parts, 'Runner archive path escapes destination')
    return tuple(part for part in path.parts if part != '.')


def validate_archive(stream):
    stream.seek(0)
    entries, links, total = {}, {}, 0
    with tarfile.open(fileobj=stream, mode='r:gz') as archive:
        for member in archive:
            name = safe_member_name(member.name)
            if not name:
                require(member.isdir(), 'Invalid runner archive root')
                continue
            require(name not in entries, 'Duplicate runner archive path')
            require(member.isfile() or member.isdir() or member.issym(), 'Special or hardlinked runner archive member refused')
            require(not member.mode & 0o7000, 'Privileged runner archive mode refused')
            require(len(entries) < MAX_FILES, 'Runner archive has too many entries')
            total += member.size if member.isfile() else 0
            require(0 <= member.size <= MAX_UNPACKED and total <= MAX_UNPACKED, 'Runner archive exceeds extraction budget')
            entries[name] = member.type
            if member.issym():
                target = PurePosixPath(member.linkname)
                require(member.linkname and '\\' not in member.linkname and '\x00' not in member.linkname and not target.is_absolute(), 'Unsafe runner archive link')
                links[name] = target.parts
    for name in entries:
        require(not any(name[:index] in links for index in range(1, len(name))), 'Runner archive writes through a symlink')
    for name, target in links.items():
        pending, resolved, expansions = list(name[:-1] + target), [], 0
        while pending:
            part = pending.pop(0)
            if part == '.':
                continue
            if part == '..':
                require(bool(resolved), 'Runner archive link escapes destination')
                resolved.pop()
                continue
            resolved.append(part)
            if tuple(resolved) in links:
                expansions += 1
                require(expansions <= 100, 'Runner archive link cycle')
                replacement = links[tuple(resolved)]
                resolved.pop()
                pending = list(replacement) + pending
    require(all(entries.get(name) in {tarfile.REGTYPE, tarfile.AREGTYPE} for name in [('config.sh',), ('bin', 'runsvc.sh'), ('bin', 'Runner.Listener')]), 'Runner release archive is incomplete')
    stream.seek(0)
    return {'entries': len(entries), 'unpackedBytes': total}


class FixedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        parsed = urllib.parse.urlsplit(new_url)
        require(parsed.scheme == 'https' and parsed.hostname in {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'} and not parsed.username and not parsed.password and parsed.port in [None, 443], 'Unexpected official runner download redirect')
        return super().redirect_request(request, response, code, message, headers, new_url)


def download(stream):
    deadline, size, digest = time.monotonic() + 600, 0, hashlib.sha256()
    opener = urllib.request.build_opener(FixedRedirect())
    with opener.open(urllib.request.Request(URL, headers={'User-Agent': 'Dartflow-runner-bootstrap-v1'}), timeout=30) as response:
        require(response.status == 200, 'Official runner download unavailable')
        while True:
            require(time.monotonic() <= deadline, 'Official runner download timed out')
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            require(size <= MAX_ARCHIVE, 'Official runner archive exceeds bound')
            digest.update(chunk)
            stream.write(chunk)
    require(size > 0 and digest.hexdigest() == SHA256, 'Official runner SHA256 differs')
    stream.flush()
    stream.seek(0)
    return validate_archive(stream)


def account(spec):
    person = pwd.getpwnam(spec['account'])
    expected_home = Path('/home') / spec['account']
    require(person.pw_uid != 0 and person.pw_gid != 0 and person.pw_dir == str(expected_home), 'Fixed runner account/home differs')
    parent = expected_home.parent.lstat()
    info = expected_home.lstat()
    require(parent.st_uid == 0 and stat.S_ISDIR(parent.st_mode) and not parent.st_mode & 0o022, 'Unsafe runner home parent')
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == person.pw_uid and info.st_gid == person.pw_gid and not info.st_mode & 0o077, 'Runner home must be private and owned by its account')
    build_group = grp.getgrnam('dg-build').gr_gid
    require(set(os.getgrouplist(person.pw_name, person.pw_gid)) == {person.pw_gid, build_group}, 'Runner account has unexpected supplemental groups')
    return person


def runner_directory(person):
    home_fd = os.open(person.pw_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            os.mkdir('actions-runner', 0o700, dir_fd=home_fd)
            created = True
        except FileExistsError:
            created = False
        fd = os.open('actions-runner', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=home_fd)
        info = os.fstat(fd)
        if created:
            os.fchown(fd, person.pw_uid, person.pw_gid)
            info = os.fstat(fd)
        require(info.st_uid == person.pw_uid and info.st_gid == person.pw_gid and not info.st_mode & 0o077, 'Unsafe existing runner directory')
        return Path(person.pw_dir) / 'actions-runner', fd
    finally:
        os.close(home_fd)


def registered_settings(fd, person, spec):
    try:
        source = os.open('.runner', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(source)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == person.pw_uid and info.st_nlink == 1 and info.st_size <= 32768, 'Unsafe existing runner settings')
        body = os.read(source, 32769)
        settings = json.loads(body, object_pairs_hook=unique_object)
    finally:
        os.close(source)
    values = {key.lower(): value for key, value in settings.items()}
    require(len(values) == len(settings) and values.get('agentname') == spec['name'] and values.get('githuburl', '').rstrip('/') == REPOSITORY and values.get('workfolder') == '_work' and values.get('disableupdate') is True and type(values.get('agentid')) is int and values['agentid'] > 0, 'Existing runner belongs to another fixed registration')
    for name in ['.credentials', '.credentials_rsaparams']:
        source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            info = os.fstat(source)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == person.pw_uid and info.st_nlink == 1 and not info.st_mode & 0o077 and 0 < info.st_size <= 65536, 'Unsafe existing runner credentials')
        finally:
            os.close(source)
    try:
        source = os.open('.service', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    except FileNotFoundError:
        source = None
    if source is not None:
        try:
            info = os.fstat(source)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == person.pw_uid and info.st_nlink == 1 and info.st_size <= 1024 and os.read(source, 1025).strip() == spec['unit'].encode(), 'Existing runner service differs; refusing replacement')
        finally:
            os.close(source)
    return values


def as_account(person, command, directory, token=None, stdin=subprocess.DEVNULL, timeout=300, expected_output=None):
    env = {**CLEAN_ENV, 'HOME': person.pw_dir, 'USER': person.pw_name, 'LOGNAME': person.pw_name, 'SHELL': '/bin/bash', 'PATH': '/opt/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin'}
    if token is not None:
        env['ACTIONS_RUNNER_INPUT_TOKEN'] = token
    groups = os.getgrouplist(person.pw_name, person.pw_gid)

    def demote():
        os.setgroups(groups)
        os.setgid(person.pw_gid)
        os.setuid(person.pw_uid)
        os.umask(0o077)

    process, output = None, bytearray()
    try:
        process = subprocess.Popen(command, cwd=directory, env=env, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, preexec_fn=demote, start_new_session=True)
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0, 'Unprivileged runner bootstrap timed out; inspect partial state without replacement')
            readable, _, _ = select.select([process.stdout], [], [], min(remaining, 1))
            if not readable:
                continue
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            output.extend(chunk)
            require(len(output) <= MAX_OUTPUT, 'Unprivileged runner bootstrap output exceeds bound')
        process.wait(timeout=max(0.1, deadline - time.monotonic()))
    except BaseException:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        raise
    finally:
        env.pop('ACTIONS_RUNNER_INPUT_TOKEN', None)
        if process is not None and process.stdout is not None:
            process.stdout.close()
    # Retain no raw config/provider log. Even redacted output is never emitted.
    redacted = bytes(output).replace(token.encode(), b'[REDACTED]') if token else bytes(output)
    summary = {'exitCode': process.returncode, 'outputLines': len(redacted.splitlines())}
    require(process.returncode == 0, 'Unprivileged runner bootstrap failed; existing registration was not removed or replaced')
    require(expected_output is None or bytes(output).strip() == expected_output.encode(), 'Existing runner version differs from the pinned release')
    return summary


EXTRACT = '''import os,stat,sys,tarfile
with tarfile.open(fileobj=sys.stdin.buffer,mode="r:gz") as archive:
    archive.extractall(path=".",filter="data")
source=os.open("bin/runsvc.sh",os.O_RDONLY|os.O_NOFOLLOW)
try:
    assert stat.S_ISREG(os.fstat(source).st_mode)
    destination=os.open("runsvc.sh",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700)
    with os.fdopen(destination,"wb") as target,os.fdopen(source,"rb",closefd=False) as origin:
        while chunk:=origin.read(65536):
            target.write(chunk)
finally:
    os.close(source)
for parent,dirs,files in os.walk(".",followlinks=False):
    for name in dirs+files:
        path=os.path.join(parent,name)
        info=os.lstat(path)
        if not stat.S_ISLNK(info.st_mode):
            os.chmod(path,stat.S_IMODE(info.st_mode)&0o700)
'''


def unit_text(spec, directory):
    user = spec['account']
    return f'''[Unit]
Description=DartFlow {spec['environment']} GitHub Actions runner
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User={user}
Group={user}
WorkingDirectory={directory}
Environment=HOME=/home/{user}
Environment=PATH=/opt/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin
ExecStart={directory}/runsvc.sh
Restart=always
RestartSec=5
KillMode=control-group
TimeoutStopSec=60
UMask=0077
# No NoNewPrivileges: the separate fixed digest-pinned broker requires sudo.
# This unit does not grant any new sudo rule or run runner-owned code as root.

[Install]
WantedBy=multi-user.target
'''


def install_unit(spec, text):
    directory = Path('/etc/systemd/system')
    for component in [*reversed(directory.parents), directory]:
        info = component.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'Unsafe systemd unit directory')
    path = directory / spec['unit']
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    except FileExistsError:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o022 and info.st_size <= 16384 and os.read(fd, 16385) == text.encode(), 'Existing runner unit differs; refusing replacement')
        finally:
            os.close(fd)
        return False
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(text.encode())
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return True


def systemctl(*args):
    result = subprocess.run(['/usr/bin/systemctl', *args], env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90, check=False)
    require(result.returncode == 0, 'Fixed runner service command failed; inspect the named unit locally')
    return result.stdout


def main():
    require(sys.argv[1:] == ['--apply'], 'Use --apply only after source review; tokens arrive on stdin')
    require(os.geteuid() == 0 and socket.gethostname() == HOST and os.uname().machine == 'x86_64', 'Wrong runner bootstrap host, architecture or privilege')
    tokens = read_tokens(sys.stdin.buffer)
    records, prepared = [], []
    try:
        for spec in SPECS:
            person = account(spec)
            directory, fd = runner_directory(person)
            try:
                settings = registered_settings(fd, person, spec)
                if settings is None:
                    require(not os.listdir(fd), 'Unregistered runner directory is not empty; refusing automatic overwrite/repair')
                prepared.append((spec, person, directory, settings))
            finally:
                os.close(fd)
        need_archive = any(settings is None for _, _, _, settings in prepared)
        with tempfile.TemporaryFile() as archive:
            archive_info = download(archive) if need_archive else None
            for spec, person, directory, settings in prepared:
                created = settings is None
                if created:
                    archive.seek(0)
                    as_account(person, ['/usr/bin/python3', '-I', '-c', EXTRACT], directory, stdin=archive, timeout=300)
                    as_account(person, ['/bin/bash', './config.sh', '--unattended', '--url', REPOSITORY, '--name', spec['name'], '--labels', 'dg-nxttrack-01,dartflow,' + spec['environment'], '--work', '_work', '--disableupdate'], directory, token=tokens[spec['tokenKey']])
                # Configuration/settings verification is read-only on repeat runs.
                fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    settings = registered_settings(fd, person, spec)
                    require(settings is not None, 'Runner configuration did not produce its fixed registration')
                finally:
                    os.close(fd)
                as_account(person, ['./bin/Runner.Listener', '--version'], directory, expected_output=VERSION)
                install_unit(spec, unit_text(spec, directory))
                records.append({'environment': spec['environment'], 'runner': spec['name'], 'agentId': settings['agentid'], 'account': person.pw_name, 'uid': person.pw_uid, 'directory': str(directory), 'unit': spec['unit'], 'registeredNow': created})
        systemctl('daemon-reload')
        for record in records:
            systemctl('enable', '--now', record['unit'])
            require(systemctl('is-active', record['unit']).strip() == b'active', 'Runner service is not active')
        print(json.dumps({'status': 'passed', 'repository': REPOSITORY, 'runnerRelease': VERSION, 'archiveSha256': SHA256, 'archive': archive_info, 'runners': records, 'credentialsPrinted': False}, sort_keys=True))
    finally:
        tokens.clear()


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        # No command/provider output, URLs with transient query strings or token values.
        print(json.dumps({'status': 'failed', 'reason': str(error) if isinstance(error, Refused) else 'Runner bootstrap failed; inspect protected local state', 'credentialsPrinted': False}), file=sys.stderr)
        sys.exit(1)
