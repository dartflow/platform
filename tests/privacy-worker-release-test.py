"""Local synthetic code trees only: no service, host, credentials or app runs."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('privacy_release', Path(__file__).resolve().parents[1] / 'infra/privacy-worker-release.py')
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)
ONE = 'a' * 12 + '-123-1'
TWO = 'b' * 12 + '-124-1'


class PrivacyCodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.sites = self.base / 'sites';self.sites.mkdir()
        self.code = self.base / 'code'
        self.owner = patch.object(privacy, 'OWNER_UID', os.getuid());self.owner.start();self.addCleanup(self.owner.stop)
        for name, value in [('SITES_ROOT', self.sites), ('CODE_ROOT', self.code)]:
            patcher=patch.object(privacy,name,value);patcher.start();self.addCleanup(patcher.stop)
        # The shared /tmp ancestor is outside our synthetic protected host tree.
        # Keep the exact real owner/mode checks for every directory inside it.
        def ancestors(path):
            path=Path(path);self.assertTrue(path.is_relative_to(self.base))
            for parent in reversed((path,*[p for p in path.parents if p.is_relative_to(self.base)])):
                privacy.protected_info(parent,directory=True)
        patcher=patch.object(privacy,'protected_ancestors',side_effect=ancestors);patcher.start();self.addCleanup(patcher.stop)
        self.site=self.sites/'dartflow-staging';(self.site/'releases').mkdir(parents=True)
        self.release=self.make_release(ONE)
        (self.site/'current').symlink_to('releases/'+ONE)

    def make_release(self,name):
        release=self.site/'releases'/name;release.mkdir(mode=0o750)
        (release/privacy.WORKER).write_bytes(b'// synthetic worker: copying must never execute this file\n');(release/privacy.WORKER).chmod(0o440)
        modules=release/'node_modules';(modules/'pg').mkdir(parents=True)
        (modules/'pg'/'index.js').write_bytes(b'// synthetic dependency\n');(modules/'pg'/'index.js').chmod(0o440)
        (modules/'alias').symlink_to('pg')
        # These root-only release files are intentionally outside the copied roots.
        (release/'.runtime.env').symlink_to(self.base/'credential-canary.env')
        (release/'.release.env').write_bytes(b'synthetic metadata that must not be copied')
        (release/'server.js').write_bytes(b'synthetic web server that must not be copied')
        (release/'.next').mkdir();(release/'.next'/'server').mkdir()
        return release

    def target(self,name=ONE):return self.code/'staging'/name

    def point(self,name):
        (self.site/'current').unlink();(self.site/'current').symlink_to('releases/'+name)

    def test_copies_only_worker_and_dependencies_with_unprivileged_readonly_permissions(self):
        result=privacy.materialize('staging');target=self.target()
        self.assertFalse(result['reused']);self.assertFalse(result['credentialsRead']);self.assertFalse(result['appCodeExecuted'])
        self.assertEqual(set(p.name for p in target.iterdir()),{privacy.WORKER,'node_modules',privacy.MANIFEST})
        self.assertEqual((target/privacy.WORKER).read_bytes(),(self.release/privacy.WORKER).read_bytes())
        self.assertTrue((target/'node_modules'/'alias').is_symlink())
        self.assertEqual((target/'node_modules'/'alias'/'index.js').read_bytes(),b'// synthetic dependency\n')
        self.assertEqual(os.readlink(self.code/'staging'/'current'),ONE)
        for directory in [self.code,self.code/'staging',target,target/'node_modules',target/'node_modules'/'pg']:
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode),0o755)
        for file in [target/privacy.WORKER,target/'node_modules'/'pg'/'index.js',target/privacy.MANIFEST]:
            self.assertEqual(stat.S_IMODE(file.stat().st_mode),0o644)
        self.assertFalse((target/'.runtime.env').exists());self.assertFalse((target/'server.js').exists());self.assertFalse((target/'.next').exists())

    def test_reuses_same_immutable_generation_without_copying_again(self):
        privacy.materialize('staging')
        with patch.object(privacy,'copy_regular',side_effect=AssertionError('must not recopy')):
            self.assertTrue(privacy.materialize('staging')['reused'])

    def test_existing_readonly_code_parent_requires_no_mkdir_or_chmod(self):
        privacy.materialize('staging')
        original_mkdir,original_chmod=Path.mkdir,Path.chmod
        def mkdir(path,*args,**kwargs):
            if path==self.code:raise OSError('synthetic read-only code parent')
            return original_mkdir(path,*args,**kwargs)
        def chmod(path,*args,**kwargs):
            if path==self.code:raise OSError('synthetic read-only code parent')
            return original_chmod(path,*args,**kwargs)
        with patch.object(Path,'mkdir',new=mkdir),patch.object(Path,'chmod',new=chmod):
            self.assertTrue(privacy.materialize('staging')['reused'])

    def test_target_tamper_or_changed_source_identity_is_rejected_on_reuse(self):
        privacy.materialize('staging');worker=self.target()/privacy.WORKER
        original=worker.read_bytes();worker.write_bytes(b'x'*len(original))
        with self.assertRaises(RuntimeError):privacy.materialize('staging')
        worker.write_bytes(original)
        source=self.release/privacy.WORKER;source.chmod(0o640);source.write_bytes(b'y'*len(original));source.chmod(0o440)
        with self.assertRaises(RuntimeError):privacy.materialize('staging')
        self.assertEqual(os.readlink(self.code/'staging'/'current'),ONE)

    def test_writable_source_and_destination_directories_fail_closed(self):
        dependency=self.release/'node_modules'/'pg'/'index.js';dependency.chmod(0o666)
        with self.assertRaises(RuntimeError):privacy.materialize('staging')
        dependency.chmod(0o440);privacy.materialize('staging');self.target().chmod(0o777)
        with self.assertRaises(RuntimeError):privacy.materialize('staging')

    def test_dependency_env_files_are_denied_without_reading_them(self):
        forbidden=self.release/'node_modules'/'pg'/'.env.local';forbidden.write_bytes(b'synthetic-secret-canary')
        original_open=privacy.os.open
        def guarded_open(path,*args,**kwargs):
            self.assertNotEqual(Path(path),forbidden);return original_open(path,*args,**kwargs)
        with patch.object(privacy.os,'open',side_effect=guarded_open),self.assertRaises(RuntimeError):privacy.materialize('staging')
        self.assertFalse(self.code.exists())

    def test_symlinks_to_credentials_other_release_or_absolute_paths_are_denied(self):
        link=self.release/'node_modules'/'leak'
        for target in ['../.runtime.env','../../../../other-environment.env',str(self.release/'node_modules'/'pg')]:
            with self.subTest(target=target):
                link.symlink_to(target)
                with self.assertRaises((RuntimeError,OSError)):privacy.materialize('staging')
                link.unlink()
        self.assertFalse(self.code.exists())

    def test_special_or_hardlinked_source_files_are_denied_before_open(self):
        path=self.release/'node_modules'/'pipe';os.mkfifo(path)
        with self.assertRaises(RuntimeError):privacy.materialize('staging')
        path.unlink();os.link(self.release/privacy.WORKER,path)
        with self.assertRaises(RuntimeError):privacy.materialize('staging')

    def test_copy_failure_keeps_previous_current_and_cleans_unpublished_partial_generation(self):
        privacy.materialize('staging');self.make_release(TWO);self.point(TWO)
        original=privacy.copy_regular
        def failing(source,target,size):
            if source.name=='index.js':raise OSError('synthetic disk failure')
            return original(source,target,size)
        with patch.object(privacy,'copy_regular',side_effect=failing),self.assertRaises(OSError):privacy.materialize('staging')
        self.assertEqual(os.readlink(self.code/'staging'/'current'),ONE)
        self.assertFalse(self.target(TWO).exists())
        self.assertFalse(any(p.name.startswith('.pending-') for p in (self.code/'staging').iterdir()))

    def test_atomic_publish_failure_preserves_previous_link_and_complete_generation_can_retry(self):
        privacy.materialize('staging');self.make_release(TWO);self.point(TWO)
        with patch.object(privacy.os,'replace',side_effect=OSError('synthetic rename failure')),self.assertRaises(OSError):privacy.materialize('staging')
        self.assertEqual(os.readlink(self.code/'staging'/'current'),ONE)
        self.assertTrue(self.target(TWO).is_dir())
        self.assertFalse(any(p.name.startswith('.current-') for p in (self.code/'staging').iterdir()))
        with patch.object(privacy,'copy_regular',side_effect=AssertionError('must not recopy')):
            self.assertTrue(privacy.materialize('staging')['reused'])
        self.assertEqual(os.readlink(self.code/'staging'/'current'),TWO)

    def test_unexpected_files_in_existing_generation_are_not_exposed_by_reuse(self):
        privacy.materialize('staging');(self.target()/'.env').write_text('synthetic unexpected file')
        with self.assertRaises(RuntimeError):privacy.materialize('staging')

    def test_source_current_and_destination_current_cannot_escape_fixed_environment(self):
        for target in ['/other/release','releases/'+ONE+'/../'+TWO]:
            (self.site/'current').unlink();(self.site/'current').symlink_to(target)
            with self.assertRaises(RuntimeError):privacy.materialize('staging')
        self.point(ONE);privacy.materialize('staging')
        (self.code/'staging'/'current').unlink();(self.code/'staging'/'current').symlink_to('../production/'+ONE)
        with self.assertRaises(RuntimeError):privacy.materialize('staging')
        with self.assertRaises(RuntimeError):privacy.materialize('unknown')

    def test_wrong_owner_or_source_activation_race_cannot_publish(self):
        with patch.object(privacy,'OWNER_UID',os.getuid()+1),self.assertRaises(RuntimeError):privacy.materialize('staging')
        privacy.materialize('staging');self.make_release(TWO);self.point(TWO)
        original=privacy.copy_regular
        def switch(source,target,size):
            result=original(source,target,size);self.point(ONE);return result
        with patch.object(privacy,'copy_regular',side_effect=switch),self.assertRaises(RuntimeError):privacy.materialize('staging')
        self.assertEqual(os.readlink(self.code/'staging'/'current'),ONE)

    def test_source_budgets_are_enforced_before_any_public_copy(self):
        for setting,value in [('MAX_BYTES',1),('MAX_FILE_BYTES',1),('MAX_ENTRIES',1),('MAX_DEPTH',1)]:
            with self.subTest(setting=setting),patch.object(privacy,setting,value),self.assertRaises(RuntimeError):privacy.materialize('staging')
        self.assertFalse(self.code.exists())


if __name__=='__main__':unittest.main()
