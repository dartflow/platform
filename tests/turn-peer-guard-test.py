"""Offline tests of the TURN host/environment boundary; never touches nft/SSH."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('turn_guard', Path(__file__).resolve().parents[1] / 'infra/turn-peer-guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
media_spec = importlib.util.spec_from_file_location('turn_provisioner', Path(__file__).resolve().parents[1] / 'infra/provision-media.py')
media = importlib.util.module_from_spec(media_spec)
media_spec.loader.exec_module(media)


def fixture(environment='staging', cgroup_id=4242):
    table, cgroup = guard.binding(environment)
    minimum, maximum = guard.SITES[environment]
    def match(left, right):
        return {'match': {'op': '==', 'left': left, 'right': right}}
    common = [match({'socket': {'key': 'cgroupv2'}}, cgroup_id),
              match({'payload': {'protocol': 'ip', 'field': 'daddr'}}, guard.PUBLIC_IP)]
    base = {'family': 'inet', 'table': table, 'chain': 'output'}
    document = {'nftables': [
        {'metainfo': {'json_schema_version': 1}},
        {'table': {'family': 'inet', 'name': table}},
        {'chain': {'family': 'inet', 'table': table, 'name': 'output', 'type': 'filter', 'hook': 'output', 'prio': -10, 'policy': 'accept'}},
        {'rule': {**base, 'comment': f'dg-turn-{environment}-own-relay-v1', 'expr': copy.deepcopy(common) + [
            match({'payload': {'protocol': 'udp', 'field': 'sport'}}, {'range': [minimum, maximum]}),
            match({'payload': {'protocol': 'udp', 'field': 'dport'}}, {'range': [minimum, maximum]}),
            {'counter': {'packets': 3, 'bytes': 300}}, {'accept': None}]}},
        {'rule': {**base, 'comment': f'dg-turn-{environment}-own-host-deny-v1', 'expr': copy.deepcopy(common) + [
            {'counter': {'packets': 5, 'bytes': 500}}, {'drop': None}]}}
    ]}
    text = guard.rules(environment, False).replace('counter accept', 'counter packets 3 bytes 300 accept').replace('counter drop', 'counter packets 5 bytes 500 drop')
    return document, text


class TurnPeerBoundary(unittest.TestCase):
    def test_only_exact_current_unified_environment_cgroup_can_apply(self):
        for environment in guard.SITES:
            path = guard.binding(environment)[1]
            self.assertEqual(guard.current_cgroup(environment, '0::' + path + '\n'), path)
            for content in ['0::/system.slice/other.service\n', '0::' + path + '/child\n', '1:name=systemd:' + path, '0::' + path + '\n0::' + path, '0::' + path.replace(environment, 'other')]:
                with self.subTest(environment=environment, content=content), self.assertRaises(ValueError):
                    guard.current_cgroup(environment, content)
        with self.assertRaises(ValueError):
            guard.rules('staging; flush ruleset', False)

    def test_real_v109_json_without_level_requires_independent_exact_text(self):
        for environment in guard.SITES:
            document, text = fixture(environment)
            proof = guard.inspect_document(environment, document, 4242, text)
            self.assertTrue(proof['serviceCgroupBound'])
            self.assertEqual(proof['blockedOwnIpCounter'], 5)
            self.assertEqual(proof['sourceRange'], list(guard.SITES[environment]))
            for altered in [text.replace('level 2', 'level 1'), text.replace('udp sport ', 'udp dport ', 1), text.replace('counter packets 5 bytes 500 drop', 'counter packets 5 bytes 500 accept')]:
                with self.subTest(environment=environment, altered=altered), self.assertRaises(ValueError):
                    guard.inspect_document(environment, document, 4242, altered)

    def test_changed_id_ports_extra_accept_and_other_environment_are_rejected(self):
        document, text = fixture()
        mutations = []
        wrong_id = copy.deepcopy(document); wrong_id['nftables'][3]['rule']['expr'][0]['match']['right'] = 4241; mutations.append(wrong_id)
        for position in [2, 3]:
            widened = copy.deepcopy(document); widened['nftables'][3]['rule']['expr'][position]['match']['right'] = {'range': [49160, 49199]}; mutations.append(widened)
        bypass = copy.deepcopy(document); bypass['nftables'].insert(3, copy.deepcopy(bypass['nftables'][3])); mutations.append(bypass)
        wrong_verdict = copy.deepcopy(document); wrong_verdict['nftables'][4]['rule']['expr'][-1] = {'accept': None}; mutations.append(wrong_verdict)
        for altered in mutations:
            with self.subTest(altered=altered), self.assertRaises(ValueError):
                guard.inspect_document('staging', altered, 4242, text)
        with self.assertRaises(ValueError):
            guard.inspect_document('production', document, 4242, text)

    def test_replace_is_one_checked_atomic_batch_only_for_own_table(self):
        calls = []
        listed = {'nftables': [{'table': {'family': 'inet', 'name': 'dartflow_turn_staging_guard'}}, {'table': {'family': 'inet', 'name': 'unrelated_app'}}]}
        def command(arguments, content=None):
            calls.append((arguments, content))
            return SimpleNamespace(stdout=json.dumps(listed))
        with patch.object(guard.Path, 'read_text', return_value='0::/system.slice/dg-turn-staging.service\n'), patch.object(guard, 'nft', side_effect=command), patch.object(guard, 'inspect', return_value={'installed': True}):
            guard.install('staging')
        self.assertEqual(calls[1][0], ['--check', '--file', '-'])
        self.assertEqual(calls[2][0], ['--file', '-'])
        self.assertEqual(calls[1][1], calls[2][1])
        batch = calls[2][1]
        self.assertTrue(batch.startswith('delete table inet dartflow_turn_staging_guard\ntable inet dartflow_turn_staging_guard'))
        self.assertNotIn('unrelated_app', batch)
        self.assertNotIn('production', batch)
        self.assertNotIn('flush ruleset', batch)

    def test_failed_nft_check_or_wrong_cgroup_never_applies(self):
        def check_fails(arguments, content=None):
            if '--check' in arguments:
                raise subprocess.CalledProcessError(1, arguments)
            return SimpleNamespace(stdout='{"nftables":[]}')
        with patch.object(guard.Path, 'read_text', return_value='0::/system.slice/dg-turn-staging.service\n'), patch.object(guard, 'nft', side_effect=check_fails) as command, self.assertRaises(subprocess.CalledProcessError):
            guard.install('staging')
        self.assertFalse(any(call.args[0] == ['--file', '-'] for call in command.call_args_list))
        with patch.object(guard.Path, 'read_text', return_value='0::/system.slice/other.service\n'), patch.object(guard, 'nft') as command, self.assertRaises(ValueError):
            guard.install('staging')
        command.assert_not_called()

    def test_cgroup_recreation_during_inspection_fails_closed(self):
        document, text = fixture()
        with patch.object(guard, 'cgroup_id', side_effect=[4242, 4243]), patch.object(guard, 'nft', side_effect=[SimpleNamespace(stdout=text), SimpleNamespace(stdout=json.dumps(document))]), self.assertRaisesRegex(ValueError, 'changed'):
            guard.inspect('staging')

    def test_provisioned_service_requires_root_prestart_and_keeps_private_boundary(self):
        written = {}
        with patch.object(media.Path, 'is_dir', return_value=True), patch.object(media.Path, 'is_symlink', return_value=False), patch.object(media.Path, 'stat', return_value=SimpleNamespace(st_uid=0)), patch.object(media.Path, 'exists', return_value=False), patch.object(media, 'protected_write', side_effect=lambda path, content, mode=0o600: written.__setitem__(str(path), content.decode())), patch.object(media, 'run'):
            for environment, ports in media.SITES.items():
                media.provision(environment, ports)
                unit = written[f'/etc/systemd/system/dg-turn-{environment}.service']
                config = written[f'/etc/dg-sites/dartflow-{environment}/turnserver.conf']
                self.assertIn(f'ExecStartPre=+/usr/local/libexec/dg-turn-peer-guard.py {environment}\n', unit)
                self.assertNotIn('ExecStartPre=-', unit)
                self.assertIn('DynamicUser=yes\n', unit)
                self.assertIn('RestrictAddressFamilies=AF_INET AF_UNIX\n', unit)
                self.assertIn('IPAddressDeny=::/0\n', unit)
                self.assertIn('no-tcp-relay\n', config)
                self.assertIn('denied-peer-ip=127.0.0.0-127.255.255.255\n', config)
                self.assertIn('denied-peer-ip=100.64.0.0-100.127.255.255\n', config)
                self.assertNotIn('denied-peer-ip=128.140.93.95\n', config)

    def test_existing_owned_legacy_services_stop_before_config_can_be_relaxed(self):
        calls = []
        def command(arguments, **kwargs):
            calls.append(arguments)
            return SimpleNamespace(stdout='loaded\n')
        with patch.object(media, 'run', side_effect=command):
            media.stop_owned_turn()
        self.assertEqual([args for args in calls if 'stop' in args], [
            ['/usr/bin/systemctl', 'stop', 'dg-turn-staging.service'],
            ['/usr/bin/systemctl', 'stop', 'dg-turn-production.service']])
        with patch.object(media, 'run', return_value=SimpleNamespace(stdout='masked\n')), self.assertRaises(RuntimeError):
            media.stop_owned_turn()


if __name__ == '__main__':
    unittest.main()
