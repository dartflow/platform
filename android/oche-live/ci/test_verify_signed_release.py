"""Offline regressions for exact Oche signing provenance; no publication credentials."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('oche_signed', Path(__file__).with_name('verify_signed_release.py'))
signed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signed)


class Provenance(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.bundle = Path(self.directory.name) / 'app-production-release.aab'
        with zipfile.ZipFile(self.bundle, 'w') as archive:
            archive.writestr('base/manifest/AndroidManifest.xml', 'fixture manifest')
            archive.writestr('BundleConfig.pb', 'fixture config')
        self.source, self.run_id, self.code, self.version = 'a' * 40, 45655080547, 1091, '1.5.0'
        self.receipt = signed.make_receipt(self.bundle, self.source, self.code, self.version, self.run_id, 91)
        self.digest = self.receipt['bundleSha256']
        self.run = {'id': self.run_id, 'run_number': 91, 'run_attempt': 1,
                    'path': '.github/workflows/oche-android-ci.yml', 'event': 'workflow_dispatch',
                    'head_sha': self.source, 'head_branch': 'main', 'head_repository': {'full_name': 'dartflow/platform'},
                    'status': 'completed', 'conclusion': 'success'}
        self.jobs = {'jobs': [{'name': name, 'run_id': self.run_id, 'head_sha': self.source,
                              'status': 'completed', 'conclusion': 'success'} for name in signed.REQUIRED_JOBS]}
        self.artifacts = {'artifacts': [{'name': name, 'expired': False, 'workflow_run': {'id': self.run_id,
                                         'head_sha': self.source, 'head_branch': 'main'}}
                                        for name in ('oche-signed-aab', 'oche-signing-receipt')]}
        self.release = {'tagName': 'oche-v1.5.0', 'targetCommitish': self.source, 'isDraft': False}
        self.rules = [{'target': 'tag', 'enforcement': 'active', 'bypass_actors': [],
                       'conditions': {'ref_name': {'include': ['refs/tags/oche-v*'], 'exclude': []}},
                       'rules': [{'type': 'update'}, {'type': 'deletion'}]}]

    def verify(self, **changes):
        data = dict(receipt=self.receipt, run=self.run, jobs=self.jobs, artifacts=self.artifacts,
                    release=self.release, rulesets=self.rules, bundle=self.bundle, source=self.source,
                    digest=self.digest, code=self.code, tag='oche-v1.5.0', run_id=self.run_id, version=self.version)
        data.update(changes)
        return signed.validate(**data)

    def test_exact_successful_native_source_and_artifact_are_accepted(self):
        self.assertEqual(self.verify(), self.receipt)
        self.assertEqual(self.receipt['package'], 'nl.dartflow.ochelive')
        self.assertEqual(self.receipt['requiredTests'], {'unitPerVariant': 44, 'uiPerTarget': 24, 'failures': 0, 'errors': 0, 'skipped': 0})

    def test_other_repository_source_branch_event_or_unfinished_run_is_rejected(self):
        for key, value in [('id', self.run_id + 1), ('head_sha', 'b' * 40), ('head_branch', 'feature'),
                           ('event', 'pull_request'), ('path', '.github/workflows/player-android-ci.yml'),
                           ('conclusion', 'failure'), ('status', 'in_progress'), ('run_attempt', 0),
                           ('head_repository', {'full_name': 'another/platform'})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.verify(run={**self.run, key: value})

    def test_missing_skipped_or_duplicate_native_gate_is_rejected(self):
        for name in signed.REQUIRED_JOBS:
            for problem in ('missing', 'skipped', 'duplicate', 'other_source'):
                jobs = copy.deepcopy(self.jobs)
                entry = next(job for job in jobs['jobs'] if job['name'] == name)
                if problem == 'missing': jobs['jobs'].remove(entry)
                elif problem == 'skipped': entry['conclusion'] = 'skipped'
                elif problem == 'duplicate': jobs['jobs'].append(copy.deepcopy(entry))
                else: entry['head_sha'] = 'b' * 40
                with self.subTest(name=name, problem=problem), self.assertRaises(ValueError):
                    self.verify(jobs=jobs)

    def test_artifacts_cannot_come_from_another_source_run_or_expired_upload(self):
        for name in ('oche-signed-aab', 'oche-signing-receipt'):
            for problem in ('missing', 'expired', 'duplicate', 'other_source', 'other_run'):
                artifacts = copy.deepcopy(self.artifacts)
                entry = next(item for item in artifacts['artifacts'] if item['name'] == name)
                if problem == 'missing': artifacts['artifacts'].remove(entry)
                elif problem == 'expired': entry['expired'] = True
                elif problem == 'duplicate': artifacts['artifacts'].append(copy.deepcopy(entry))
                elif problem == 'other_source': entry['workflow_run']['head_sha'] = 'b' * 40
                else: entry['workflow_run']['id'] += 1
                with self.subTest(name=name, problem=problem), self.assertRaises(ValueError):
                    self.verify(artifacts=artifacts)

    def test_wrong_package_certificate_counts_or_receipt_fields_are_rejected(self):
        for key, value in [('package', 'nl.dartflow.app'), ('uploadCertificateSha256', 'PLAYER-CERT'),
                           ('sourceCommit', 'b' * 40), ('bundleSha256', 'b' * 64), ('bundleBytes', 1),
                           ('runId', self.run_id + 1), ('versionCode', True), ('versionName', '1.4.0'),
                           ('requiredTests', {**signed.REQUIRED_TESTS, 'uiPerTarget': 16}),
                           ('requiredTests', {**signed.REQUIRED_TESTS, 'skipped': 1})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.verify(receipt={**self.receipt, key: value})

    def test_counter_regression_and_wrong_digest_or_requested_version_are_rejected(self):
        for changes in ({'code': 1063}, {'code': 1092}, {'digest': 'b' * 64}, {'version': '1.4.0'}, {'source': 'main'}, {'code': True}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.verify(**changes)

    def test_release_must_be_public_exact_source_and_protected_version_tag(self):
        for changes in ({'tag': 'android-player-1.5.0-1091'}, {'tag': 'oche-v1.4.0'},
                        {'release': {**self.release, 'isDraft': True}},
                        {'release': {**self.release, 'targetCommitish': 'main'}},
                        {'release': {**self.release, 'tagName': 'oche-v1.4.0'}}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.verify(**changes)

    def test_tag_cannot_be_mutable_or_bypassable(self):
        for key, value in [('enforcement', 'disabled'), ('target', 'branch'),
                           ('bypass_actors', None),
                           ('bypass_actors', [{'actor_type': 'RepositoryRole', 'actor_id': 5}]),
                           ('rules', [{'type': 'update'}]),
                           ('conditions', {'ref_name': {'include': ['refs/tags/*'], 'exclude': []}})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.verify(rulesets=[{**self.rules[0], key: value}])
        with self.assertRaises(ValueError): self.verify(rulesets=[])

    def test_redacted_bypass_field_still_requires_active_immutable_rules(self):
        rules = copy.deepcopy(self.rules)
        del rules[0]['bypass_actors']
        self.assertEqual(self.verify(rulesets=rules), self.receipt)
        rules[0]['rules'] = [{'type': 'update'}]
        with self.assertRaises(ValueError): self.verify(rulesets=rules)

    def test_bundle_bytes_may_not_change_after_receipt(self):
        with zipfile.ZipFile(self.bundle, 'a') as archive: archive.writestr('changed', 'different bytes')
        with self.assertRaises(ValueError): self.verify()

    def test_missing_manifest_or_symlink_is_rejected(self):
        with zipfile.ZipFile(self.bundle, 'w') as archive: archive.writestr('arbitrary', 'text')
        with self.assertRaises(ValueError): self.verify()
        link = Path(self.directory.name) / 'link.aab'
        link.symlink_to(self.bundle)
        with self.assertRaises(ValueError): self.verify(bundle=link)


if __name__ == '__main__':
    unittest.main()
