"""Offline regression coverage for the real Google Play release planner."""
import argparse
import contextlib
import io
import json
import os
from unittest.mock import patch
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


class SigningCertificates(unittest.TestCase):
    package='nl.dartflow.ochelive'
    app_path='/androidpublisher/v3/applications/nl.dartflow.ochelive'
    tracks={'tracks':[
        {'track':'internal','releases':[release(9),release(99,'draft')]},
        {'track':'tv:production','releases':[release(100)]},
        {'track':'production','releases':[]},
    ]}

    def invoke(self,generated,*,flag=True,tracks=None):
        requests=[]
        def request(publisher,method,path,**kwargs):
            requests.append((method,path,kwargs))
            if (method,path)==('POST',self.app_path+'/edits'):return {'id':'read-only-edit'}
            if (method,path)==('GET',self.app_path+'/edits/read-only-edit/tracks'):return self.tracks if tracks is None else tracks
            if (method,path)==('GET',self.app_path+'/generatedApks/100'):return generated
            if (method,path)==('DELETE',self.app_path+'/edits/read-only-edit'):return {}
            self.fail(f'Unexpected release mutation or API path: {method} {path}')
        output,error=io.StringIO(),io.StringIO()
        args=['play_release.py','list-tracks','--package',self.package]+(['--signing-certificates']if flag else[])
        with patch.object(play.sys,'argv',args),patch.dict(os.environ,{'PLAY_ACCESS_TOKEN':'private-test-access-token'}),patch.object(play.Publisher,'request',autospec=True,side_effect=request),contextlib.redirect_stdout(output),contextlib.redirect_stderr(error):
            status=play.main()
        self.assertNotIn('private-test-access-token',output.getvalue()+error.getvalue())
        return status,output.getvalue(),error.getvalue(),requests

    def test_latest_real_track_version_reads_only_public_deduplicated_certificates(self):
        generated={'generatedApks':[
            {'certificateSha256Hash':'a1'*32,'generatedUniversalApk':{'downloadId':'private-download-metadata'}},
            {'certificateSha256Hash':'A1'*32},
            {'certificateSha256Hash':':'.join(['b2']*32),'targetingInfo':{'private':'metadata'}},
        ]}
        status,output,error,requests=self.invoke(generated)
        self.assertEqual(status,0,error)
        self.assertEqual(json.loads(output),{
            'tracks':{'internal':[{'versionCodes':['9'],'status':'completed'},{'versionCodes':['99'],'status':'draft'}],'tv:production':[{'versionCodes':['100'],'status':'completed'}],'production':[]},
            'signingCertificates':{'versionCode':100,'sha256Fingerprints':[':'.join(['A1']*32),':'.join(['B2']*32)]},
        })
        self.assertNotIn('private-download-metadata',output)
        self.assertNotIn('targetingInfo',output)
        self.assertEqual([(method,path)for method,path,_ in requests],[
            ('POST',self.app_path+'/edits'),('GET',self.app_path+'/edits/read-only-edit/tracks'),
            ('GET',self.app_path+'/generatedApks/100'),('DELETE',self.app_path+'/edits/read-only-edit'),
        ])
        self.assertEqual(requests[0][2],{'payload':{}})
        self.assertTrue(all('upload'not in kwargs for _,_,kwargs in requests))

    def test_list_tracks_without_flag_preserves_the_original_json_and_requests(self):
        status,output,error,requests=self.invoke({},flag=False)
        self.assertEqual(status,0,error)
        self.assertEqual(json.loads(output),{'internal':[{'versionCodes':['9'],'status':'completed'},{'versionCodes':['99'],'status':'draft'}],'tv:production':[{'versionCodes':['100'],'status':'completed'}],'production':[]})
        self.assertEqual([method for method,_,_ in requests],['POST','GET','DELETE'])
        self.assertTrue(all('/generatedApks/'not in path for _,path,_ in requests))

    def test_invalid_or_missing_certificate_is_rejected_without_provider_values(self):
        for generated in ({},{'generatedApks':[]},{'generatedApks':'private-provider-data'},*({'generatedApks':[{'certificateSha256Hash':value}]}for value in [None,'private-provider-data','a'*63,'aa:'*32,{'secret':'private-provider-data'}])):
            with self.subTest(generated=generated):
                status,output,error,requests=self.invoke(generated)
                self.assertEqual(status,1)
                self.assertEqual(output,'')
                self.assertNotIn('private-provider-data',error)
                self.assertEqual(requests[-1][:2],('DELETE',self.app_path+'/edits/read-only-edit'))
                self.assertTrue(all(method in {'POST','GET','DELETE'}and ':commit'not in path and ':validate'not in path and '/upload'not in path for method,path,_ in requests))

    def test_absent_or_invalid_real_track_versions_do_not_guess_or_query_an_apk(self):
        for tracks in ({'tracks':[]},{'tracks':[{'track':'internal','releases':[release(0)]}]},{'tracks':[{'track':'internal','releases':[release('not-a-version')]}]}):
            with self.subTest(tracks=tracks):
                status,output,_,requests=self.invoke({},tracks=tracks)
                self.assertEqual(status,1)
                self.assertEqual(output,'')
                self.assertEqual([method for method,_,_ in requests],['POST','GET','DELETE'])


class Readiness(unittest.TestCase):
    def test_layout_publication_requires_explicit_healthy_web_sha_and_same_release(self):
        sha='a'*40
        capabilities={'layouts':{'version':1,'dualLocation':True}}
        health={'sha':sha,'status':'ok','mode':'supabase','releaseId':'12-1','buildConfigId':'config1','runtimeConfigId':'config1'}
        ready_value={**health,'status':'ready','database':'ok','auth':'reachable'}
        ready.validate_deployment(capabilities,health,ready_value,sha)
        for caps,left,right,source in [({},health,ready_value,sha),(capabilities,{**health,'sha':'b'*40},ready_value,sha),(capabilities,health,{**ready_value,'database':'error'},sha),(capabilities,health,{**ready_value,'releaseId':'other'},sha),(capabilities,health,{**ready_value,'runtimeConfigId':'different'},sha),(capabilities,health,ready_value,'main')]:
            with self.assertRaises(ValueError):ready.validate_deployment(caps,left,right,source)

    def test_real_public_association_and_read_only_contract_are_required(self):
        fingerprint=':'.join(['A1']*32)
        capabilities={'apiVersion':1,'origin':'https://dartflow.nl','permissions':{'read':True,'score':False,'extend':False}}
        association={'relation':['delegate_permission/common.handle_all_urls'],'target':{'namespace':'android_app','package_name':'nl.dartflow.ochelive','sha256_cert_fingerprints':[fingerprint]}}
        ready.validate(capabilities,[association],'nl.dartflow.ochelive',fingerprint)
        for caps,links,package,sha in [(capabilities,[],'nl.dartflow.ochelive',fingerprint),(capabilities,[association],'nl.other.app',fingerprint),(capabilities,[association],'nl.dartflow.ochelive','VUL-IN'),({**capabilities,'origin':'https://staging.dartflow.nl'},[association],'nl.dartflow.ochelive',fingerprint),({**capabilities,'permissions':{'read':True,'score':True,'extend':False}},[association],'nl.dartflow.ochelive',fingerprint)]:
            with self.assertRaises(ValueError):ready.validate(caps,links,package,sha)

if __name__=='__main__':unittest.main()
