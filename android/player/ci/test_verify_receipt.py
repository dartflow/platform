import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
spec=importlib.util.spec_from_file_location('receipt',Path(__file__).with_name('verify_receipt.py'))
receipt=importlib.util.module_from_spec(spec);spec.loader.exec_module(receipt)

class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.bundle=Path(self.tmp.name)/'app-production-release.aab'
        with zipfile.ZipFile(self.bundle,'w') as z:
            z.writestr('base/manifest/AndroidManifest.xml',b'synthetic manifest');z.writestr('BundleConfig.pb',b'synthetic config')
        self.sha='a'*40;self.digest=hashlib.sha256(self.bundle.read_bytes()).hexdigest()
        self.data={'schemaVersion':1,'package':'nl.dartflow.app','versionName':'0.1.1','versionCode':2,'sourceCommit':self.sha,'uploadCertificateSha256':receipt.UPLOAD_CERTIFICATE,'artifacts':[{'file':self.bundle.name,'sha256':self.digest,'bytes':self.bundle.stat().st_size}]}
    def check(self,data=None,**kwargs):return receipt.validate(data or self.data,kwargs.get('source',self.sha),kwargs.get('digest',self.digest),kwargs.get('code',2),kwargs.get('tag','android-player-0.1.1-2'),self.bundle)
    def test_exact_bundle(self):self.assertEqual(self.check()['bundleSha256'],self.digest)
    def test_rejects_wrong_package_source_version_certificate_and_tag(self):
        for key,value in [('package','nl.dartflow.ochelive'),('package','nl.dartflow.app.staging'),('sourceCommit','b'*40),('versionCode',3),('versionCode',True),('uploadCertificateSha256','A1'),('versionName','../unsafe')]:
            with self.subTest(key=key,value=value):
                data=copy.deepcopy(self.data);data[key]=value
                with self.assertRaises(ValueError):self.check(data)
        with self.assertRaises(ValueError):self.check(tag='android-player-0.1.1-3')
    def test_rejects_changed_bytes_or_receipt_and_duplicate_entries(self):
        data=copy.deepcopy(self.data);data['artifacts'].append(data['artifacts'][0])
        with self.assertRaises(ValueError):self.check(data)
        with self.assertRaises(ValueError):self.check(digest='b'*64)
        self.bundle.write_bytes(self.bundle.read_bytes()+b'changed')
        with self.assertRaises(ValueError):self.check()
    def test_rejects_symlink(self):
        original=self.bundle.with_suffix('.original');self.bundle.rename(original);self.bundle.symlink_to(original)
        with self.assertRaises(ValueError):self.check()
if __name__=='__main__':unittest.main()
