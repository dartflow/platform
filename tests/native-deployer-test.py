#!/usr/bin/python3
"""Offline real-filesystem/lock/transaction tests; no sudo, systemd or providers run."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

deploy = load('dartflow_helper', 'infra/staging/deploy-helper.py')
entry = load('dartflow_entry', 'infra/staging/deploy-entry.py')
extractor = load('dartflow_extract', 'infra/staging/extract-source.py')
SHA, OLD_SHA = 'a' * 40, 'b' * 40
RUN, OLD_RUN = '10101-1', '20202-1'
NAME, OLD_NAME = SHA[:12] + '-' + RUN, OLD_SHA[:12] + '-' + OLD_RUN
CONFIG, OLD_CONFIG = 'staging-test-1', 'staging-test-previous'
REF = 'abcdefghijklmnopqrst'
TOKEN = 'synthetic-not-a-real-github-token'


def public():
    return {'DARTFLOW_APP_ORIGIN': 'https://staging.dartflow.nl', 'DARTFLOW_DATA_MODE': 'supabase', 'NEXT_PUBLIC_SUPABASE_URL': f'https://{REF}.supabase.co', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_synthetic_fixture'}


def archive(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as output:
        top = tarfile.TarInfo('synthetic-root')
        top.type = tarfile.DIRTYPE
        output.addfile(top)
        for name, kind, value in entries:
            item = tarfile.TarInfo(name)
            if kind == 'file':
                data = value.encode()
                item.size = len(data)
                output.addfile(item, io.BytesIO(data))
            else:
                item.type = {'directory': tarfile.DIRTYPE, 'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE, 'fifo': tarfile.FIFOTYPE}[kind]
                item.linkname = value
                output.addfile(item)
    stream.seek(0)
    return stream


class NativeBoundaries(unittest.TestCase):
    def test_arguments_are_fixed_and_config_limit_matches_workflow(self):
        self.assertEqual(deploy.arguments(['deploy', SHA, RUN, CONFIG]), ('deploy', SHA, RUN, CONFIG))
        self.assertEqual(entry.arguments(['rollback', NAME]), ['rollback', NAME])
        self.assertEqual(deploy.arguments(['deploy', SHA, RUN, 'x' * 96])[-1], 'x' * 96)
        for args in [[], ['shell', 'id'], ['deploy', SHA.upper(), RUN, CONFIG], ['deploy', SHA, '1;reboot', CONFIG], ['deploy', SHA, RUN, '../cfg'], ['deploy', SHA, RUN, 'x' * 97], ['rollback', '../release'], ['rollback', NAME, 'extra']]:
            for module in [deploy, entry]:
                with self.subTest(args=args, module=module.__name__), self.assertRaises(ValueError):
                    module.arguments(args)

    def test_unique_bounded_credential_input_and_no_rollback_token(self):
        self.assertEqual(deploy.request_body(io.BytesIO(json.dumps({'githubToken': TOKEN}).encode()), 'deploy'), {'githubToken': TOKEN})
        for body, operation in [(b'{"githubToken":"one","githubToken":"two"}', 'deploy'), (b'x' * 8193, 'deploy'), (json.dumps({'githubToken': TOKEN + '\nextra'}).encode(), 'deploy'), (json.dumps({'githubToken': TOKEN}).encode(), 'rollback')]:
            with self.assertRaises(ValueError):
                deploy.request_body(io.BytesIO(body), operation)

    def test_entry_uses_secret_stdin_and_only_fixed_environment(self):
        result = SimpleNamespace(returncode=75)
        person = SimpleNamespace(pw_uid=12345)
        fake_stdin = SimpleNamespace(buffer=io.BytesIO(json.dumps({'githubToken': TOKEN}).encode()))
        with patch.object(entry.socket, 'gethostname', return_value=entry.HOST), patch.object(entry.os, 'getuid', return_value=12345), patch.object(entry.pwd, 'getpwnam', return_value=person), patch.object(entry, 'trusted_helper'), patch.object(entry.sys, 'argv', ['entry', 'deploy', SHA, RUN, CONFIG]), patch.object(entry.sys, 'stdin', fake_stdin), patch.object(entry.subprocess, 'run', return_value=result) as run, patch.dict(os.environ, {'GITHUB_TOKEN': TOKEN, 'DARTFLOW_DATABASE_URL': 'synthetic-private-db'}):
            self.assertEqual(entry.main(), 75)
        args, options = run.call_args
        self.assertEqual(args[0], ['/usr/bin/sudo', '-n', str(entry.HELPER), 'deploy', SHA, RUN, CONFIG])
        self.assertNotIn(TOKEN, str(args))
        self.assertEqual(json.loads(options['input']), {'githubToken': TOKEN})
        self.assertEqual(options['env'], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})

    def test_uninstalled_helper_refuses_without_logging_stdin(self):
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'infra/staging/deploy-helper.py'), 'deploy', SHA, RUN, CONFIG], input=json.dumps({'githubToken': TOKEN}), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_public_backend_and_database_boundaries(self):
        values = public()
        self.assertEqual(deploy.public_values(values), values)
        connection = f'postgresql://dartflow_app:synthetic-only@db.{REF}.supabase.co:5432/postgres?sslmode=verify-full'
        deploy.validate_database(connection, values)
        for bad in [connection.replace('dartflow_app:', 'postgres:'), connection.replace(REF, 'z' * 20), connection.replace('verify-full', 'require'), connection + '&host=other.invalid', connection + '&sslrootcert=/tmp/untrusted', connection.replace(':5432', ':4173')]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                deploy.validate_database(bad, values)
        for key, value in [('DARTFLOW_DATA_MODE', 'local'), ('DARTFLOW_APP_ORIGIN', 'https://other.invalid'), ('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_synthetic')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                deploy.public_values({**values, key: value})
        self.assertEqual(deploy.public_hash(values), hashlib.sha256(json.dumps(dict(sorted(values.items())), separators=(',', ':')).encode()).hexdigest())

    def test_capacity_requires_copy_headroom(self):
        disk = SimpleNamespace(f_bavail=110, f_frsize=1, f_favail=12)
        policy = {'minFreeBytes': 100, 'minFreeInodes': 10}
        with patch.object(deploy.os, 'statvfs', return_value=disk):
            deploy.capacity('/unused', policy, 10, 2)
            with self.assertRaises(ValueError):
                deploy.capacity('/unused', policy, 11, 2)
            with self.assertRaises(ValueError):
                deploy.capacity('/unused', policy, 10, 3)

    def test_default_policy_cannot_select_a_repository_or_accounts(self):
        template = json.loads((ROOT / 'infra/staging/deploy-policy.example.json').read_text())
        with patch.object(deploy, 'read_json', return_value=template), self.assertRaises(ValueError):
            deploy.read_policy()

    def test_trusted_path_rejects_unprivileged_or_writable_config(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'policy.json'
            path.write_text('{}')
            with self.assertRaises(ValueError):
                deploy.trusted_path(path)

    def test_actual_sudoers_template_parses_after_digest_rendering(self):
        if not Path('/usr/sbin/visudo').exists():
            self.skipTest('visudo unavailable; helper argument boundary still tested')
        text = (ROOT / 'infra/staging/dartflow-staging.sudoers.example').read_text().replace('__REVIEWED_HELPER_SHA256__', 'a' * 64)
        with tempfile.NamedTemporaryFile(mode='w') as file:
            file.write(text)
            file.flush()
            result = subprocess.run(['/usr/sbin/visudo', '-cf', file.name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr.decode())


class SafeSourceAndArtifacts(unittest.TestCase):
    def test_source_extracts_only_one_bounded_tree_and_safe_internal_link(self):
        with tempfile.TemporaryDirectory() as directory:
            stats = extractor.extract(archive([('synthetic-root/src/main.js', 'file', 'hello'), ('synthetic-root/index.js', 'symlink', 'src/main.js')]), directory, 100, 10)
            self.assertEqual(stats, {'bytes': 5, 'files': 3})
            self.assertEqual((Path(directory) / 'index.js').read_text(), 'hello')

    def test_source_rejects_traversal_hardlinks_fifos_cycles_and_duplicate_names(self):
        attacks = [
            [('synthetic-root/../outside', 'file', 'bad')],
            [('/absolute', 'file', 'bad')],
            [('synthetic-root/hard', 'hardlink', 'synthetic-root/target')],
            [('synthetic-root/pipe', 'fifo', '')],
            [('synthetic-root/link', 'symlink', '/etc/passwd')],
            [('synthetic-root/link', 'symlink', '../outside')],
            [('synthetic-root/a', 'symlink', 'b'), ('synthetic-root/b', 'symlink', 'a')],
            [('synthetic-root/a', 'file', 'first'), ('synthetic-root/a', 'file', 'second')],
            [('synthetic-root/.env.local', 'file', 'secret')],
            [('other-prefix/a', 'file', 'bad')],
            [('synthetic-root/parent', 'symlink', 'nested'), ('synthetic-root/parent/file', 'file', 'bad')],
        ]
        for entries in attacks:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as directory, self.assertRaises((ValueError, OSError)):
                extractor.extract(archive(entries), directory, 1000, 20)

    def test_source_enforces_real_byte_and_file_budgets_and_existing_symlink_parent(self):
        for limit, files in [(2, 10), (100, 1)]:
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                extractor.extract(archive([('synthetic-root/a', 'file', '123'), ('synthetic-root/b', 'file', '4')]), directory, limit, files)
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            (Path(directory) / 'parent').symlink_to(outside)
            with self.assertRaises(OSError):
                extractor.extract(archive([('synthetic-root/parent/new', 'file', 'bad')]), directory, 100, 10)
            self.assertFalse((Path(outside) / 'new').exists())

    def seal(self, source, target):
        source_fd, target_fd = os.open(source, deploy.DIRECTORY), os.open(target, deploy.DIRECTORY)
        try:
            with patch.object(deploy, 'ROOT_UID', os.getuid()):
                return deploy.copy_tree(source_fd, target_fd, os.getgid())
        finally:
            os.close(source_fd)
            os.close(target_fd)

    def test_artifact_is_sealed_immutable_and_internal_link_keeps_content(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target:
            (Path(source) / 'asset').write_text('content')
            (Path(source) / 'link').symlink_to('asset')
            result = self.seal(source, target)
            self.assertEqual((Path(target) / 'link').read_text(), 'content')
            self.assertEqual(stat.S_IMODE((Path(target) / 'asset').stat().st_mode), 0o440)
            self.assertEqual(result['bytes'], 7)
            self.assertRegex(result['digest'].hexdigest(), r'^[a-f0-9]{64}$')

    def test_artifact_rejects_real_hardlink_external_symlink_fifo_and_private_files(self):
        for kind in ['hardlink', 'symlink', 'fifo', 'env', 'local']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target, tempfile.NamedTemporaryFile() as outside:
                path = Path(source) / 'bad'
                if kind == 'hardlink':
                    outside_path = Path(source) / 'original'
                    outside_path.write_text('content')
                    os.link(outside_path, path)
                elif kind == 'symlink':
                    path.symlink_to(outside.name)
                elif kind == 'fifo':
                    os.mkfifo(path)
                elif kind == 'local':
                    (Path(source) / '.local').mkdir()
                    (Path(source) / '.local' / 'credentials').write_text('must-not-copy')
                else:
                    (Path(source) / '.env.local').write_text('must-not-copy')
                with self.assertRaises(ValueError):
                    self.seal(source, target)

    def test_symlink_swap_immediately_before_source_open_cannot_escape(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target, tempfile.NamedTemporaryFile(mode='w') as outside:
            outside.write('private-outside-content')
            outside.flush()
            path = Path(source) / 'payload'
            path.write_text('public')
            real_open = os.open
            swapped = []
            def swap(name, flags, *args, **options):
                if name == 'payload' and flags & os.O_ACCMODE == os.O_RDONLY and not swapped:
                    path.unlink()
                    path.symlink_to(outside.name)
                    swapped.append(True)
                return real_open(name, flags, *args, **options)
            with patch.object(deploy.os, 'open', side_effect=swap), self.assertRaises(OSError):
                self.seal(source, target)
            copied = Path(target) / 'payload'
            self.assertFalse(copied.exists() and 'private-outside' in copied.read_text())


class RealLocks(unittest.TestCase):
    def test_another_process_gets_only_lock_conflict_before_any_action(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'ROOT_UID', os.getuid()):
            global_path, site_path = Path(directory) / 'global', Path(directory) / 'site'
            ready_r, ready_w = os.pipe()
            done_r, done_w = os.pipe()
            pid = os.fork()
            if pid == 0:
                try:
                    os.close(ready_r)
                    os.close(done_w)
                    with deploy.deployment_locks(global_path, site_path):
                        os.write(ready_w, b'1')
                        os.read(done_r, 1)
                    os._exit(0)
                except BaseException:
                    os._exit(9)
            os.close(ready_w)
            os.close(done_r)
            try:
                self.assertEqual(os.read(ready_r, 1), b'1')
                actions = []
                with self.assertRaises(deploy.LockBusy):
                    with deploy.deployment_locks(global_path, site_path):
                        actions.append('must-not-run')
                self.assertEqual(actions, [])
            finally:
                os.write(done_w, b'1')
                os.close(done_w)
                os.close(ready_r)
                _, code = os.waitpid(pid, 0)
                self.assertEqual(os.waitstatus_to_exitcode(code), 0)
            with deploy.deployment_locks(global_path, site_path):
                self.assertTrue(True)

    def test_site_conflict_releases_global_lock_and_unsafe_lock_is_not_busy(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'ROOT_UID', os.getuid()):
            global_path, site_path = Path(directory) / 'global', Path(directory) / 'site'
            site_fd = deploy.open_lock(site_path)
            try:
                with self.assertRaises(deploy.LockBusy):
                    with deploy.deployment_locks(global_path, site_path):
                        self.fail('entered while site lock occupied')
                fd = deploy.open_lock(global_path, shared=True)
                os.close(fd)
            finally:
                os.close(site_fd)
            site_path.unlink()
            site_path.symlink_to(global_path)
            with self.assertRaises(OSError):
                with deploy.deployment_locks(global_path, site_path):
                    self.fail('followed unsafe lock symlink')


class ActivationTransactions(unittest.TestCase):
    def fixture(self, directory, previous=True):
        root = Path(directory)
        for name, config in [(NAME, CONFIG), (OLD_NAME, OLD_CONFIG)]:
            release = root / 'releases' / name
            release.mkdir(parents=True)
            (release / '.runtime.env').symlink_to('/synthetic/configs/' + config + '/runtime.env')
        if previous:
            (root / 'current').symlink_to('releases/' + OLD_NAME)
        values = {NAME: {'sha': SHA, 'releaseId': RUN, 'configId': CONFIG}, OLD_NAME: {'sha': OLD_SHA, 'releaseId': OLD_RUN, 'configId': OLD_CONFIG}}
        return root, values, {'healthAttempts': 2, 'healthPauseSeconds': 1}

    def test_success_switches_app_and_config_as_one_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root, values, policy = self.fixture(directory)
            calls = []
            deploy.activate(root, NAME, policy, read=lambda _r, name, _p: values[name], check=lambda meta: True, operate=lambda action, _p: calls.append(action), pause=lambda _: None)
            self.assertEqual(os.readlink(root / 'current'), 'releases/' + NAME)
            self.assertEqual(os.readlink(root / 'current' / '.runtime.env'), '/synthetic/configs/' + CONFIG + '/runtime.env')
            self.assertEqual(calls, ['restart'])

    def test_failed_candidate_restores_exact_previous_app_and_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root, values, policy = self.fixture(directory)
            calls = []
            with self.assertRaisesRegex(deploy.ActivationFailed, 'prior app and exact config recovered'):
                deploy.activate(root, NAME, policy, read=lambda _r, name, _p: values[name], check=lambda meta: meta['sha'] == OLD_SHA, operate=lambda action, _p: calls.append(action), pause=lambda _: None)
            self.assertEqual(os.readlink(root / 'current'), 'releases/' + OLD_NAME)
            self.assertIn(OLD_CONFIG, os.readlink(root / 'current' / '.runtime.env'))
            self.assertEqual(calls, ['restart', 'restart'])
            self.assertTrue((root / 'releases' / NAME).exists())

    def test_interruption_after_atomic_switch_before_restart_is_rolled_back(self):
        with tempfile.TemporaryDirectory() as directory:
            root, values, policy = self.fixture(directory)
            real_point = deploy.point_current
            switched = []
            def interrupted(root, name):
                real_point(root, name)
                if not switched:
                    switched.append(True)
                    raise deploy.Refused('synthetic SIGTERM after replace')
            calls = []
            with patch.object(deploy, 'point_current', side_effect=interrupted), self.assertRaises(deploy.ActivationFailed):
                deploy.activate(root, NAME, policy, read=lambda _r, name, _p: values[name], check=lambda _: True, operate=lambda action, _p: calls.append(action), pause=lambda _: None)
            self.assertEqual(os.readlink(root / 'current'), 'releases/' + OLD_NAME)
            self.assertEqual(calls, ['restart'])
            self.assertFalse((root / '.current-next').exists())

    def test_atomic_pointer_cleans_its_temporary_link_on_replace_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _, _ = self.fixture(directory)
            with patch.object(deploy.os, 'replace', side_effect=OSError('synthetic replace failure')), self.assertRaises(OSError):
                deploy.point_current(root, NAME)
            self.assertFalse((root / '.current-next').is_symlink())
            self.assertEqual(os.readlink(root / 'current'), 'releases/' + OLD_NAME)

    def test_first_install_failure_stops_service_and_removes_current(self):
        with tempfile.TemporaryDirectory() as directory:
            root, values, policy = self.fixture(directory, previous=False)
            calls = []
            with self.assertRaisesRegex(deploy.ActivationFailed, 'First installation failed'):
                deploy.activate(root, NAME, policy, read=lambda _r, name, _p: values[name], check=lambda _: False, operate=lambda action, _p: calls.append(action), pause=lambda _: None)
            self.assertFalse((root / 'current').exists())
            self.assertFalse((root / 'current').is_symlink())
            self.assertEqual(calls, ['restart', 'stop'])

    def test_explicit_rollback_recovers_an_unhealthy_current_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root, values, policy = self.fixture(directory)
            calls = []
            deploy.activate(root, NAME, policy, read=lambda _r, name, _p: values[name], check=lambda meta: meta['sha'] == SHA, operate=lambda action, _p: calls.append(action), pause=lambda _: None, allow_unhealthy_current=True)
            self.assertEqual(os.readlink(root / 'current'), 'releases/' + NAME)
            self.assertEqual(calls, ['restart'])

    def test_failed_rollback_without_healthy_fallback_stops_and_does_not_claim_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root, values, policy = self.fixture(directory)
            calls = []
            with self.assertRaisesRegex(deploy.ActivationFailed, 'without healthy fallback'):
                deploy.activate(root, NAME, policy, read=lambda _r, name, _p: values[name], check=lambda _: False, operate=lambda action, _p: calls.append(action), pause=lambda _: None, allow_unhealthy_current=True)
            self.assertEqual(calls, ['restart', 'stop'])
            self.assertEqual(os.readlink(root / 'current'), 'releases/' + OLD_NAME)

    def test_normal_deploy_refuses_unhealthy_baseline_before_switch_or_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root, values, policy = self.fixture(directory)
            calls = []
            with self.assertRaisesRegex(ValueError, 'baseline failed'):
                deploy.activate(root, NAME, policy, read=lambda _r, name, _p: values[name], check=lambda _: False, operate=lambda action, _p: calls.append(action))
            self.assertEqual(calls, [])
            self.assertEqual(os.readlink(root / 'current'), 'releases/' + OLD_NAME)

    def test_health_checks_require_both_endpoints_on_loopback_and_public(self):
        called = []
        def check(meta, endpoint, public=False):
            called.append((endpoint, public))
            return not (endpoint == '/api/ready' and public)
        with patch.object(deploy, 'http_identity', side_effect=check):
            self.assertFalse(deploy.health({'sha': SHA}))
        self.assertEqual(called, [('/api/health', False), ('/api/ready', False), ('/api/health', True), ('/api/ready', True)])


class BuildIsolation(unittest.TestCase):
    def test_sandbox_uses_pinned_tools_resource_budgets_and_no_secrets(self):
        policy = {'node': '/opt/node-v24.18.0-linux-x64/bin/node', 'npm': '/opt/dg-toolchains/npm/11.16.0/bin/npm', 'buildTimeoutSeconds': 300, 'buildMemoryMax': '3G', 'buildCpuQuota': '100%'}
        values = {**public(), 'DARTFLOW_RELEASE_SHA': SHA, 'DARTFLOW_RELEASE_ID': RUN, 'DARTFLOW_BUILD_CONFIG_ID': CONFIG, 'DARTFLOW_RUNTIME_CONFIG_ID': CONFIG}
        with patch.object(deploy, 'command') as command, patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(returncode=3)) as run:
            deploy.build_command([policy['npm'], 'ci', '--no-audit', '--no-fund'], Path('/var/lib/dg-build/dartflow-staging/fixture'), policy, RUN, 'install', values=values)
        argv = command.call_args.args[0]
        for required in ['--uid=build-dart-stg', '--gid=build-dart-stg', '--property=KillMode=control-group', '--property=MemoryMax=3G', '--property=ProtectSystem=strict', '--property=NoNewPrivileges=yes', '--property=ProtectHome=yes', '--property=ProtectProc=invisible']:
            self.assertIn(required, argv)
        clean = argv.index('/usr/bin/env')
        self.assertEqual(argv[clean + 1], '-i')
        self.assertNotIn(TOKEN, str(argv))
        self.assertNotIn('DARTFLOW_DATABASE_URL', str(argv))
        self.assertEqual(argv[-4:], [policy['npm'], 'ci', '--no-audit', '--no-fund'])
        self.assertEqual(run.call_args.args[0][1:3], ['is-active', '--quiet'])
        with self.assertRaises(ValueError):
            deploy.build_command(['npm', 'ci'], Path('/unused'), policy, RUN, 'install', values={'GITHUB_TOKEN': TOKEN})

    def test_build_failure_stops_cgroup_and_refuses_to_seal_if_it_stays_active(self):
        policy = {'node': '/opt/node/bin/node', 'npm': '/opt/npm/bin/npm', 'buildTimeoutSeconds': 60, 'buildMemoryMax': '3G', 'buildCpuQuota': '100%'}
        with patch.object(deploy, 'command', side_effect=subprocess.TimeoutExpired('synthetic-build', 1)), patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(returncode=3)) as run, self.assertRaises(subprocess.TimeoutExpired):
            deploy.build_command(['npm', 'run', 'build'], Path('/unused'), policy, RUN, 'build')
        self.assertEqual(run.call_count, 2)
        with patch.object(deploy, 'command'), patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(returncode=0)), self.assertRaisesRegex(ValueError, 'cgroup'):
            deploy.build_command(['npm', 'run', 'build'], Path('/unused'), policy, RUN, 'build')

    def test_independent_gate_credential_is_only_in_stdin(self):
        policy = {'repository': 'synthetic/dartflow', 'integrationBranch': 'main', 'node': '/opt/node/bin/node', 'requiredChecks': [{'workflow': 'ci.yml', 'jobs': ['Verify'], 'events': ['push']}]}
        output = {'status': 'passed', 'sha': SHA, 'ciRunUrl': 'https://github.com/synthetic/dartflow/actions/runs/123', 'deploymentRunUrl': 'https://github.com/synthetic/dartflow/actions/runs/' + RUN.split('-')[0]}
        with patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(output).encode())) as run:
            self.assertEqual(deploy.github_gate(policy, SHA, TOKEN, RUN), output)
        self.assertEqual(run.call_args.args[0], [policy['node'], deploy.GATE, '--stdin'])
        self.assertEqual(json.loads(run.call_args.kwargs['input'])['githubToken'], TOKEN)
        self.assertEqual(json.loads(run.call_args.kwargs['input'])['deploymentRun'], {'id': RUN.split('-')[0], 'attempt': 1})
        self.assertNotIn(TOKEN, str(run.call_args.args))
        self.assertNotIn(TOKEN, str(run.call_args.kwargs['env']))
        output['sha'] = OLD_SHA
        with patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(output).encode())), self.assertRaises(ValueError):
            deploy.github_gate(policy, SHA, TOKEN, RUN)


class CompleteReleaseFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.site, self.build_root, self.config_root = [self.root / name for name in ['site', 'build', 'configs']]
        for directory in [self.site, self.site / 'releases', self.build_root, self.config_root]:
            directory.mkdir(exist_ok=True)
        self.bundle = self.config_root / CONFIG
        self.bundle.mkdir(mode=0o700)
        (self.bundle / 'public.json').write_text(json.dumps(public()))
        (self.bundle / 'public.json').chmod(0o600)
        (self.bundle / 'runtime.env').write_text(f'DARTFLOW_DATABASE_URL="postgresql://dartflow_app:synthetic-only@db.{REF}.supabase.co:5432/postgres?sslmode=verify-full"\n')
        (self.bundle / 'runtime.env').chmod(0o600)
        self.node, self.npm = self.root / 'node', self.root / 'npm'
        self.node.write_text('synthetic-node-24.18.0')
        self.npm.write_text('synthetic-npm-11.16.0')
        self.node.chmod(0o700)
        self.npm.chmod(0o700)
        self.policy = json.loads((ROOT / 'infra/staging/deploy-policy.example.json').read_text())
        self.policy.update(repository='synthetic/dartflow', integrationBranch='main', port=4174, node=str(self.node), npm=str(self.npm), gateSha256='c' * 64, extractorSha256='c' * 64, backend={'projectRef': REF}, allowedConfigIds=[CONFIG])
        self.person = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
        self.patches = [patch.object(deploy, 'ROOT_UID', os.getuid()), patch.object(deploy, 'SITE_ROOT', self.site), patch.object(deploy, 'BUILD_ROOT', self.build_root), patch.object(deploy, 'CONFIG_ROOT', self.config_root), patch.object(deploy, 'trusted_path', side_effect=lambda path, directory=False: Path(path)), patch.object(deploy.pwd, 'getpwnam', return_value=self.person), patch.object(deploy, 'capacity')]
        for context in self.patches:
            context.start()
        self.events = []
        self.bad_marker = False

    def tearDown(self):
        for context in reversed(self.patches):
            context.stop()
        # Tests run without root. Production's root-owned sealed directories need
        # their fixture-owner permission restored solely for offline fixture cleanup.
        for directory, dirs, files in os.walk(self.root):
            os.chmod(directory, 0o700)
            for file in files:
                path = Path(directory) / file
                if not path.is_symlink():
                    path.chmod(0o600)
        self.temporary.cleanup()

    def gate(self, policy, sha, token, run):
        self.events.append('gate')
        self.assertEqual(token, TOKEN)
        self.assertEqual(sha, SHA)
        return {'status': 'passed', 'sha': sha, 'ciRunUrl': 'https://github.com/synthetic/dartflow/actions/runs/123', 'deploymentRunUrl': 'https://github.com/synthetic/dartflow/actions/runs/' + run.split('-')[0]}

    def download(self, policy, sha, token, destination):
        self.events.append('download')
        self.assertEqual(token, TOKEN)
        destination.write_bytes(archive([('synthetic-root/package.json', 'file', '{"scripts":{"build":"synthetic-only"}}'), ('synthetic-root/package-lock.json', 'file', '{"lockfileVersion":3}')]).read())

    def build(self, argv, work, policy, run, stage, values=None, stdin=None):
        self.events.append(stage)
        self.assertNotIn(TOKEN, str(argv))
        self.assertNotIn(TOKEN, str(values))
        self.assertNotIn('DARTFLOW_DATABASE_URL', str(values))
        if stage == 'extract':
            extractor.extract(stdin, work / 'source', policy['maxSourceBytes'], policy['maxSourceFiles'])
        elif stage == 'versions':
            self.assertIn('v24.18.0', argv)
            self.assertIn('11.16.0', argv)
        elif stage == 'install':
            self.assertEqual(argv, [policy['npm'], 'ci', '--no-audit', '--no-fund'])
        elif stage == 'build':
            standalone = work / 'source' / '.next' / 'standalone'
            (standalone / 'public').mkdir(parents=True)
            (standalone / 'public' / 'logo.svg').write_text('<svg/>')
            (standalone / '.next' / 'static').mkdir(parents=True)
            (standalone / '.next' / 'static' / 'fixture.js').write_text('synthetic-only')
            (standalone / 'server.js').write_text('synthetic-server-only')
            marker = {'format': 'dartflow-build-config-v1', 'sourceSha': SHA, 'configId': CONFIG, 'publicConfigHash': 'f' * 64 if self.bad_marker else deploy.public_hash(public())}
            (standalone / 'build-config.json').write_text(json.dumps(marker))

    def activate(self, root, name, policy):
        self.events.append('activate')
        return deploy.activate(root, name, policy, check=lambda _: True, operate=lambda action, _p: self.events.append(action), pause=lambda _: None)

    def run_release(self):
        # Root cleanup is equivalent to owner-permission reset only inside this fixture.
        real_rmtree = shutil.rmtree
        def fixture_cleanup(path):
            for directory, _, _ in os.walk(path):
                os.chmod(directory, 0o700)
            return real_rmtree(path)
        with patch.object(deploy.shutil, 'rmtree', side_effect=fixture_cleanup):
            return deploy.deploy_release(self.policy, SHA, RUN, CONFIG, TOKEN, gate=self.gate, download=self.download, build=self.build, activate_release=self.activate)

    def test_full_pipeline_gates_exact_source_builds_without_secrets_and_seals_bound_config(self):
        result = self.run_release()
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(self.events, ['gate', 'download', 'extract', 'versions', 'install', 'build', 'activate', 'restart'])
        self.assertEqual(os.readlink(self.site / 'current'), 'releases/' + NAME)
        self.assertEqual(os.readlink(self.site / 'current' / '.runtime.env'), str(self.bundle / 'runtime.env'))
        meta = deploy.metadata(self.site, NAME, self.policy)
        self.assertEqual(meta['sha'], SHA)
        self.assertEqual(meta['configId'], CONFIG)
        self.assertEqual(meta['toolchain']['npm'], '11.16.0')
        self.assertEqual(list(self.build_root.iterdir()), [])
        for path in self.root.rglob('*'):
            if path.is_file() and not path.is_symlink():
                self.assertNotIn(TOKEN.encode(), path.read_bytes())

    def test_wrong_build_marker_never_activates_and_leaves_no_partial_candidate(self):
        self.bad_marker = True
        with self.assertRaisesRegex(ValueError, 'marker differs'):
            self.run_release()
        self.assertNotIn('activate', self.events)
        self.assertFalse((self.site / 'current').is_symlink())
        self.assertEqual(list((self.site / 'releases').iterdir()), [])
        self.assertEqual(list(self.build_root.iterdir()), [])

    def test_config_drift_after_a_successful_release_blocks_activation_before_switch(self):
        self.run_release()
        with (self.bundle / 'runtime.env').open('a') as stream:
            stream.write('# same keys but a different immutable config file\n')
        calls = []
        with self.assertRaisesRegex(ValueError, 'Configuration was changed'):
            deploy.activate(self.site, NAME, self.policy, check=lambda _: True, operate=lambda action, _p: calls.append(action))
        self.assertEqual(calls, [])
        self.assertEqual(os.readlink(self.site / 'current'), 'releases/' + NAME)

    def test_unquoted_and_quoted_runtime_escapes_are_refused_before_systemd_interpretation(self):
        for password in ['synthetic\\password', 'synthetic"password', "synthetic'password"]:
            for quoted in [False, True]:
                value = f'postgresql://dartflow_app:{password}@db.{REF}.supabase.co:5432/postgres?sslmode=verify-full'
                (self.bundle / 'runtime.env').write_text('DARTFLOW_DATABASE_URL=' + ('"' + value + '"' if quoted else value) + '\n')
                with self.subTest(password=password, quoted=quoted), self.assertRaises(ValueError):
                    deploy.read_bundle(CONFIG, REF)

    def test_unknown_existing_archive_is_retained_without_build(self):
        unknown = self.build_root / ('.archive-' + RUN + '.tar.gz')
        unknown.write_text('retained-for-operator-review')
        with self.assertRaisesRegex(ValueError, 'existing source archive retained'):
            self.run_release()
        self.assertEqual(unknown.read_text(), 'retained-for-operator-review')
        self.assertNotIn('download', self.events)

    def test_independent_ci_refusal_happens_before_download_or_build_work(self):
        def reject(*_):
            raise deploy.Refused('synthetic CI refusal')
        with self.assertRaises(ValueError):
            deploy.deploy_release(self.policy, SHA, RUN, CONFIG, TOKEN, gate=reject, download=self.download, build=self.build, activate_release=self.activate)
        self.assertEqual(self.events, [])
        self.assertEqual(list(self.build_root.iterdir()), [])
        self.assertEqual(list((self.site / 'releases').iterdir()), [])

    def test_policy_rejects_milo_uids_gids_and_sibling_group_memberships(self):
        names = [deploy.RUNNER, deploy.BUILDER, deploy.APP, 'run-mil-stg', 'build-mil-stg', 'app-mil-stg']
        people = {name: SimpleNamespace(pw_name=name, pw_uid=2001 + i, pw_gid=3001 + i) for i, name in enumerate(names)}
        people['run-mil-stg'].pw_uid = 1001
        self.policy['accounts'] = {name: {'uid': people[name].pw_uid, 'gid': people[name].pw_gid} for name in names[:3]}
        with patch.object(deploy, 'read_json', return_value=self.policy), patch.object(deploy, 'trusted_tool'), patch.object(deploy, 'file_digest', return_value='c' * 64), patch.object(deploy.pwd, 'getpwnam', side_effect=lambda name: people[name]), patch.object(deploy.os, 'getgrouplist', side_effect=lambda name, gid: [gid]), patch.object(deploy.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=4444)):
            deploy.read_policy()
            people[deploy.BUILDER].pw_uid = 1001
            self.policy['accounts'][deploy.BUILDER]['uid'] = 1001
            with self.assertRaisesRegex(ValueError, 'Milo identities'):
                deploy.read_policy()
            people[deploy.BUILDER].pw_uid = 2002
            self.policy['accounts'][deploy.BUILDER]['uid'] = 2002
            with patch.object(deploy.os, 'getgrouplist', side_effect=lambda name, gid: [gid, 0] if name == deploy.APP else [gid]), self.assertRaisesRegex(ValueError, 'supplemental'):
                deploy.read_policy()


class SourceDownloadBoundary(unittest.TestCase):
    def response(self, status, body=b'', location=None):
        stream = io.BytesIO(body)
        return SimpleNamespace(status=status, getheader=lambda key: location if key == 'Location' else None, read=lambda size: stream.read(size))

    def test_exact_archive_uses_only_fixed_github_hosts_and_bounded_body(self):
        responses = [self.response(302, location='https://codeload.github.com/synthetic/dartflow/legacy.tar.gz/' + SHA), self.response(200, b'fixture-compressed-source')]
        calls = []
        class Connection:
            def __init__(self, host, timeout):
                calls.append(('host', host))
            def request(self, method, path, headers):
                calls.append(('request', method, path, headers))
            def getresponse(self):
                return responses.pop(0)
            def close(self):
                pass
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy.http.client, 'HTTPSConnection', Connection):
            target = Path(directory) / 'archive'
            deploy.download_archive({'repository': 'synthetic/dartflow', 'maxSourceBytes': 100}, SHA, TOKEN, target)
            self.assertEqual(target.read_bytes(), b'fixture-compressed-source')
        self.assertEqual([call[1] for call in calls if call[0] == 'host'], ['api.github.com', 'codeload.github.com'])
        self.assertEqual(calls[1][2], '/repos/synthetic/dartflow/tarball/' + SHA)
        self.assertEqual(calls[1][3]['Authorization'], 'Bearer ' + TOKEN)

    def test_cross_host_wrong_commit_and_oversized_download_are_refused(self):
        for location, body in [('https://must-not-connect.invalid/archive', b''), ('https://codeload.github.com/synthetic/dartflow/legacy.tar.gz/' + OLD_SHA, b''), (None, b'1234')]:
            response = self.response(302 if location else 200, body=body, location=location)
            calls = []
            class Connection:
                def __init__(self, host, timeout):
                    calls.append(host)
                def request(self, *_args, **_options):
                    pass
                def getresponse(self):
                    return response
                def close(self):
                    pass
            with self.subTest(location=location), tempfile.TemporaryDirectory() as directory, patch.object(deploy.http.client, 'HTTPSConnection', Connection), self.assertRaises(ValueError):
                deploy.download_archive({'repository': 'synthetic/dartflow', 'maxSourceBytes': 3}, SHA, TOKEN, Path(directory) / 'archive')
            self.assertEqual(calls, ['api.github.com'])


class TrackedSourceContract(unittest.TestCase):
    def test_committed_git_archive_with_real_example_files_extracts_without_secrets(self):
        # Uses the real committed app tree, adding the same single top-level wrapper
        # that GitHub tarballs provide. No source checkout, network or deploy occurs.
        result = subprocess.run(['/usr/bin/git', 'archive', '--format=tar', '--prefix=contract-root/', 'HEAD'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=10)
        with tempfile.TemporaryDirectory() as directory:
            extractor.extract(io.BytesIO(result.stdout), directory, 64 * 1024 * 1024, 100000)
            self.assertTrue((Path(directory) / '.env.example').is_file())
            self.assertTrue((Path(directory) / '.env.staging.example').is_file())
            self.assertTrue((Path(directory) / 'package-lock.json').is_file())
            self.assertFalse((Path(directory) / '.env.local').exists())
            self.assertEqual(json.loads((Path(directory) / 'package.json').read_text())['name'], 'dartflow')


if __name__ == '__main__':
    unittest.main(verbosity=2)
