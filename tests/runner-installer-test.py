#!/usr/bin/python3 -I
"""Offline bootstrap contract tests: no registration, download or systemd calls."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('runner_installer', ROOT / 'infra/install-runners.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def archive(extra=()):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w:gz') as output:
        for name, kind, target in [
            ('config.sh', 'file', b'#!/bin/sh\n'),
            ('bin/runsvc.sh', 'file', b'#!/bin/sh\nexec ./bin/Runner.Listener\n'),
            ('bin/Runner.Listener', 'file', b'fixture'),
            *extra,
        ]:
            member = tarfile.TarInfo(name)
            member.mode = 0o755
            if kind == 'file':
                member.size = len(target)
                output.addfile(member, io.BytesIO(target))
            else:
                member.type = {'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE, 'fifo': tarfile.FIFOTYPE}[kind]
                member.linkname = target
                output.addfile(member)
    result.seek(0)
    return result


class RunnerInstallerTests(unittest.TestCase):
    def test_input_exact_keys_and_secret_safe_errors(self):
        tokens = {'stagingToken': 'fixture-staging-token', 'productionToken': 'fixture-production-token'}
        self.assertEqual(installer.read_tokens(io.BytesIO(json.dumps(tokens).encode())), tokens)
        invalid = [b'{}', b'{"stagingToken":"secret-secret","stagingToken":"x"}', b'x' * 16385,
                   json.dumps({**tokens, 'replacement': True}).encode(), json.dumps({**tokens, 'stagingToken': 'bad\nsecret'}).encode()]
        for body in invalid:
            with self.subTest(body_length=len(body)), self.assertRaises(installer.Refused) as caught:
                installer.read_tokens(io.BytesIO(body))
            self.assertNotIn('fixture-', str(caught.exception))
            self.assertNotIn('secret-secret', str(caught.exception))

    def test_official_layout_requires_bin_service(self):
        self.assertEqual(installer.validate_archive(archive())['entries'], 3)

    def test_refuses_traversal_specials_and_duplicates(self):
        for entry in [('../escape', 'file', b'x'), ('/absolute', 'file', b'x'),
                      ('config.sh', 'file', b'x'), ('fifo', 'fifo', ''),
                      ('hard', 'hardlink', 'config.sh'), ('bad\\path', 'file', b'x')]:
            with self.subTest(entry=entry[0]), self.assertRaises(installer.Refused):
                installer.validate_archive(archive([entry]))

    def test_refuses_symlink_escape_cycle_and_child_write(self):
        fixtures = [
            [('escape', 'symlink', '../outside')],
            [('a', 'symlink', 'b'), ('b', 'symlink', 'a')],
            [('a', 'symlink', 'bin'), ('a/child', 'file', b'x')],
            [('a', 'symlink', 'bin/../../outside')],
        ]
        for fixture in fixtures:
            with self.subTest(fixture=fixture), self.assertRaises(installer.Refused):
                installer.validate_archive(archive(fixture))

    def test_safe_internal_link_allowed(self):
        self.assertEqual(installer.validate_archive(archive([('alias', 'symlink', 'bin/Runner.Listener')]))['entries'], 4)

    def test_extractor_copies_service_as_current_unprivileged_user(self):
        # EXTRACT is exercised in a disposable directory, never against runner homes.
        payload = archive()
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['/usr/bin/python3', '-I', '-c', installer.EXTRACT], cwd=directory, input=payload.read(), capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            top = Path(directory) / 'runsvc.sh'
            self.assertEqual(top.read_bytes(), (Path(directory) / 'bin/runsvc.sh').read_bytes())
            self.assertEqual(top.stat().st_uid, os.getuid())
            self.assertEqual(top.stat().st_mode & 0o777, 0o700)

    def test_units_use_fixed_unprivileged_accounts(self):
        for scope in installer.SPECS:
            directory = Path('/home') / scope['account'] / 'actions-runner'
            text = installer.unit_text(scope, directory)
            self.assertIn('User=' + scope['account'] + '\n', text)
            self.assertIn('Group=' + scope['account'] + '\n', text)
            self.assertIn('ExecStart=' + str(directory) + '/runsvc.sh\n', text)
            self.assertNotIn('svc.sh install', text)
            self.assertNotIn('User=root', text)

    def test_registration_reuse_requires_exact_repo_identity_and_credentials(self):
        scope = installer.SPECS[0]
        settings = {'agentId': 42, 'agentName': scope['name'], 'gitHubUrl': installer.REPOSITORY, 'workFolder': '_work', 'disableUpdate': True}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['.credentials', '.credentials_rsaparams']:
                (root / name).write_text('fixture-no-secret')
                (root / name).chmod(0o600)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                person = SimpleNamespace(pw_uid=os.getuid())
                (root / '.runner').write_text(json.dumps(settings))
                self.assertEqual(installer.registered_settings(fd, person, scope)['agentid'], 42)
                for changed in [{**settings, 'gitHubUrl': 'https://github.com/other/repo'}, {**settings, 'disableUpdate': False}, {**settings, 'agentName': 'other'}]:
                    (root / '.runner').write_text(json.dumps(changed))
                    with self.assertRaises(installer.Refused):
                        installer.registered_settings(fd, person, scope)
                (root / '.runner').write_text(json.dumps(settings))
                (root / '.service').write_text('another.service')
                with self.assertRaises(installer.Refused):
                    installer.registered_settings(fd, person, scope)
            finally:
                os.close(fd)


if __name__ == '__main__':
    unittest.main()
