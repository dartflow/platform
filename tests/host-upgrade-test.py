"""Offline tests for the privileged v15 operator boundary; no host mutations."""
import importlib.util
import hashlib
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

source=Path(__file__).resolve().parents[1]/'infra/upgrade-v15-host.py'
spec=importlib.util.spec_from_file_location('v15_operator_upgrade',source)
upgrade=importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)

class HostUpgradeBoundary(unittest.TestCase):
    def test_public_temporary_tree_is_never_a_reviewed_root_input(self):
        with tempfile.TemporaryDirectory() as directory:
            candidate=Path(directory)/'helper.py';candidate.write_text('raise Exception("untrusted")')
            with self.assertRaises(ValueError):upgrade.read_reviewed(candidate)
    def test_symlink_and_relative_render_paths_are_rejected(self):
        for value in ['relative/reviewed','/usr/bin/../bin/env']:
            with self.subTest(value=value),self.assertRaises(ValueError):upgrade.trusted_render_path(value)
        if Path('/bin').is_symlink():
            with self.assertRaises(ValueError):upgrade.trusted_render_path('/bin/env')
    def test_root_owned_regular_input_can_be_opened_but_is_bounded(self):
        candidate=Path('/usr/bin/env')
        if not candidate.is_file() or candidate.is_symlink() or candidate.stat().st_uid!=0:self.skipTest('Requires a standard root-owned public executable')
        self.assertEqual(upgrade.read_reviewed(candidate),candidate.read_bytes())
        with self.assertRaises(ValueError):upgrade.read_reviewed(candidate,10)
    def test_group_writable_or_foreign_owned_reviewed_input_is_refused(self):
        original=Path.lstat
        for uid,mode in [(12345,stat.S_IFDIR|0o755),(0,stat.S_IFDIR|0o775)]:
            def changed(path,uid=uid,mode=mode):
                if path==Path('/usr'):return type('UnsafeStat',(),{'st_uid':uid,'st_mode':mode})()
                return original(path)
            with self.subTest(uid=uid,mode=mode),patch.object(Path,'lstat',changed),self.assertRaises(ValueError):upgrade.read_reviewed('/usr/bin/env')
    def test_mail_tick_allows_the_bounded_ten_item_provider_batch_to_finish(self):
        written={}
        with patch.object(upgrade,'atomic',lambda path,content,mode=0o600:written.__setitem__(str(path),content)):
            upgrade.install_mail_tick()
        script=written['/usr/local/libexec/dartflow-mail-tick.py']
        self.assertIn('urlopen(req,timeout=160)',script)
        for env in ['staging','production']:
            unit=written[f'/etc/systemd/system/dartflow-mail-{env}.service']
            self.assertIn('TimeoutStartSec=175',unit)
            self.assertIn('IPAddressDeny=any',unit)
            self.assertIn('IPAddressAllow=localhost',unit)
        self.assertNotIn('https://',script)

    def extractor_fixture(self):
        files={};reviewed={};old=b'# reviewed previous extractor\n';candidate=b'# reviewed corrected extractor\n'
        for env,(_,ref,port,_,_) in upgrade.SITES.items():
            path=upgrade.EXTRACTORS[env]
            files[path]=old
            files[f'/etc/dg-sites/dartflow-{env}/deploy.json']=json.dumps({'repository':'dartflow/platform','backend':{'projectRef':ref},'port':port,'extractorSha256':hashlib.sha256(old).hexdigest(),'allowedConfigIds':[env+'-preserved'],'guardianSha256':'unchanged'}).encode()
            reviewed[env]={path:candidate}
        return files,reviewed

    def test_directed_extractor_repair_preflights_both_policies_and_dry_run_never_writes(self):
        files,reviewed=self.extractor_fixture()
        with patch.object(upgrade,'read_reviewed',lambda path,maximum=524288:files[str(path)]),patch.object(upgrade,'atomic') as write:
            self.assertFalse(upgrade.update_extractors(reviewed)['changesApplied']);write.assert_not_called()
            files[upgrade.EXTRACTORS['production']]=b'drifted installed source'
            with self.assertRaisesRegex(ValueError,'differs from its protected policy'):upgrade.update_extractors(reviewed,True)
            write.assert_not_called()

    def test_directed_extractor_repair_changes_only_sources_and_digest_then_is_idempotent(self):
        files,reviewed=self.extractor_fixture();prior=dict(files)
        def write(path,content,mode=0o600):files[str(path)]=content.encode() if isinstance(content,str) else content
        with tempfile.TemporaryDirectory() as directory,patch.object(upgrade,'BACKUPS',Path(directory)),patch.object(upgrade,'trusted_render_path',side_effect=lambda path,directory=False:Path(path)),patch.object(upgrade,'read_reviewed',lambda path,maximum=524288:files[str(path)]),patch.object(upgrade,'atomic',side_effect=write):
            report=upgrade.update_extractors(reviewed,True);self.assertTrue(report['changesApplied'])
            self.assertFalse(upgrade.update_extractors(reviewed,True)['changesApplied'])
        for env,path in upgrade.EXTRACTORS.items():
            self.assertEqual(files[path],reviewed[env][path]);policy_path=f'/etc/dg-sites/dartflow-{env}/deploy.json'
            before=json.loads(prior[policy_path]);after=json.loads(files[policy_path]);before['extractorSha256']=hashlib.sha256(reviewed[env][path]).hexdigest();self.assertEqual(after,before)

    def test_directed_extractor_repair_restores_both_pairs_if_policy_install_fails(self):
        files,reviewed=self.extractor_fixture();prior=dict(files);failed=False
        def write(path,content,mode=0o600):
            nonlocal failed
            if str(path)=='/etc/dg-sites/dartflow-production/deploy.json' and not failed:
                failed=True;raise OSError('Synthetic atomic policy write failed')
            files[str(path)]=content.encode() if isinstance(content,str) else content
        with tempfile.TemporaryDirectory() as directory,patch.object(upgrade,'BACKUPS',Path(directory)),patch.object(upgrade,'trusted_render_path',side_effect=lambda path,directory=False:Path(path)),patch.object(upgrade,'read_reviewed',lambda path,maximum=524288:files[str(path)]),patch.object(upgrade,'atomic',side_effect=write):
            with self.assertRaisesRegex(OSError,'Synthetic atomic'):upgrade.update_extractors(reviewed,True)
        for path,content in prior.items():self.assertEqual(files[path],content)

if __name__=='__main__':unittest.main()
