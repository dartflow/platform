#!/usr/bin/python3
"""Offline real-filesystem/lock/transaction tests; no sudo, systemd or providers run."""
import array
import hashlib
import importlib.util
import importlib.machinery
import io
import json
import os
from pathlib import Path
import shutil
import select
import signal
import socket
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
    path = ROOT / file
    spec = importlib.util.spec_from_file_location(name, path, loader=importlib.machinery.SourceFileLoader(name, str(path)))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

deploy = load('dartflow_helper', 'infra/staging/deploy-helper.py')
entry = load('dartflow_entry', 'infra/staging/deploy-entry.py')
extractor = load('dartflow_extract', 'infra/staging/extract-source.py')
guardian = load('dartflow_guardian', 'infra/staging/lock-guardian.py')
renderer = load('dartflow_renderer', 'infra/staging/render-deployer.py')
proof = load('dartflow_lock_proof', 'infra/staging/probe-lock-lifetime.py')
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


class FixedEnvironmentRendering(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.outputs, self.modules = {}, {}
        for environment in ['staging', 'production']:
            output = self.root / environment
            manifest = renderer.render(environment, output)
            self.outputs[environment] = (output, manifest)
            helper = output / 'usr/local/libexec' / manifest['helper']
            guard = output / 'usr/local/libexec' / manifest['guardian']
            self.modules[environment] = (load('rendered_' + environment, helper), load('rendered_guardian_' + environment, guard))

    def test_rendered_copies_pin_reviewed_digests_and_exact_install_paths(self):
        for environment, (output, manifest) in self.outputs.items():
            with self.subTest(environment=environment):
                for path, measured in manifest['files'].items():
                    self.assertEqual(hashlib.sha256((output / path.lstrip('/')).read_bytes()).hexdigest(), measured['sha256'])
                helper_hash = manifest['files']['/usr/local/libexec/' + manifest['helper']]['sha256']
                entry_text = (output / 'usr/local/bin' / manifest['entry']).read_text()
                sudoers = (output / 'etc/sudoers.d' / manifest['site']).read_text()
                self.assertIn(helper_hash, entry_text)
                self.assertIn('sha256:' + helper_hash, sudoers)
                self.assertNotIn('__REVIEWED_HELPER_SHA256__', entry_text + sudoers)
                self.assertNotIn(TOKEN, json.dumps(manifest))
                if Path('/usr/sbin/visudo').exists():
                    result = subprocess.run(['/usr/sbin/visudo', '-cf', str(output / 'etc/sudoers.d' / manifest['site'])], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                    self.assertEqual(result.returncode, 0, result.stderr.decode())
        with self.assertRaises(FileExistsError):
            renderer.render('production', self.root / 'production')
        with self.assertRaises(ValueError):
            renderer.render('custom', self.root / 'custom')

    def test_production_bindings_are_fixed_and_caller_cannot_choose_an_environment(self):
        stage, _ = self.modules['staging']
        production, _ = self.modules['production']
        self.assertEqual((production.SITE, production.PUBLIC_HOST, production.PORT, production.BACKEND_REF), ('dartflow-production', 'dartflow.nl', 4175, 'wlrnowuownakqqgjxnbb'))
        self.assertEqual((stage.PUBLIC_HOST, stage.PORT, stage.BACKEND_REF), ('staging.dartflow.nl', 4174, 'dsnqnvbckkqpzadblshu'))
        self.assertEqual((production.REPOSITORY, production.INTEGRATION_BRANCH, production.DEPLOYMENT_WORKFLOW), ('dartflow/platform', 'main', 'deploy-production.yml'))
        self.assertEqual(production.SIBLING_ACCOUNTS, (stage.RUNNER, stage.BUILDER, stage.APP))
        self.assertEqual(stage.SIBLING_ACCOUNTS, (production.RUNNER, production.BUILDER, production.APP))
        for key in ['SITE_ROOT', 'BUILD_ROOT', 'CONFIG_ROOT', 'POLICY', 'SITE_LOCK', 'GATE', 'GUARDIAN', 'EXTRACTOR', 'BUILD_PREFIX', 'GUARDIAN_PREFIX']:
            self.assertNotEqual(getattr(stage, key), getattr(production, key), key)
        self.assertEqual(stage.GLOBAL_LOCK, production.GLOBAL_LOCK)
        for args in [['production', 'deploy', SHA, RUN, CONFIG], ['deploy', SHA, RUN, CONFIG, 'dartflow-staging']]:
            with self.assertRaises(ValueError):
                production.arguments(args)
        with self.assertRaises(ValueError):
            production.request_body(io.BytesIO(json.dumps({'githubToken': TOKEN, 'environment': 'staging'}).encode()), 'deploy')

    def test_each_fixed_policy_refuses_cross_environment_identity_before_build(self):
        for environment, (output, manifest) in self.outputs.items():
            module, _ = self.modules[environment]
            policy = json.loads((output / 'etc/dg-sites' / manifest['site'] / 'deploy.example.json').read_text())
            for key, value in [('repository', 'other/platform'), ('integrationBranch', 'feature'), ('port', 4173), ('port', 4174 if environment == 'production' else 4175), ('backend', {'projectRef': 'z' * 20})]:
                with self.subTest(environment=environment, key=key, value=value), patch.object(module, 'read_json', return_value={**policy, key: value}), self.assertRaises(ValueError):
                    module.read_policy()

    def test_production_public_config_health_and_gate_use_only_fixed_targets(self):
        production, _ = self.modules['production']
        values = {**public(), 'DARTFLOW_APP_ORIGIN': 'https://dartflow.nl', 'NEXT_PUBLIC_SUPABASE_URL': 'https://wlrnowuownakqqgjxnbb.supabase.co'}
        self.assertEqual(production.public_values(values), values)
        with self.assertRaises(ValueError):
            production.public_values(public())
        identity = {'status': 'ok', 'sha': SHA, 'releaseId': RUN, 'buildConfigId': CONFIG, 'runtimeConfigId': CONFIG}
        connection = SimpleNamespace(request=lambda *args, **kwargs: None, getresponse=lambda: SimpleNamespace(status=200, read=lambda _: json.dumps(identity).encode()), close=lambda: None)
        with patch.object(production.http.client, 'HTTPSConnection', return_value=connection) as https:
            self.assertTrue(production.http_identity({'sha': SHA, 'releaseId': RUN, 'configId': CONFIG, 'port': 4175}, '/api/health', True))
            https.assert_called_once_with('dartflow.nl', timeout=2)
        policy = {'repository': 'dartflow/platform', 'integrationBranch': 'main', 'node': '/opt/node/bin/node', 'requiredChecks': [{'workflow': 'ci.yml', 'jobs': ['Verify'], 'events': ['push']}]}
        evidence = {'status': 'passed', 'sha': SHA, 'ciRunUrl': 'https://github.com/dartflow/platform/actions/runs/123', 'deploymentRunUrl': 'https://github.com/dartflow/platform/actions/runs/' + RUN.split('-')[0]}
        with patch.object(production.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(evidence).encode())) as run:
            production.github_gate(policy, SHA, TOKEN, RUN)
            self.assertEqual(json.loads(run.call_args.kwargs['input'])['deploymentWorkflow'], 'deploy-production.yml')
            self.assertEqual(run.call_args.args[0][1], '/usr/local/libexec/dartflow-production-release-gate.mjs')

    def test_transient_build_and_guardian_scopes_never_cross_environment(self):
        policy = {'node': '/opt/node/bin/node', 'npm': '/opt/npm/bin/npm', 'buildTimeoutSeconds': 60, 'buildMemoryMax': '3G', 'buildCpuQuota': '100%'}
        for environment, (module, guard) in self.modules.items():
            with self.subTest(environment=environment), patch.object(module, 'BUILD_LOCK_FDS', (31, 32)), patch.object(module, 'command') as command, patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=3)):
                module.build_command(['npm', 'ci'], Path('/synthetic'), policy, RUN, 'install')
                argv = command.call_args.args[0]
                self.assertIn('--unit=' + module.BUILD_PREFIX + RUN + '-install', argv)
                self.assertIn('--uid=' + module.BUILDER, argv)
                module.service('restart', {'serviceTimeoutSeconds': 45})
                self.assertEqual(command.call_args.args[0][-1], module.SERVICE)
            calls = []
            def execute(args, **kwargs):
                calls.append(args)
                return SimpleNamespace(returncode=0 if 'list-jobs' in args else 3, stdout=b'')
            self.assertTrue(guard.stop_builds(RUN, execute=execute))
            self.assertEqual(guard.BUILD_PREFIX, module.BUILD_PREFIX)
            self.assertEqual(guard.SERVICE, module.SERVICE)
            self.assertEqual(guard.SITE_LOCK, module.SITE_LOCK)
            self.assertTrue(all(args[-1].startswith(module.BUILD_PREFIX + RUN) for args in calls if args[1] == 'stop'))
            def jobs(service):
                return lambda args, **kwargs: SimpleNamespace(returncode=0 if 'list-jobs' in args else 3, stdout=('123 ' + service + ' restart running\n').encode())
            self.assertFalse(guard.stop_builds(RUN, execute=jobs(module.SERVICE)))
            sibling = 'dartflow-production.service' if environment == 'staging' else 'dartflow-staging.service'
            self.assertTrue(guard.stop_builds(RUN, execute=jobs(sibling)))

    def test_shared_global_lock_blocks_other_environment_before_work(self):
        stage, _ = self.modules['staging']
        production, _ = self.modules['production']
        global_path, stage_path, production_path = [self.root / name for name in ['global.lock', 'stage.lock', 'production.lock']]
        with patch.object(stage, 'ROOT_UID', os.getuid()), patch.object(production, 'ROOT_UID', os.getuid()):
            with stage.deployment_locks(global_path, stage_path):
                with self.assertRaises(production.LockBusy):
                    with production.deployment_locks(global_path, production_path):
                        self.fail('Production overlapped staging')
                self.assertFalse(production_path.exists())
            with production.deployment_locks(global_path, production_path):
                pass


class SafeSourceAndArtifacts(unittest.TestCase):
    def test_all_three_public_environment_examples_extract_but_private_variants_do_not(self):
        examples=['.env.example','.env.staging.example','.env.production.example']
        with tempfile.TemporaryDirectory() as directory:
            extractor.extract(archive([('synthetic-root/'+name,'file','PUBLIC_PLACEHOLDER=example\n') for name in examples]),directory,1000,10)
            for name in examples:self.assertEqual((Path(directory)/name).read_text(),'PUBLIC_PLACEHOLDER=example\n')
        for name in ['.env','.env.local','.env.staging','.env.production','.env.production.local','.env.production.example.backup','nested/.env.production','nested/.env.secret']:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory,self.assertRaises(ValueError):
                extractor.extract(archive([('synthetic-root/'+name,'file','PRIVATE_MUST_NOT_EXTRACT=fixture')]),directory,1000,10)

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
    def setUp(self):
        self.locks = patch.object(deploy, 'BUILD_LOCK_FDS', (31, 32))
        self.locks.start()
        self.addCleanup(self.locks.stop)

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
        self.assertEqual(command.call_args.kwargs['pass_fds'], (31, 32))
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

    def test_synchronous_app_clients_keep_controller_locks_without_passing_them_to_app(self):
        with patch.object(deploy, 'command') as command:
            for action in ['restart', 'stop']:
                deploy.service(action, {'serviceTimeoutSeconds': 45})
                self.assertEqual(command.call_args.args[0], ['/usr/bin/systemctl', action, 'dartflow-staging.service'])
                self.assertEqual(command.call_args.kwargs, {'timeout': 45, 'pass_fds': (31, 32)})
            with self.assertRaises(ValueError):
                deploy.service('shell', {'serviceTimeoutSeconds': 45})

    def test_independent_gate_credential_is_only_in_stdin(self):
        policy = {'repository': 'synthetic/dartflow', 'integrationBranch': 'main', 'node': '/opt/node/bin/node', 'requiredChecks': [{'workflow': 'ci.yml', 'jobs': ['Verify'], 'events': ['push']}]}
        output = {'status': 'passed', 'sha': SHA, 'ciRunUrl': 'https://github.com/synthetic/dartflow/actions/runs/123', 'deploymentRunUrl': 'https://github.com/synthetic/dartflow/actions/runs/' + RUN.split('-')[0]}
        with patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(output).encode())) as run:
            self.assertEqual(deploy.github_gate(policy, SHA, TOKEN, RUN), output)
        self.assertEqual(run.call_args.args[0], [policy['node'], deploy.GATE, '--stdin'])
        self.assertEqual(json.loads(run.call_args.kwargs['input'])['githubToken'], TOKEN)
        self.assertEqual(json.loads(run.call_args.kwargs['input'])['deploymentRun'], {'id': RUN.split('-')[0], 'attempt': 1})
        self.assertEqual(json.loads(run.call_args.kwargs['input'])['deploymentWorkflow'], 'deploy-staging.yml')
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
            directory.mkdir(mode=0o750, exist_ok=True)
            directory.chmod(0o750)
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
        self.policy.update(repository='synthetic/dartflow', integrationBranch='main', port=4174, node=str(self.node), npm=str(self.npm), gateSha256='c' * 64, extractorSha256='c' * 64, guardianSha256='c' * 64, backend={'projectRef': REF}, allowedConfigIds=[CONFIG])
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
        self.assertNotIn('DARTFLOW_MAIL_ALLOWED_REPLY_TO', str(values))
        self.assertNotIn('support@dartflow.nl', str(values))
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
        with (self.bundle / 'runtime.env').open('a') as stream:
            stream.write('DARTFLOW_MAIL_ALLOWED_FROM=noreply@dartflow.nl\n'
                         'DARTFLOW_MAIL_ALLOWED_REPLY_TO=support@dartflow.nl\n'
                         'DARTFLOW_MAIL_TEST_RECIPIENTS=info@dgwebservices.nl\n')
        result = self.run_release()
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(self.events, ['gate', 'download', 'extract', 'versions', 'install', 'build', 'activate', 'restart'])
        self.assertEqual(os.readlink(self.site / 'current'), 'releases/' + NAME)
        self.assertEqual(os.readlink(self.site / 'current' / '.runtime.env'), str(self.bundle / 'runtime.env'))
        meta = deploy.metadata(self.site, NAME, self.policy)
        self.assertEqual(meta['sha'], SHA)
        self.assertEqual(meta['configId'], CONFIG)
        self.assertEqual(meta['toolchain']['npm'], '11.16.0')
        active_runtime = (self.site / 'current' / '.runtime.env').read_text()
        self.assertEqual(deploy.runtime_values(active_runtime, public())['DARTFLOW_MAIL_ALLOWED_REPLY_TO'], 'support@dartflow.nl')
        self.assertEqual(meta['runtimeConfigHash'], hashlib.sha256(active_runtime.encode()).hexdigest())
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
        names = [deploy.RUNNER, deploy.BUILDER, deploy.APP, 'run-mil-stg', 'build-mil-stg', 'app-mil-stg', *deploy.SIBLING_ACCOUNTS]
        people = {name: SimpleNamespace(pw_name=name, pw_uid=2001 + i, pw_gid=3001 + i) for i, name in enumerate(names)}
        people['run-mil-stg'].pw_uid = 1001
        self.policy['accounts'] = {name: {'uid': people[name].pw_uid, 'gid': people[name].pw_gid} for name in names[:3]}
        with patch.object(deploy, 'REPOSITORY', 'synthetic/dartflow'), patch.object(deploy, 'BACKEND_REF', REF), patch.object(deploy, 'read_json', return_value=self.policy), patch.object(deploy, 'trusted_tool'), patch.object(deploy, 'file_digest', return_value='c' * 64), patch.object(deploy.pwd, 'getpwnam', side_effect=lambda name: people[name]), patch.object(deploy.os, 'getgrouplist', side_effect=lambda name, gid: [gid]), patch.object(deploy.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=4444)):
            deploy.read_policy()
            people[deploy.BUILDER].pw_uid = 1001
            self.policy['accounts'][deploy.BUILDER]['uid'] = 1001
            with self.assertRaisesRegex(ValueError, 'Milo identities'):
                deploy.read_policy()
            people[deploy.BUILDER].pw_uid = people[deploy.SIBLING_ACCOUNTS[1]].pw_uid
            self.policy['accounts'][deploy.BUILDER]['uid'] = people[deploy.BUILDER].pw_uid
            with self.assertRaisesRegex(ValueError, 'sibling environment'):
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


class HostProofBoundaries(unittest.TestCase):
    def test_worker_proof_source_is_shared_fixed_and_apps_are_never_selected(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'render'
            manifest = renderer.render('production', output)
            self.assertIn('/usr/local/libexec/dartflow-probe-lock-lifetime.py', manifest['files'])
        self.assertEqual(set(proof.TARGETS), {'staging', 'production'})
        argv = proof.build_argv(deploy, RUN, Path('/synthetic/work'))
        self.assertIn('--unit=' + deploy.BUILD_PREFIX + RUN + '-build.service', argv)
        self.assertIn('--uid=build-dart-stg', argv)
        self.assertIn('--property=RuntimeMaxSec=50', argv)
        self.assertIn('--property=ExecStop=/usr/bin/sleep 3', argv)
        self.assertNotIn('dartflow-staging.service', argv)
        self.assertNotIn('milobingo-staging.service', argv)
        self.assertEqual(argv[-3:], ['--worker', 'staging', '/synthetic/work'])

    def test_individual_lock_checks_do_not_mask_site_loss(self):
        with patch.object(proof, 'busy', side_effect=[True, False]) as busy, self.assertRaisesRegex(ValueError, 'Site lock'):
            proof.locks_busy(deploy)
        self.assertEqual(busy.call_args_list[0].args[0], deploy.GLOBAL_LOCK)
        self.assertEqual(busy.call_args_list[1].args[0], deploy.SITE_LOCK)

    def test_proof_control_files_and_evidence_reject_links_and_are_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / 'worker').mkdir()
            outside = work / 'outside'
            outside.write_text('private synthetic fixture')
            control = work / 'permit'
            control.symlink_to(outside)
            with self.assertRaises(FileExistsError):
                proof.control_file(control)
            evidence = work / 'worker' / 'worker.json'
            evidence.symlink_to(outside)
            with self.assertRaises(OSError):
                proof.worker_evidence(work)
            evidence.unlink()
            evidence.write_text('x' * 4097)
            with self.assertRaises(ValueError):
                proof.worker_evidence(work)
            self.assertEqual(outside.read_text(), 'private synthetic fixture')

    def test_proof_job_observation_requires_bounded_trustworthy_exact_unit(self):
        unit = 'dartflow-production-fd-proof-' + RUN + '.service'
        with patch.object(proof, 'manager', return_value=SimpleNamespace(returncode=0, stdout=('10 ' + unit + ' restart running\n').encode())):
            self.assertTrue(proof.job_pending(unit))
        for payload, code in [(b'not a trustworthy job list', 0), (b'x' * 65536, 0), (b'', 1)]:
            with patch.object(proof, 'manager', return_value=SimpleNamespace(returncode=code, stdout=payload)), self.assertRaises(ValueError):
                proof.job_pending(unit)


class GuardianLifetime(unittest.TestCase):
    def test_systemd_guardian_receives_only_lock_stdio_and_waits_for_ready(self):
        client = SimpleNamespace(poll=lambda: None)
        with patch.object(deploy, 'trusted_path'), patch.object(deploy, 'file_digest', return_value='a' * 64), patch.object(deploy.subprocess, 'Popen', return_value=client) as spawn, patch.object(deploy, 'guardian_state', side_effect=[{'activating', 'start'}, {'active', 'running'}]), patch.object(deploy.time, 'sleep'):
            result = deploy.start_guardian((31, 32), RUN, {'guardianSha256': 'a' * 64})
        self.assertEqual(result['client'], client)
        args = spawn.call_args.args[0]
        self.assertIn('--service-type=notify', args)
        self.assertIn('--property=NotifyAccess=main', args)
        self.assertIn('--property=TimeoutStopSec=infinity', args)
        self.assertIn('--wait', args)
        self.assertFalse(any('RuntimeMaxSec' in value for value in args))
        self.assertEqual(spawn.call_args.kwargs['stdin'], 31)
        self.assertEqual(spawn.call_args.kwargs['stdout'], 32)
        self.assertEqual(spawn.call_args.kwargs['env'], deploy.CLEAN_ENV)
        self.assertNotIn(TOKEN, str(spawn.call_args))
        self.assertNotIn('DARTFLOW_DATABASE_URL', str(spawn.call_args))

    def test_cleanup_waits_for_exact_app_job_and_fails_closed_on_unreadable_jobs(self):
        calls = []
        def execute(job_output=b'', job_code=0):
            def fake(args, **options):
                calls.append(args)
                self.assertEqual(options['stdin'], subprocess.DEVNULL)
                if 'list-jobs' in args:
                    self.assertIn('--full', args)
                    return SimpleNamespace(returncode=job_code, stdout=job_output)
                return SimpleNamespace(returncode=3)
            return fake
        self.assertTrue(guardian.stop_builds(RUN, execute=execute()))
        self.assertFalse(guardian.stop_builds(RUN, execute=execute(b'123 dartflow-staging.service restart running\n')))
        self.assertTrue(guardian.stop_builds(RUN, execute=execute(b'123 other-dartflow-staging.service restart running\n')))
        self.assertFalse(guardian.stop_builds(RUN, execute=execute(b'123 dg-dartflow-staging-build-' + RUN.encode() + b'-build.service start waiting\n')))
        self.assertFalse(guardian.stop_builds(RUN, execute=execute(job_code=1)))
        self.assertFalse(guardian.stop_builds(RUN, execute=execute(b'not a trustworthy job table')))
        self.assertTrue(all(args[-1].startswith('dg-dartflow-staging-build-' + RUN) for args in calls if args[1] == 'stop'))
        self.assertFalse(any(args[1] == 'stop' and args[-1] == 'dartflow-staging.service' for args in calls))

    def test_guardian_cleanup_failure_keeps_holder_until_a_verified_stop(self):
        parent_r, parent_w = os.pipe()
        os.close(parent_w)
        attempts, messages, pauses = [], [], []
        def stop(run):
            attempts.append(run)
            return len(attempts) >= 3
        try:
            guardian.hold_until_done(parent_r, RUN, stop=stop, announce=messages.append, pause=pauses.append, finish=lambda: False)
        finally:
            os.close(parent_r)
        self.assertEqual(attempts, [RUN, RUN, RUN])
        self.assertEqual(pauses, [5, 5])
        self.assertIn('cleanup blocked', messages[1])
        self.assertIn('releasing deployment locks', messages[-1])

    def test_helper_sigkill_does_not_release_exact_ofd_before_long_build_stops(self):
        # Three sibling processes model the helper, independent guardian service
        # and builder cgroup. SCM_RIGHTS preserves the real OFD, like --pipe.
        # The test parent closes its received duplicates before killing helper;
        # the fake builder forks before any lock exists and never inherits one.
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'ROOT_UID', os.getuid()):
            global_path, site_path = Path(directory) / 'global', Path(directory) / 'site'
            transport_parent, transport_child = socket.socketpair()
            status_r, status_w = os.pipe()
            permit_r, permit_w = os.pipe()
            children, duplicate_fds = [], []
            build_pid = os.fork()
            if build_pid == 0:
                transport_parent.close()
                transport_child.close()
                for fd in [status_r, status_w, permit_r, permit_w]:
                    os.close(fd)
                while True:
                    signal.pause()
            children.append(build_pid)
            try:
                helper_pid = os.fork()
                if helper_pid == 0:
                    transport_parent.close()
                    for fd in [status_r, status_w, permit_r, permit_w]:
                        os.close(fd)
                    try:
                        with deploy.deployment_locks(global_path, site_path) as fds:
                            transport_child.sendmsg([b'L'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', fds))])
                            transport_child.close()
                            while True:
                                signal.pause()
                    except BaseException:
                        os._exit(9)
                children.append(helper_pid)
                transport_child.close()
                ready, _, _ = select.select([transport_parent], [], [], 5)
                self.assertTrue(ready, 'helper did not send lock descriptors')
                data, ancillary, flags, address = transport_parent.recvmsg(1, socket.CMSG_SPACE(8))
                self.assertEqual(data, b'L')
                for level, kind, body in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        values = array.array('i')
                        values.frombytes(body[:len(body) - len(body) % values.itemsize])
                        duplicate_fds.extend(values)
                self.assertEqual(len(duplicate_fds), 2)
                self.assertEqual(os.fstat(duplicate_fds[0]).st_ino, global_path.stat().st_ino)
                guard_pid = os.fork()
                if guard_pid == 0:
                    transport_parent.close()
                    os.close(status_r)
                    os.close(permit_w)
                    try:
                        parent_fd, builder_fd = os.pidfd_open(helper_pid), os.pidfd_open(build_pid)
                        def announce(message):
                            if message.startswith('READY=1'):
                                os.write(status_w, b'R')
                            elif 'releasing deployment locks' in message:
                                os.write(status_w, b'D')
                        def stop(run):
                            os.write(status_w, b'C')
                            if os.read(permit_r, 1) != b'1':
                                return False
                            os.kill(build_pid, signal.SIGTERM)
                            ready, _, _ = select.select([builder_fd], [], [], 3)
                            return bool(ready)
                        guardian.hold_until_done(parent_fd, RUN, stop=stop, announce=announce, pause=lambda _: None, finish=lambda: False)
                        os.close(parent_fd)
                        os.close(builder_fd)
                        for fd in duplicate_fds:
                            os.close(fd)
                        os._exit(0)
                    except BaseException:
                        os._exit(8)
                children.append(guard_pid)
                # No parent-owned duplicate may mask a missing guardian hold.
                for fd in duplicate_fds:
                    os.close(fd)
                duplicate_fds.clear()
                os.close(status_w)
                status_w = None
                os.close(permit_r)
                permit_r = None
                def read_status(expected):
                    ready, _, _ = select.select([status_r], [], [], 5)
                    self.assertTrue(ready, 'guardian readiness/cleanup deadline expired')
                    self.assertEqual(os.read(status_r, 1), expected)
                read_status(b'R')
                os.kill(helper_pid, signal.SIGKILL)
                _, exit_status = os.waitpid(helper_pid, 0)
                children.remove(helper_pid)
                self.assertEqual(os.waitstatus_to_exitcode(exit_status), -signal.SIGKILL)
                read_status(b'C')
                os.kill(build_pid, 0)  # The simulated long build still exists.
                for path, shared in [(global_path, True), (site_path, False)]:
                    with self.assertRaises(deploy.LockBusy):
                        fd = deploy.open_lock(path, shared=shared)
                        os.close(fd)
                os.write(permit_w, b'1')
                read_status(b'D')
                _, guard_status = os.waitpid(guard_pid, 0)
                children.remove(guard_pid)
                self.assertEqual(os.waitstatus_to_exitcode(guard_status), 0)
                _, build_status = os.waitpid(build_pid, 0)
                children.remove(build_pid)
                self.assertEqual(os.waitstatus_to_exitcode(build_status), -signal.SIGTERM)
                with deploy.deployment_locks(global_path, site_path):
                    pass
            finally:
                for fd in duplicate_fds:
                    os.close(fd)
                for pid in children:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    os.waitpid(pid, 0)
                transport_parent.close()
                transport_child.close()
                for fd in [status_r, status_w, permit_r, permit_w]:
                    if fd is not None:
                        os.close(fd)


class DelayedTrustedClient(unittest.TestCase):
    def test_delayed_client_exec_keeps_both_locks_after_helper_kill_but_builder_has_neither(self):
        self.exercise_delayed_client('build')

    def test_delayed_synchronous_app_client_keeps_both_locks_until_app_job_finishes(self):
        self.exercise_delayed_client('app')

    def exercise_delayed_client(self, kind):
        # Real exec/pass_fds models the reviewed v255 systemd-run client. Builder
        # launch is deliberately delayed until AFTER the original helper is dead.
        builder_script = """import os,sys
status,end,global_dev,global_ino,site_dev,site_ino=map(int,sys.argv[1:7])
for name in os.listdir('/proc/self/fd'):
 try: item=os.fstat(int(name))
 except OSError: continue
 assert (item.st_dev,item.st_ino) not in [(global_dev,global_ino),(site_dev,site_ino)]
os.write(status,sys.argv[7].encode())
assert os.read(end,1)==b'1'
"""
        client_script = """import os,subprocess,sys
status,start,end=map(int,sys.argv[1:4])
lock_fds=list(map(int,sys.argv[4:6]))
identities=[]
for fd in lock_fds:
 item=os.fstat(fd);identities.extend([item.st_dev,item.st_ino])
os.write(status,b'R')
assert os.read(start,1)==b'1'
result=subprocess.run([sys.executable,'-I','-c',sys.argv[6],str(status),str(end),*map(str,identities),sys.argv[7]],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin'},pass_fds=(status,end),close_fds=True)
assert result.returncode==0
os.write(status,b'D')
"""
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'ROOT_UID', os.getuid()):
            global_path, site_path = Path(directory) / 'global', Path(directory) / 'site'
            transport_parent, transport_child = socket.socketpair()
            status_r, status_w = os.pipe()
            start_r, start_w = os.pipe()
            end_r, end_w = os.pipe()
            helper_pid, client, duplicates = None, None, []
            try:
                helper_pid = os.fork()
                if helper_pid == 0:
                    transport_parent.close()
                    for fd in [status_r, status_w, start_r, start_w, end_r, end_w]:
                        os.close(fd)
                    try:
                        with deploy.deployment_locks(global_path, site_path) as locks:
                            transport_child.sendmsg([b'L'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', locks))])
                            transport_child.close()
                            while True:
                                signal.pause()
                    except BaseException:
                        os._exit(9)
                transport_child.close()
                readable, _, _ = select.select([transport_parent], [], [], 5)
                self.assertTrue(readable)
                _, ancillary, _, _ = transport_parent.recvmsg(1, socket.CMSG_SPACE(8))
                for level, kind, body in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        descriptors = array.array('i')
                        descriptors.frombytes(body[:len(body) - len(body) % descriptors.itemsize])
                        duplicates.extend(descriptors)
                self.assertEqual(len(duplicates), 2)
                client = subprocess.Popen([sys.executable, '-I', '-c', client_script, str(status_w), str(start_r), str(end_r), *map(str, duplicates), builder_script, 'A' if kind == 'app' else 'B'], pass_fds=(*duplicates, status_w, start_r, end_r), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env={'PATH': '/usr/bin:/bin'}, close_fds=True)
                for fd in duplicates:
                    os.close(fd)
                duplicates.clear()
                for fd in [status_w, start_r, end_r]:
                    os.close(fd)
                status_w = start_r = end_r = None
                def status(expected):
                    readable, _, _ = select.select([status_r], [], [], 5)
                    self.assertTrue(readable, 'trusted client/builder deadline expired')
                    self.assertEqual(os.read(status_r, 1), expected)
                def both_busy():
                    for path, shared in [(global_path, True), (site_path, False)]:
                        with self.assertRaises(deploy.LockBusy):
                            fd = deploy.open_lock(path, shared=shared)
                            os.close(fd)
                status(b'R')
                os.kill(helper_pid, signal.SIGKILL)
                _, result = os.waitpid(helper_pid, 0)
                helper_pid = None
                self.assertEqual(os.waitstatus_to_exitcode(result), -signal.SIGKILL)
                both_busy()  # No builder exists yet; only the exec'd client holds the locks.
                os.write(start_w, b'1')
                status(b'A' if kind == 'app' else b'B')  # The actual job process inspected its FDs and found neither lock.
                both_busy()
                os.write(end_w, b'1')
                status(b'D')
                self.assertEqual(client.wait(timeout=5), 0, client.stderr.read())
                with deploy.deployment_locks(global_path, site_path):
                    pass
            finally:
                for fd in duplicates:
                    os.close(fd)
                if helper_pid is not None:
                    try:
                        os.kill(helper_pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    os.waitpid(helper_pid, 0)
                for fd in [status_r, status_w, start_r, start_w, end_r, end_w]:
                    if fd is not None:
                        os.close(fd)
                if client is not None:
                    if client.poll() is None:
                        client.kill()
                        client.wait(timeout=5)
                    client.stderr.close()
                transport_parent.close()
                transport_child.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
