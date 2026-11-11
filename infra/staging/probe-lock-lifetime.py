#!/usr/bin/python3 -I
"""Explicit root-only host acceptance; never invoked by deploy or a runner."""
import argparse
import fcntl
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import pwd
import select
import signal
import socket
import stat
import subprocess
import sys
import time

CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
TARGETS = {
    'staging': ('dartflow-staging', 'build-dart-stg', '/usr/local/libexec/dg-dartflow-deploy-helper'),
    'production': ('dartflow-production', 'build-dart-prd', '/usr/local/libexec/dg-dartflow-production-deploy-helper'),
}
SELF = Path(__file__).resolve()


def require(value, message):
    if not value:
        raise ValueError(message)


def trusted(path):
    path = Path(path)
    for component in [*reversed(path.parents), path]:
        item = component.lstat()
        require(item.st_uid == 0 and not item.st_mode & 0o022 and not stat.S_ISLNK(item.st_mode), 'Unsafe installed proof/helper path')
    require(path.is_file(), 'Missing installed proof/helper')


def helper_for(environment):
    path = TARGETS[environment][2]
    trusted(path)
    loader = importlib.machinery.SourceFileLoader('fixed_dartflow_helper', path)
    spec = importlib.util.spec_from_file_location(loader.name, path, loader=loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def manager(*args, timeout=12, capture=False):
    return subprocess.run(['/usr/bin/systemctl', *args], env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, check=False)


def until(test, message, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if test():
            return
        time.sleep(0.05)
    raise ValueError(message)


def busy(path):
    fd = os.open(path, os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        return False
    finally:
        os.close(fd)


def locks_busy(module):
    # Probe each independently: failure on global must never mask a lost site OFD.
    require(busy(module.GLOBAL_LOCK), 'Global lock was released before cleanup')
    require(busy(module.SITE_LOCK), 'Site lock was released before cleanup')


def locks_free(module):
    return not busy(module.GLOBAL_LOCK) and not busy(module.SITE_LOCK)


def inactive(unit):
    return manager('is-active', '--quiet', unit, timeout=3).returncode in [3, 4]


def job_pending(unit):
    result = manager('list-jobs', '--no-legend', '--no-pager', '--full', timeout=3, capture=True)
    require(result.returncode == 0 and len(result.stdout) < 65536, 'Cannot read bounded systemd job list')
    for line in result.stdout.decode().splitlines():
        fields = line.split()
        require(len(fields) >= 4 and fields[0].isdigit(), 'Untrusted systemd job list')
        if fields[1] == unit:
            return True
    return False


def control_file(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644)
    os.close(fd)


def worker_evidence(work):
    fd = os.open(work / 'worker' / 'worker.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        item = os.fstat(fd)
        require(stat.S_ISREG(item.st_mode) and item.st_nlink == 1 and item.st_size <= 4096, 'Unsafe worker evidence')
        return json.loads(os.read(fd, 4097))
    finally:
        os.close(fd)


def worker(work, environment):
    """Unprivileged trusted worker; inspect its real descriptor table, no secrets."""
    site, builder, _ = TARGETS[environment]
    require(os.geteuid() == pwd.getpwnam(builder).pw_uid and os.geteuid() != 0, 'Wrong proof worker account')
    locks = [Path('/run/lock/dg-build.lock'), Path('/run/lock/' + site + '.deploy.lock')]
    identities = {(path.stat().st_dev, path.stat().st_ino) for path in locks}
    leaked = []
    for name in os.listdir('/proc/self/fd'):
        try:
            item = os.fstat(int(name))
            if (item.st_dev, item.st_ino) in identities:
                leaked.append(int(name))
        except OSError:
            pass
    record = {'uid': os.geteuid(), 'lockDescriptors': leaked, 'pid': os.getpid()}
    fd = os.open(work / 'worker' / 'worker.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(record))
    require(not leaked, 'Lock descriptors reached unprivileged service')
    until(lambda: (work / 'permit-worker').exists(), 'Proof worker timed out', seconds=45)


def build_argv(module, run, work):
    unit = module.BUILD_PREFIX + run + '-build.service'
    return ['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe', '--service-type=exec', '--unit=' + unit, '--uid=' + module.BUILDER, '--gid=' + module.BUILDER,
            '--property=RuntimeMaxSec=50', '--property=TimeoutStopSec=10', '--property=ExecStop=/usr/bin/sleep 3', '--property=KillMode=control-group', '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes', '--property=PrivateTmp=yes', '--property=ReadWritePaths=' + str(work),
            '/usr/bin/python3', '-I', str(SELF), '--worker', module.SITE.removeprefix('dartflow-'), str(work)]


def client(environment, run, work, kind):
    require(os.geteuid() == 0, 'Proof client must be root')
    module = helper_for(environment)
    until(lambda: (work / 'permit-client').exists(), 'Delayed proof client timed out', seconds=45)
    if kind == 'app-client':
        argv = ['/usr/bin/systemctl', 'restart', module.SITE + '-fd-proof-' + run + '.service']
    else:
        argv = build_argv(module, run, work)
    # Extra lock FDs must survive this real exec AND the actual systemd client.
    os.execve(argv[0], argv, CLEAN_ENV)


def scenario(module, policy, environment, kind, run):
    work = module.BUILD_ROOT / ('fd-proof-' + run)
    person = pwd.getpwnam(module.BUILDER)
    work.mkdir(mode=0o750)
    os.chown(work, 0, person.pw_gid)
    (work / 'worker').mkdir(mode=0o700)
    os.chown(work / 'worker', person.pw_uid, person.pw_gid)
    parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET | socket.SOCK_CLOEXEC)
    process = os.fork()
    if process == 0:
        parent.close()
        try:
            with module.deployment_locks() as descriptors:
                module.BUILD_LOCK_FDS = descriptors
                guard = module.start_guardian(descriptors, run, policy)
                if kind == 'app-client':
                    # A dedicated probe service: never restart the real app or Milo.
                    unit = module.SITE + '-fd-proof-' + run + '.service'
                    args = build_argv(module, run, work)
                    args = [arg for arg in args if arg not in ['--wait', '--pipe']]
                    args = [('--unit=' + unit) if arg.startswith('--unit=') else arg for arg in args]
                    subprocess.run(args, env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12, check=True)
                    until(lambda: (work / 'worker' / 'worker.json').exists(), 'Initial probe service did not start')
                    (work / 'worker' / 'worker.json').unlink()
                if kind == 'guardian':
                    args = build_argv(module, run, work)
                else:
                    args = ['/usr/bin/python3', '-I', str(SELF), '--client', environment, run, str(work), kind]
                launch = subprocess.Popen(args, env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, pass_fds=descriptors)
                child.send(json.dumps({'client': launch.pid, 'guardian': guard['unit']}).encode())
                child.recv(1)  # Supervisor deliberately SIGKILLs this root helper.
        except module.LockBusy:
            child.send(b'{"busy":true}')
            os._exit(75)
        except Exception:
            child.send(b'{"error":true}')
            os._exit(1)
        os._exit(0)
    child.close()
    client_pid, client_fd, guard_unit = None, None, None
    helper_reaped = False
    passed = False
    build_unit = module.BUILD_PREFIX + run + '-build.service'
    app_unit = module.SITE + '-fd-proof-' + run + '.service'
    try:
        require(select.select([parent], [], [], 25)[0], 'Controller readiness timed out')
        message = json.loads(parent.recv(4096))
        require(not message.get('busy'), 'Host build lock is busy; retry proof later')
        require(not message.get('error') and type(message.get('client')) is int, 'Proof controller failed')
        client_pid, guard_unit = message['client'], message['guardian']
        client_fd = os.pidfd_open(client_pid, 0)
        if kind == 'guardian':
            until(lambda: (work / 'worker' / 'worker.json').exists(), 'Real systemd build did not start')
            require(worker_evidence(work)['lockDescriptors'] == [], 'Builder inherited controller locks')
            # Eliminate the trusted client holder: only guardian can retain OFDs.
            os.kill(client_pid, signal.SIGKILL)
            until(lambda: bool(select.select([client_fd], [], [], 0)[0]), 'Client did not die')
        os.kill(process, signal.SIGKILL)
        os.waitpid(process, 0)
        helper_reaped = True
        locks_busy(module)
        if kind == 'guardian':
            until(lambda: inactive(build_unit) and inactive(guard_unit), 'Guardian failed to stop build/drain jobs')
        else:
            until(lambda: inactive(guard_unit), 'Guardian failed to drain initially empty scope')
            locks_busy(module)
            control_file(work / 'permit-client')
            if kind == 'app-client':
                until(lambda: job_pending(app_unit), 'Real synchronous app-client job was not observed', seconds=5)
                locks_busy(module)
            until(lambda: (work / 'worker' / 'worker.json').exists(), 'Delayed real client failed to start its service')
            require(worker_evidence(work)['lockDescriptors'] == [], 'Unprivileged service inherited controller locks')
            if kind == 'build-client':
                locks_busy(module)
                control_file(work / 'permit-worker')
            until(lambda: bool(select.select([client_fd], [], [], 0)[0]), 'Actual trusted client did not finish')
        until(lambda: locks_free(module), 'Both lock OFDs were not released after confirmed cleanup')
        passed = True
        return {'scenario': kind, 'status': 'passed', 'unit': app_unit if kind == 'app-client' else build_unit, 'bothLocks': 'verified', 'workerLockDescriptors': []}
    finally:
        if not helper_reaped:
            try:
                os.kill(process, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(process, 0)
        if client_pid is not None and client_fd is not None and not select.select([client_fd], [], [], 0)[0]:
            try:
                os.kill(client_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        # Only this run's Dartflow proof units; bounded stop/status, no Milo/app action.
        for unit in [build_unit, app_unit]:
            manager('stop', unit)
            require(inactive(unit), 'Proof unit cleanup failed; retain evidence for root recovery')
        if guard_unit:
            manager('kill', '--kill-whom=main', '--signal=SIGUSR1', guard_unit, timeout=5)
            until(lambda: inactive(guard_unit), 'Proof guardian retains locks; root recovery needed')
        if client_fd is not None:
            os.close(client_fd)
        parent.close()
        # Leave bounded nonsecret evidence in the dedicated build root for review.
        fd = os.open(work / 'supervisor.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(json.dumps({'scenario': kind, 'status': 'passed' if passed else 'failed'}) + '\n')


def main():
    if len(sys.argv) == 4 and sys.argv[1] == '--worker' and sys.argv[2] in TARGETS:
        worker(Path(sys.argv[3]), sys.argv[2])
        return
    if len(sys.argv) == 6 and sys.argv[1] == '--client' and sys.argv[2] in TARGETS and sys.argv[5] in ['build-client', 'app-client']:
        client(sys.argv[2], sys.argv[3], Path(sys.argv[4]), sys.argv[5])
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True, choices=tuple(TARGETS))
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname() == 'dg-nxttrack-01', 'Proof requires root on fixed host')
    trusted(SELF)
    module = helper_for(args.environment)
    policy = module.read_policy()
    # Version evidence matters: inherited-FD behavior was reviewed for v255.
    version = subprocess.run(['/usr/bin/systemctl', '--version'], env=CLEAN_ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, check=True).stdout.decode().splitlines()[0]
    require(version.startswith('systemd 255 ' ) or version == 'systemd 255', 'Unreviewed systemd version; review client FD preservation first')
    results = []
    for attempt, kind in enumerate(['guardian', 'build-client', 'app-client'], 1):
        run = str(9000000000000 + os.getpid()) + '-' + str(attempt)
        results.append(scenario(module, policy, args.environment, kind, run))
    print(json.dumps({'status': 'passed', 'environment': args.environment, 'systemd': version, 'results': results}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Paths/config/credentials are never printed; work directories retain only proof metadata.
        print('Dartflow lock proof failed; inspect fixed proof units and nonsecret build-root evidence.', file=sys.stderr)
        sys.exit(1)
