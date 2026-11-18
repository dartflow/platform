#!/usr/bin/python3 -I
"""Materialize only privacy worker code/dependencies for an unprivileged worker.

No application code is executed, and no application environment/configuration is
read. Install this reviewed helper root-owned; invoke with an explicit environment.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import sys

HOST = 'dg-nxttrack-01'
ENVIRONMENTS = ('staging', 'production')
SITES_ROOT = Path('/srv/sites')
CODE_ROOT = Path('/var/lib/dg-privacy-code')
OWNER_UID = 0
RELEASE_RE = r'[a-f0-9]{12}-[1-9][0-9]{0,19}-[1-9][0-9]{0,9}'
WORKER = 'account-removal-worker.mjs'
MANIFEST = '.privacy-code.json'
MAX_ENTRIES = 50000
MAX_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_DEPTH = 40


def require(condition, message='Unsafe privacy code release'):
    if not condition:
        raise RuntimeError(message)


def protected_info(path, *, directory=False, regular=False):
    info = Path(path).lstat()
    require(info.st_uid == OWNER_UID and not info.st_mode & 0o022)
    if directory:
        require(stat.S_ISDIR(info.st_mode))
    if regular:
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
    return info


def protected_ancestors(path):
    path = Path(path).absolute()
    for parent in reversed((path, *path.parents)):
        protected_info(parent, directory=True)


def public_directory(path):
    path = Path(path)
    protected_ancestors(path.parent)
    if not path.is_symlink() and not path.exists():
        path.mkdir(mode=0o755)
    info = protected_info(path, directory=True)
    # CODE_ROOT is read-only inside the unit; a correctly provisioned parent
    # must need no mkdir/chmod syscall on each privileged preparation.
    if stat.S_IMODE(info.st_mode) != 0o755:
        path.chmod(0o755)


def forbidden(path):
    return any(part in ('', '.', '..') or any(ord(c) < 32 for c in part) or part == '.env' or part.startswith('.env.') or part.endswith('.env') for part in Path(path).parts)


def source_release(environment):
    require(environment in ENVIRONMENTS)
    site = SITES_ROOT / ('dartflow-' + environment)
    protected_ancestors(site / 'releases')
    current = site / 'current'
    info = current.lstat()
    require(stat.S_ISLNK(info.st_mode) and info.st_uid == OWNER_UID)
    target = os.readlink(current)
    require(re.fullmatch('releases/' + RELEASE_RE, target) is not None)
    release = site / target
    protected_info(release, directory=True)
    protected_info(release / 'node_modules', directory=True)
    protected_info(release / WORKER, regular=True)
    return release


def inventory(release):
    """Inspect exactly two source roots. Never enumerate the release root itself."""
    modules = release / 'node_modules'
    entries = []
    size = 0

    def visit(path, relative, depth):
        nonlocal size
        require(depth <= MAX_DEPTH and not forbidden(relative))
        info = path.lstat()
        require(info.st_uid == OWNER_UID)
        if stat.S_ISLNK(info.st_mode):
            target = os.readlink(path)
            require(not os.path.isabs(target) and not any(ord(c) < 32 for c in target))
            resolved = path.resolve(strict=True)
            require(resolved.is_relative_to(modules) and not forbidden(resolved.relative_to(release)))
            entries.append({'path': str(relative), 'kind': 'link', 'target': target})
        elif stat.S_ISDIR(info.st_mode):
            require(not info.st_mode & 0o022)
            entries.append({'path': str(relative), 'kind': 'directory'})
            for child in sorted(path.iterdir(), key=lambda item: item.name):
                visit(child, relative / child.name, depth + 1)
        else:
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o022 and 0 <= info.st_size <= MAX_FILE_BYTES)
            size += info.st_size
            require(size <= MAX_BYTES)
            entries.append({'path': str(relative), 'kind': 'file', 'bytes': info.st_size,
                            'sourceIdentity': [info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns]})
        require(len(entries) <= MAX_ENTRIES)

    visit(release / WORKER, Path(WORKER), 0)
    visit(modules, Path('node_modules'), 0)
    require(entries[0]['kind'] == 'file' and entries[0]['bytes'] > 0)
    return entries


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def copy_regular(source, destination, expected_bytes):
    before = protected_info(source, regular=True)
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    digest = hashlib.sha256()
    count = 0
    try:
        opened = os.fstat(source_fd)
        require((opened.st_dev, opened.st_ino, opened.st_size) == (before.st_dev, before.st_ino, expected_bytes))
        target_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644)
        with os.fdopen(target_fd, 'wb') as target:
            while True:
                value = os.read(source_fd, 1024 * 1024)
                if not value:
                    break
                count += len(value)
                require(count <= expected_bytes)
                digest.update(value)
                target.write(value)
            require(count == expected_bytes)
            after = os.fstat(source_fd)
            require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
            target.flush()
            os.fchmod(target.fileno(), 0o644)
            os.fsync(target.fileno())
    finally:
        os.close(source_fd)
    return digest.hexdigest()


def read_json(path):
    before = protected_info(path, regular=True)
    require(before.st_size <= MAX_MANIFEST_BYTES)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino) == (info.st_dev, info.st_ino))
        value = stream.read(MAX_MANIFEST_BYTES + 1)
    require(len(value) <= MAX_MANIFEST_BYTES)
    return json.loads(value)


def manifest_bytes(environment, release, entries):
    value = json.dumps({'format': 1, 'environment': environment, 'release': release.name, 'entries': entries}, sort_keys=True, separators=(',', ':')).encode()
    require(len(value) <= MAX_MANIFEST_BYTES)
    return value


def verify_generation(generation, environment, release, expected):
    protected_info(generation, directory=True)
    require(stat.S_IMODE(generation.stat().st_mode) == 0o755)
    manifest = read_json(generation / MANIFEST)
    require(isinstance(manifest, dict) and manifest.get('format') == 1 and manifest.get('environment') == environment and manifest.get('release') == release.name)
    stored = manifest.get('entries')
    require(isinstance(stored, list) and len(stored) == len(expected))
    for entry, source in zip(stored, expected):
        require(isinstance(entry, dict) and {key: value for key, value in entry.items() if key != 'sha256'} == source)
        target = generation / entry['path']
        info = target.lstat()
        require(info.st_uid == OWNER_UID)
        if entry['kind'] == 'file':
            protected_info(target, regular=True)
            require(stat.S_IMODE(info.st_mode) == 0o644 and info.st_size == entry['bytes'])
            fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            with os.fdopen(fd, 'rb') as stream:
                require(hashlib.file_digest(stream, 'sha256').hexdigest() == entry.get('sha256'))
        elif entry['kind'] == 'directory':
            require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o755)
        else:
            require(stat.S_ISLNK(info.st_mode) and os.readlink(target) == entry['target'] and target.resolve(strict=True).is_relative_to(generation / 'node_modules'))
    # Unexpected files, including a secret copied by an earlier unsafe helper,
    # make the generation unusable. Do not silently expose or remove them.
    present = set()
    allowed = {entry['path'] for entry in stored} | {MANIFEST}
    for parent, directories, files in os.walk(generation, followlinks=False):
        for name in directories + files:
            relative = str((Path(parent) / name).relative_to(generation))
            require(relative in allowed)
            present.add(relative)
    require(present == allowed)


def publish_current(directory, generation):
    current = directory / 'current'
    if current.is_symlink() or current.exists():
        info = current.lstat()
        require(stat.S_ISLNK(info.st_mode) and info.st_uid == OWNER_UID and re.fullmatch(RELEASE_RE, os.readlink(current)) is not None)
        if os.readlink(current) == generation.name:
            return
    temporary = directory / ('.current-' + secrets.token_hex(12))
    try:
        temporary.symlink_to(generation.name)
        os.replace(temporary, current)
        sync_directory(directory)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def materialize(environment):
    release = source_release(environment)
    expected = inventory(release)
    public_directory(CODE_ROOT)
    directory = CODE_ROOT / environment
    public_directory(directory)
    lock = directory / '.materialize.lock'
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        lock_info = os.fstat(fd)
        require(lock_info.st_uid == OWNER_UID and stat.S_ISREG(lock_info.st_mode) and lock_info.st_nlink == 1 and not lock_info.st_mode & 0o077)
        fcntl.flock(fd, fcntl.LOCK_EX)
        generation = directory / release.name
        reused = generation.is_symlink() or generation.exists()
        if reused:
            verify_generation(generation, environment, release, expected)
        else:
            pending = directory / ('.pending-' + release.name + '-' + secrets.token_hex(12))
            pending.mkdir(mode=0o700)
            try:
                completed = []
                for entry in expected:
                    target = pending / entry['path']
                    if entry['kind'] == 'directory':
                        target.mkdir(mode=0o755)
                        target.chmod(0o755)
                    elif entry['kind'] == 'link':
                        target.symlink_to(entry['target'])
                    else:
                        entry = {**entry, 'sha256': copy_regular(release / entry['path'], target, entry['bytes'])}
                    completed.append(entry)
                manifest = pending / MANIFEST
                with manifest.open('xb') as stream:
                    stream.write(manifest_bytes(environment, release, completed));stream.flush();os.fchmod(stream.fileno(), 0o644);os.fsync(stream.fileno())
                for item in reversed(completed):
                    if item['kind'] == 'directory':
                        sync_directory(pending / item['path'])
                pending.chmod(0o755)
                sync_directory(pending)
                os.rename(pending, generation)
                sync_directory(directory)
            finally:
                if pending.exists():
                    shutil.rmtree(pending)
        require(source_release(environment) == release, 'Application release changed during privacy preparation; retry')
        publish_current(directory, generation)
        return {'environment': environment, 'release': release.name, 'reused': reused, 'files': sum(entry['kind'] == 'file' for entry in expected), 'credentialsRead': False, 'appCodeExecuted': False}
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('environment', choices=ENVIRONMENTS)
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname() == HOST, 'Run as root on the fixed DartFlow target host')
    os.umask(0o077)
    print(json.dumps(materialize(args.environment)))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'failed', 'message': 'Privacy code preparation failed. No environment values or application payloads were read or logged.'}))
        sys.exit(1)
