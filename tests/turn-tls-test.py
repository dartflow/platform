"""Offline regression checks; no SSH, certificate store or service is contacted."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('turn_tls',Path(__file__).resolve().parents[1]/'infra/provision-turn-tls.py')
tls=importlib.util.module_from_spec(spec);spec.loader.exec_module(tls)

FIXTURE=b'''listening-port=3478
listening-ip=192.0.2.1
min-port=49160
max-port=49179
realm=dartflow-staging
use-auth-secret
static-auth-secret=synthetic-fixture-not-a-real-secret
no-tls
no-tcp-relay
denied-peer-ip=127.0.0.0-127.255.255.255
'''

class TurnTlsTests(unittest.TestCase):
    def test_same_port_tls_only_tcp_preserves_udp_auth_and_relay_isolation(self):
        result=tls.tls_config(FIXTURE,'staging');parsed=tls.settings(result)
        self.assertEqual(parsed['listening-port'],['3478']);self.assertEqual(parsed['tls-listening-port'],['3478'])
        self.assertEqual(parsed['no-tcp'],['true']);self.assertEqual(parsed['no-dtls'],['true'])
        self.assertNotIn('no-tls',parsed);self.assertNotIn('no-udp',parsed)
        for key in ['min-port','max-port','realm','static-auth-secret','denied-peer-ip','no-tcp-relay']:
            self.assertEqual(parsed[key],tls.settings(FIXTURE)[key])
        self.assertEqual(tls.tls_config(result,'staging'),result)
        self.assertIn('/run/credentials/dg-turn-staging.service/turn.key',result.decode())

    def test_wrong_environment_or_disabled_udp_cannot_be_silently_reconfigured(self):
        for value in [FIXTURE.replace(b'3478',b'3479'),FIXTURE+b'no-udp\n',FIXTURE.replace(b'use-auth-secret',b'no-auth'),FIXTURE+b'static-auth-secret=other\n']:
            with self.subTest(value=value),self.assertRaises(RuntimeError):tls.tls_config(value,'staging')
        with self.assertRaises(KeyError):tls.tls_config(FIXTURE,'unknown')

    def test_credentials_are_loaded_by_systemd_without_caddy_access_or_fixed_service_uid(self):
        content=tls.dropin('staging',Path('/root-owned/generation')).decode()
        self.assertIn('LoadCredential=turn.crt:/root-owned/generation/fullchain.pem',content)
        self.assertIn('LoadCredential=turn.key:/root-owned/generation/privkey.pem',content)
        self.assertNotIn('/var/lib/caddy',content);self.assertNotIn('User=',content)
        self.assertNotIn('ExecStart=',content);self.assertNotIn('production',content)

    def test_hourly_refresh_is_environment_bound_and_has_no_key_in_argv(self):
        service=tls.refresh_unit('staging').decode();timer=tls.refresh_timer('staging').decode()
        self.assertIn('User=root',service);self.assertIn('--refresh staging',service)
        self.assertIn('OnCalendar=hourly',timer);self.assertIn('Persistent=true',timer)
        self.assertNotIn('production',service+timer);self.assertNotIn('turn-secret',service+timer)

    def test_unsafe_file_types_or_writable_files_are_rejected_before_reading(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'fixture';path.write_bytes(b'synthetic');path.chmod(0o666)
            with self.assertRaises(RuntimeError):tls.read_protected(path,owner=path.stat().st_uid)
            path.chmod(0o600);link=Path(root)/'link';link.symlink_to(path)
            with self.assertRaises(RuntimeError):tls.read_protected(link,owner=path.stat().st_uid)

    def test_rollback_inventory_cannot_target_other_environment(self):
        with patch.object(tls,'read_protected',return_value=b'{"environment":"production","records":[]}'),patch.object(tls,'run') as runner:
            with self.assertRaises(RuntimeError):tls.rollback('staging')
            runner.assert_not_called()

    def test_protected_snapshot_restores_exact_config_and_removes_new_unit_files(self):
        with tempfile.TemporaryDirectory() as root:
            base=Path(root);config=base/'turn.conf';config.write_bytes(FIXTURE);config.chmod(0o600)
            paths=[config,base/'30-tls.conf',base/'refresh.service',base/'refresh.timer']
            other=base/'production.conf';other.write_bytes(b'unrelated-production-fixture')
            original_read=tls.read_protected
            def fixture_read(path,*_args,**kwargs):return original_read(path,owner=os.getuid(),max_bytes=kwargs.get('max_bytes',1048576))
            def fixture_directory(path):Path(path).mkdir(mode=0o700,parents=True,exist_ok=True)
            with patch.object(tls,'STATE',base/'state'),patch.object(tls,'BACKUPS',base/'backups'),patch.object(tls,'secure_directory',side_effect=fixture_directory),patch.object(tls,'read_protected',side_effect=fixture_read):
                records=tls.snapshot('staging',paths)
                for path in paths:tls.atomic(path,b'changed-fixture')
                tls.restore(records)
                self.assertEqual(config.read_bytes(),FIXTURE)
                self.assertEqual(config.stat().st_mode&0o777,0o600)
                self.assertTrue(all(not path.exists() for path in paths[1:]))
                self.assertEqual(other.read_bytes(),b'unrelated-production-fixture')

    def test_failed_atomic_replace_leaves_original_and_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'config';path.write_bytes(FIXTURE);path.chmod(0o600)
            original_read=tls.read_protected
            with patch.object(tls,'read_protected',side_effect=lambda p:original_read(p,owner=os.getuid())),patch.object(tls.os,'replace',side_effect=OSError('synthetic disk failure')):
                with self.assertRaises(OSError):tls.atomic(path,b'incomplete replacement')
            self.assertEqual(path.read_bytes(),FIXTURE)
            self.assertEqual([entry.name for entry in Path(root).iterdir()],['config'])

if __name__=='__main__':unittest.main()
