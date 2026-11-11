#!/usr/bin/python3
"""Offline proof-contract tests. No host, systemd, provider or secret access."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('blocked_cleanup_probe', ROOT / 'infra/staging/probe-blocked-cleanup.py')
blocked = importlib.util.module_from_spec(spec)
spec.loader.exec_module(blocked)


def encoded(**changes):
    values = {'ActiveState': 'active', 'SubState': 'running', 'MainPID': '10', 'ControlPID': '0', 'StatusText': ''}
    values.update(changes)
    return '\n'.join(key + '=' + value for key, value in values.items()).encode() + b'\n'


class BlockedCleanupContract(unittest.TestCase):
    def test_only_two_fixed_environment_and_installed_proof_paths_exist(self):
        self.assertEqual(blocked.ENVIRONMENTS, ('staging', 'production'))
        self.assertEqual(str(blocked.PROOF_PATH), '/usr/local/libexec/dartflow-probe-lock-lifetime.py')
        self.assertEqual(blocked.HOST, 'dg-nxttrack-01')

    def test_only_stop_delay_and_timeout_are_changed_in_installed_sandbox(self):
        module = SimpleNamespace(SITE='dartflow-production')
        args = ['/usr/bin/systemd-run', '--wait', '--uid=build-dart-prd', '--unit=dg-dartflow-production-build-1-1-build.service', '--property=ExecStop=/usr/bin/sleep 3', '--property=TimeoutStopSec=10', '/usr/bin/python3', '-I', '/usr/local/libexec/dartflow-probe-lock-lifetime.py', '--worker', 'production', '/synthetic/work']
        proof = SimpleNamespace(build_argv=lambda *args_: args)
        changed = blocked.bounded_build_argv(proof, module, '1-1', Path('/synthetic/work'))
        self.assertEqual([pair for pair in zip(args, changed) if pair[0] != pair[1]], [('--property=ExecStop=/usr/bin/sleep 3', '--property=ExecStop=/usr/bin/sleep 45'), ('--property=TimeoutStopSec=10', '--property=TimeoutStopSec=60')])
        proof.build_argv = lambda *args_: args + ['--property=ExecStop=/usr/bin/sleep 3']
        with self.assertRaises(ValueError):
            blocked.bounded_build_argv(proof, module, '1-1', Path('/synthetic/work'))

    def test_state_reader_forces_empty_fields_and_rejects_untrusted_output(self):
        seen = []
        def manager(*args, **kwargs):
            seen.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout=encoded())
        self.assertEqual(blocked.unit_state(SimpleNamespace(manager=manager), 'synthetic.service')['StatusText'], '')
        self.assertIn('--all', seen[0][0])
        self.assertEqual(seen[0][1]['timeout'], 3)
        for data in [b'x' * 8193, b'ActiveState=active\n', encoded() + b'MainPID=11\n', encoded(MainPID='not-a-pid'), encoded() + b'Unexpected=ignored\n']:
            proof = SimpleNamespace(manager=lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=data))
            with self.subTest(data=data[:30]), self.assertRaises(ValueError):
                blocked.unit_state(proof, 'synthetic.service')

    def test_blocked_evidence_requires_status_deactivating_job_and_each_lock(self):
        calls = []
        proof = SimpleNamespace(locks_busy=lambda module: calls.append('both'), job_pending=lambda unit: unit == 'build.service')
        states = {'guard.service': {'ActiveState': 'active', 'SubState': 'running', 'StatusText': blocked.BLOCKED_STATUS}, 'build.service': {'ActiveState': 'deactivating', 'SubState': 'stop', 'ControlPID': '123'}}
        with patch.object(blocked, 'unit_state', side_effect=lambda proof, unit: states[unit]):
            evidence = blocked.blocked_state(proof, object(), 'build.service', 'guard.service')
            self.assertEqual(evidence['globalLock'], 'busy')
            self.assertEqual(evidence['siteLock'], 'busy')
            self.assertEqual(calls, ['both'])
            states['guard.service']['StatusText'] = 'initializing'
            self.assertIsNone(blocked.blocked_state(proof, object(), 'build.service', 'guard.service'))
            states['guard.service']['StatusText'] = blocked.BLOCKED_STATUS
            states['build.service']['ControlPID'] = '0'
            with self.assertRaises(ValueError):
                blocked.blocked_state(proof, object(), 'build.service', 'guard.service')
            states['build.service']['ControlPID'] = '123'
            proof.job_pending = lambda unit: False
            with self.assertRaises(ValueError):
                blocked.blocked_state(proof, object(), 'build.service', 'guard.service')
            proof.locks_busy = lambda module: (_ for _ in ()).throw(ValueError('site OFD was lost'))
            with self.assertRaisesRegex(ValueError, 'site OFD'):
                blocked.blocked_state(proof, object(), 'build.service', 'guard.service')

    def test_recovery_kills_only_selected_synthetic_unit_cgroup(self):
        calls = []
        proof = SimpleNamespace(manager=lambda *args, **kwargs: (calls.append((args, kwargs)) or SimpleNamespace(returncode=0)))
        unit = 'dg-dartflow-production-build-9100000000001-1-build.service'
        blocked.recover_synthetic(proof, unit)
        self.assertEqual(calls, [(('kill', '--kill-whom=all', '--signal=SIGKILL', unit), {'timeout': 5})])
        proof.manager = lambda *args, **kwargs: SimpleNamespace(returncode=1)
        with self.assertRaises(ValueError):
            blocked.recover_synthetic(proof, unit)

    def test_release_requires_no_pids_no_job_and_stopped_state(self):
        proof = SimpleNamespace(job_pending=lambda unit: False)
        state = {'ActiveState': 'inactive', 'MainPID': '0', 'ControlPID': '0'}
        with patch.object(blocked, 'unit_state', return_value=state):
            self.assertTrue(blocked.stopped(proof, 'synthetic.service'))
            for changes in [{'ControlPID': '123'}, {'MainPID': '123'}, {'ActiveState': 'deactivating'}]:
                with patch.object(blocked, 'unit_state', return_value={**state, **changes}):
                    self.assertFalse(blocked.stopped(proof, 'synthetic.service'))
            proof.job_pending = lambda unit: True
            self.assertFalse(blocked.stopped(proof, 'synthetic.service'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
