#!/usr/bin/python3 -I
"""Explicit root-only fail-closed cleanup proof; never run by CI or a runner.

Loads the already reviewed/installed proof and helper without modifying them.
Only this proof run's synthetic Dartflow build unit is killed during recovery.
"""
import argparse
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

PROOF_PATH = Path('/usr/local/libexec/dartflow-probe-lock-lifetime.py')
HOST = 'dg-nxttrack-01'
ENVIRONMENTS = ('staging', 'production')
BLOCKED_STATUS = 'Build or app-job cleanup blocked; deployment locks retained; root recovery required'
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def trusted(path):
    path = Path(path)
    require(path.is_absolute(), 'Proof path must be absolute')
    for component in [*reversed(path.parents), path]:
        item = component.lstat()
        require(item.st_uid == 0 and not item.st_mode & 0o022 and not stat.S_ISLNK(item.st_mode), 'Untrusted root proof path')
    require(path.is_file(), 'Missing root proof file')


def installed_proof():
    trusted(Path(__file__).absolute())
    trusted(PROOF_PATH)
    loader = importlib.machinery.SourceFileLoader('installed_dartflow_lock_proof', str(PROOF_PATH))
    spec = importlib.util.spec_from_file_location(loader.name, PROOF_PATH, loader=loader)
    proof = importlib.util.module_from_spec(spec)
    loader.exec_module(proof)
    return proof


def bounded_build_argv(proof, module, run, work):
    argv = proof.build_argv(module, run, work)
    require(argv.count('--property=ExecStop=/usr/bin/sleep 3') == 1 and argv.count('--property=TimeoutStopSec=10') == 1, 'Installed proof sandbox contract differs')
    return [('--property=ExecStop=/usr/bin/sleep 45' if value == '--property=ExecStop=/usr/bin/sleep 3' else '--property=TimeoutStopSec=60' if value == '--property=TimeoutStopSec=10' else value) for value in argv]


def unit_state(proof, unit):
    result = proof.manager('show', unit, '--all', '--property=ActiveState,SubState,MainPID,ControlPID,StatusText', timeout=3, capture=True)
    require(len(result.stdout) <= 8192, 'Oversized unit state')
    if result.returncode != 0:
        require(result.returncode in [1, 3, 4] and not result.stdout, 'Unreadable unit state')
        return {}
    values = {}
    for line in result.stdout.decode().splitlines():
        key, separator, value = line.partition('=')
        require(separator and key in ['ActiveState', 'SubState', 'MainPID', 'ControlPID', 'StatusText'] and key not in values, 'Untrusted unit state')
        values[key] = value
    require(set(values) == {'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'StatusText'} and values['MainPID'].isdigit() and values['ControlPID'].isdigit(), 'Incomplete unit state')
    return values


def blocked_state(proof, module, build_unit, guard_unit):
    # Always test both OFDs independently; a busy global lock must not mask site loss.
    proof.locks_busy(module)
    guardian = unit_state(proof, guard_unit)
    build = unit_state(proof, build_unit)
    if guardian.get('StatusText') != BLOCKED_STATUS:
        return None
    require(guardian.get('ActiveState') == 'active' and guardian.get('SubState') == 'running', 'Blocked guardian is not running')
    require(build.get('ActiveState') == 'deactivating' and int(build.get('ControlPID', '0')) > 0, 'Synthetic stop did not remain blocked')
    require(proof.job_pending(build_unit), 'Expected synthetic stop job is missing')
    return {'guardianStatusText': guardian['StatusText'], 'guardianState': guardian['ActiveState'] + '/' + guardian['SubState'], 'buildState': build['ActiveState'] + '/' + build['SubState'], 'globalLock': 'busy', 'siteLock': 'busy', 'stopJob': 'pending'}


def stopped(proof, unit):
    state = unit_state(proof, unit)
    return (not state or (state['ActiveState'] in ['inactive', 'failed'] and state['MainPID'] == '0' and state['ControlPID'] == '0')) and not proof.job_pending(unit)


def recover_synthetic(proof, build_unit):
    # Fixed supervisor-derived unit only, never an app service, sibling or Milo.
    result = proof.manager('kill', '--kill-whom=all', '--signal=SIGKILL', build_unit, timeout=5)
    require(result.returncode == 0, 'Root recovery could not kill the synthetic build cgroup')


def scenario(proof, module, policy, environment):
    started = time.monotonic()
    run = str(9100000000000 + os.getpid()) + '-1'
    build_unit = module.BUILD_PREFIX + run + '-build.service'
    guard_unit = module.GUARDIAN_PREFIX + run + '.service'
    require(module.SITE == 'dartflow-' + environment and build_unit.startswith('dg-dartflow-' + environment + '-build-'), 'Wrong fixed proof environment')
    person = pwd.getpwnam(module.BUILDER)
    work = module.BUILD_ROOT / ('blocked-proof-' + run)
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
                guardian = module.start_guardian(descriptors, run, policy)
                require(guardian['unit'] == guard_unit, 'Unexpected guardian scope')
                client = subprocess.Popen(bounded_build_argv(proof, module, run, work), env=CLEAN_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, pass_fds=descriptors)
                child.send(json.dumps({'client': client.pid}).encode())
                child.recv(1)
        except module.LockBusy:
            child.send(b'{"busy":true}')
            os._exit(75)
        except Exception:
            child.send(b'{"error":true}')
            os._exit(1)
        os._exit(0)
    child.close()
    client_pid, client_fd, helper_reaped, passed, observed = None, None, False, False, None
    try:
        require(select.select([parent], [], [], 25)[0], 'Controller readiness timed out')
        message = json.loads(parent.recv(4096))
        require(not message.get('busy'), 'Host build lock is busy; retry proof later')
        require(not message.get('error') and type(message.get('client')) is int, 'Proof controller failed')
        client_pid = message['client']
        client_fd = os.pidfd_open(client_pid, 0)
        proof.until(lambda: (work / 'worker' / 'worker.json').exists(), 'Synthetic builder did not start', seconds=10)
        evidence = proof.worker_evidence(work)
        require(evidence.get('lockDescriptors') == [] and evidence.get('uid') == person.pw_uid, 'Synthetic builder inherited controller locks or wrong identity')
        # Exclude the trusted buildclient as an alternate lock holder.
        os.kill(client_pid, signal.SIGKILL)
        proof.until(lambda: bool(select.select([client_fd], [], [], 0)[0]), 'Trusted client did not die', seconds=3)
        os.kill(process, signal.SIGKILL)
        os.waitpid(process, 0)
        helper_reaped = True
        deadline = time.monotonic() + 26
        while time.monotonic() < deadline:
            observed = blocked_state(proof, module, build_unit, guard_unit)
            if observed:
                break
            time.sleep(0.1)
        require(observed is not None, 'Guardian never reported blocked cleanup before recovery deadline')
        recover_synthetic(proof, build_unit)
        proof.until(lambda: stopped(proof, build_unit), 'Synthetic cgroup did not stop after targeted root recovery', seconds=10)
        proof.until(lambda: stopped(proof, guard_unit), 'Guardian did not finish verified cleanup after root recovery', seconds=12)
        proof.until(lambda: proof.locks_free(module), 'Guardian did not release both lock OFDs after verified cleanup', seconds=5)
        passed = True
        return {'status': 'passed', 'environment': environment, 'run': run, 'unit': build_unit, 'guardian': guard_unit, 'observedBlocked': observed, 'rootRecovery': 'SIGKILL only synthetic build cgroup', 'final': {'build': 'stopped', 'guardian': 'stopped', 'globalLock': 'free', 'siteLock': 'free'}, 'seconds': round(time.monotonic() - started, 3)}
    finally:
        # A 60-second work deadline leaves at most ~50s of bounded root cleanup.
        signal.alarm(0)
        if not helper_reaped:
            try:
                os.kill(process, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(process, 0)
        if client_fd is not None and not select.select([client_fd], [], [], 0)[0]:
            try:
                os.kill(client_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        # Recovery remains narrowly scoped even when the proof fails early.
        if not stopped(proof, build_unit):
            recover_synthetic(proof, build_unit)
            proof.until(lambda: stopped(proof, build_unit), 'Proof cgroup cleanup failed; root recovery needed', seconds=10)
        proof.manager('kill', '--kill-whom=main', '--signal=SIGUSR1', guard_unit, timeout=5)
        proof.until(lambda: stopped(proof, guard_unit), 'Proof guardian retains locks; inspect fixed scope', seconds=12)
        if client_fd is not None:
            os.close(client_fd)
        parent.close()
        fd = os.open(work / 'supervisor.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(json.dumps({'scenario': 'blocked-cleanup-root-recovery', 'status': 'passed' if passed else 'failed', 'observedBlocked': observed}) + '\n')


def interrupted(_number, _frame):
    raise InterruptedError('Root proof interrupted; bounded cleanup required')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', choices=ENVIRONMENTS, required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname() == HOST, 'Proof requires root on fixed host')
    proof = installed_proof()
    module = proof.helper_for(args.environment)
    policy = module.read_policy()
    for signum in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGALRM]:
        signal.signal(signum, interrupted)
    signal.alarm(60)
    try:
        print(json.dumps(scenario(proof, module, policy, args.environment)))
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Dartflow blocked-cleanup proof failed; inspect only its fixed synthetic build/guardian units and nonsecret build-root evidence.', file=sys.stderr)
        sys.exit(1)
