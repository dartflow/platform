"""Offline regression coverage for the real Google Play release planner."""
import argparse
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('play_release',Path(__file__).with_name('play_release.py'))
play=importlib.util.module_from_spec(spec)
spec.loader.exec_module(play)
ready_spec=importlib.util.spec_from_file_location('release_ready',Path(__file__).with_name('check_release_readiness.py'))
ready=importlib.util.module_from_spec(ready_spec)
ready_spec.loader.exec_module(ready)

def release(code,status='completed',**extra):
    return {'name':f'Oche {code}','versionCodes':[str(code)],'status':status,**extra}

class Plans(unittest.TestCase):
    def test_internal_retry_does_not_replace_or_duplicate_a_release(self):
        self.assertEqual(play.plan_internal({'internal':[release(11)]},11,'Oche'),{})
        self.assertEqual(play.plan_internal({'internal':[release(10)]},11,'Oche')['internal']['versionCodes'],['11'])
    def test_internal_rejects_downgrade_and_incomplete_other_release(self):
        for tracks in ({'internal':[release(12)]},{'internal':[release(11,'draft')]}):
            with self.assertRaises(play.ReleaseError):play.plan_internal(tracks,11,'Oche')
    def test_production_first_release_must_be_done_in_console(self):
        with self.assertRaises(play.ReleaseError):play.plan_production({'production':[]},11,'start',1,{'production':release(11)})
    def test_promotion_reuses_the_tested_code_and_release_notes(self):
        source=release(11,releaseNotes=[{'language':'nl-NL','text':'Oche Live'}])
        plan=play.plan_production({'production':[release(10)]},11,'start',.1,{'production':source})
        self.assertEqual(plan['production'],{**source,'status':'inProgress','userFraction':.1})
    def test_retry_of_same_rollout_and_completed_release_is_idempotent(self):
        self.assertEqual(play.plan_production({'production':[release(10),release(11,'inProgress',userFraction=.1)]},11,'start',.1,{}),{})
        self.assertEqual(play.plan_production({'production':[release(11)]},11,'start',1,{}),{})
    def test_later_rollout_cannot_be_overwritten(self):
        for records in ([release(12)],[release(10),release(12,'inProgress',userFraction=.1)]):
            with self.assertRaises(play.ReleaseError):play.plan_production({'production':records},11,'start',1,{'production':release(11)})
    def test_complete_and_halt_require_the_exact_active_rollout(self):
        for action,target in [('complete','completed'),('halt','halted')]:
            plan=play.plan_production({'production':[release(10),release(11,'inProgress',userFraction=.1)]},11,action,1,{})
            self.assertEqual(plan['production']['status'],target)
            self.assertNotIn('userFraction',plan['production'])
            with self.assertRaises(play.ReleaseError):play.plan_production({'production':[release(10)]},11,action,1,{})
    def test_targeting_and_multiple_version_codes_are_not_silently_lost(self):
        for record in (release(11,countryTargeting={'countries':['NL']}),{**release(11),'versionCodes':['10','11']}):
            with self.assertRaises(play.ReleaseError):play.check_simple_track('production',[record])
    def test_play_bundle_digest_and_code_must_match_the_ci_receipt(self):
        good={'versionCode':11,'sha256':'a'*64}
        play.verify_bundle(good,11,'a'*64)
        for bundle,version,digest in [(good,12,'a'*64),(good,11,'b'*64),(None,11,'a'*64)]:
            with self.assertRaises(play.ReleaseError):play.verify_bundle(bundle,version,digest)
    def test_numeric_bounds_and_track_values_are_validated(self):
        for value in ['nan','inf','0','-1','1.1']:
            with self.assertRaises(argparse.ArgumentTypeError):play.valid_fraction(value)
        for value in ['0','2100000001','text']:
            with self.assertRaises(argparse.ArgumentTypeError):play.positive_version(value)
        for value in ['internal,internal','internal,','../production']:
            with self.assertRaises(argparse.ArgumentTypeError):play.track_ids(value)
    def test_provider_details_never_expose_token_values(self):
        failure=play.PlayHttpError(403,{'error':{'message':'secret-token-value','details':[{'reason':'secret-token-value'}]}})
        self.assertNotIn('secret-token-value',str(failure))

class FakePublisher:
    def __init__(self,failure=None):self.requests=[];self.failure=failure
    def request(self,method,path,**kwargs):
        self.requests.append((method,path))
        if ':commit?'in path and self.failure:raise self.failure
        return {}

class Commits(unittest.TestCase):
    def test_validate_only_never_submits_a_release(self):
        publisher=FakePublisher();edit=play.Edit(publisher,'/edit/123')
        edit.commit(validate_only=True)
        self.assertTrue(edit.should_discard)
        self.assertEqual(publisher.requests,[('POST','/edit/123:validate')])
    def test_lost_commit_reply_remains_uncertain_and_is_not_discarded(self):
        for error in [play.PlayTransportError('lost'),play.PlayHttpError(500,{})]:
            publisher=FakePublisher(error);edit=play.Edit(publisher,'/edit/123')
            with self.assertRaisesRegex(play.ReleaseError,'onzeker'):edit.commit(validate_only=False)
            self.assertFalse(edit.should_discard)
    def test_successful_commit_uses_review_conflict_guard(self):
        publisher=FakePublisher();edit=play.Edit(publisher,'/edit/123');edit.commit(validate_only=False)
        self.assertFalse(edit.should_discard)
        self.assertIn('changesInReviewBehavior=ERROR_IF_IN_REVIEW',publisher.requests[-1][1])

class Readiness(unittest.TestCase):
    def test_real_public_association_and_read_only_contract_are_required(self):
        fingerprint=':'.join(['A1']*32)
        capabilities={'apiVersion':1,'origin':'https://dartflow.nl','permissions':{'read':True,'score':False,'extend':False}}
        association={'relation':['delegate_permission/common.handle_all_urls'],'target':{'namespace':'android_app','package_name':'nl.dartflow.ochelive','sha256_cert_fingerprints':[fingerprint]}}
        ready.validate(capabilities,[association],'nl.dartflow.ochelive',fingerprint)
        for caps,links,package,sha in [(capabilities,[],'nl.dartflow.ochelive',fingerprint),(capabilities,[association],'nl.other.app',fingerprint),(capabilities,[association],'nl.dartflow.ochelive','VUL-IN'),({**capabilities,'origin':'https://staging.dartflow.nl'},[association],'nl.dartflow.ochelive',fingerprint),({**capabilities,'permissions':{'read':True,'score':True,'extend':False}},[association],'nl.dartflow.ochelive',fingerprint)]:
            with self.assertRaises(ValueError):ready.validate(caps,links,package,sha)

if __name__=='__main__':unittest.main()
