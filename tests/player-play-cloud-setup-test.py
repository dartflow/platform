#!/usr/bin/env python3
"""Offline Cloud bootstrap regression tests: every gcloud call is a local fake."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'ops/player-play-cloud-setup.sh'
PROJECT = 'dartflow-cloud-test'
FAKE = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['DARTFLOW_CLOUD_TEST_STATE']);s=json.loads(p.read_text());a=sys.argv[1:]
assert a.pop(0)=='--quiet'
s['calls'].append(a)
def flag(name): return next(x.split('=',1)[1] for x in a if x.startswith(name+'='))
def finish(value): p.write_text(json.dumps(s));print(json.dumps(value));sys.exit(0)
if a[:3]==['config','get-value','project']:
 p.write_text(json.dumps(s));print(s.get('selected',s['project']));sys.exit(0)
assert flag('--project')==s['project']
if a[:2]==['projects','describe']: finish({'projectId':s['project'],'projectNumber':'123456789012','lifecycleState':'ACTIVE'})
if a[:2]==['services','enable']: s['mutations'].append('enable-apis');finish({})
if a[:2]==['projects','get-iam-policy']: finish(s.get('projectPolicy',{}))
if a[:3]==['iam','service-accounts','list']: finish(s.get('accounts',[]))
if a[:3]==['iam','workload-identity-pools','list']: finish(s.get('pools',[]))
if a[:4]==['iam','workload-identity-pools','providers','list']: finish(s.get('providers',[]))
if a[:3]==['iam','service-accounts','get-iam-policy']: finish(s.get('accountPolicy',{}))
if a[:4]==['iam','service-accounts','keys','list']: assert flag('--managed-by')=='user';finish(s.get('keys',[]))
if a[:3]==['iam','service-accounts','create']:
 s['mutations'].append('create-account');s['accounts']=[{'projectId':s['project'],'email':a[3]+'@'+s['project']+'.iam.gserviceaccount.com','displayName':flag('--display-name'),'description':flag('--description')}];finish(s['accounts'][0])
if a[:3]==['iam','workload-identity-pools','create']:
 s['mutations'].append('create-pool');s['pools']=[{'name':'projects/123456789012/locations/global/workloadIdentityPools/'+a[3],'state':'ACTIVE','displayName':flag('--display-name'),'description':flag('--description')}];finish(s['pools'][0])
if a[:4]==['iam','workload-identity-pools','providers','create-oidc']:
 s['mutations'].append('create-provider');s['providers']=[{'name':s['pools'][0]['name']+'/providers/'+a[4],'state':'ACTIVE','displayName':flag('--display-name'),'description':flag('--description'),'attributeMapping':dict(v.split('=',1) for v in flag('--attribute-mapping').split(',')),'attributeCondition':flag('--attribute-condition'),'oidc':{'issuerUri':flag('--issuer-uri')}}];finish(s['providers'][0])
if a[:3]==['iam','service-accounts','add-iam-policy-binding']:
 assert flag('--role')=='roles/iam.workloadIdentityUser' and flag('--condition')=='None'
 s['mutations'].append('bind-federation');s['accountPolicy']={'bindings':[{'role':flag('--role'),'members':[flag('--member')]}]};finish(s['accountPolicy'])
raise AssertionError('Unexpected command; fake never contacts Google')
'''


class CloudSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        (self.directory / 'gcloud').write_text(FAKE)
        (self.directory / 'gcloud').chmod(0o700)
        self.state = self.directory / 'state.json'
        self.state.write_text(json.dumps({'project': PROJECT, 'calls': [], 'mutations': []}))
        self.env = dict(os.environ, PATH=str(self.directory) + os.pathsep + os.environ['PATH'], DARTFLOW_CLOUD_TEST_STATE=str(self.state))

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, *arguments):
        return subprocess.run(['bash', str(SCRIPT), *arguments], env=self.env, capture_output=True, text=True, timeout=15)

    def current(self):
        return json.loads(self.state.read_text())

    def update(self, **values):
        self.state.write_text(json.dumps(dict(self.current(), **values)))

    def prepare(self):
        result = self.run_script('--project', PROJECT, '--apply')
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_default_is_offline_and_bad_arguments_never_call_cloud(self):
        result = self.run_script('--project', PROJECT)
        self.assertEqual(result.returncode, 0)
        self.assertIn("assertion.workflow_ref == 'dartflow/platform/.github/workflows/player-play-release.yml@refs/heads/main'", result.stdout)
        for required in ["assertion.repository_id == '1453713803'", "assertion.repository_owner_id == '355255545'", "assertion.ref == 'refs/heads/main'", "assertion.sub == 'repo:dartflow/platform:environment:player-play-production'", "assertion.environment == 'player-play-production'", "assertion.event_name == 'workflow_dispatch'"]:
            self.assertIn(required, result.stdout)
        self.assertNotIn('assertion.job_workflow_ref', result.stdout)
        for args in [[], ['--apply'], ['--project', '12345'], ['--project', 'wrong project'], ['--project', 'test;touch-file'], ['--project', PROJECT, '--project', PROJECT], ['--project', PROJECT, '--apply', '--apply'], ['--project', PROJECT, '--unknown']]:
            self.assertNotEqual(self.run_script(*args).returncode, 0)
        self.assertEqual(self.current()['calls'], [])

    def test_create_then_repeat_keeps_authority_exactly_scoped(self):
        result = self.prepare()
        first = self.current()
        self.assertEqual(first['mutations'], ['enable-apis', 'create-account', 'create-pool', 'create-provider', 'bind-federation'])
        self.assertIn('PLAY_WIF_PROVIDER=projects/123456789012/locations/global/workloadIdentityPools/dartflow-player-play/providers/github-main', result.stdout)
        self.assertIn(f'PLAY_SERVICE_ACCOUNT=dartflow-player-play@{PROJECT}.iam.gserviceaccount.com', result.stdout)
        self.prepare()
        second = self.current()
        self.assertEqual(second['mutations'], first['mutations'] + ['enable-apis'])
        self.assertEqual(second['accountPolicy']['bindings'], [{'role': 'roles/iam.workloadIdentityUser', 'members': ['principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/dartflow-player-play/attribute.repository_id/1453713803']}])
        self.assertEqual(second['projectPolicy'] if 'projectPolicy' in second else {}, {})
        for call in second['calls']:
            self.assertNotIn('roles/owner', call)
            self.assertNotIn('roles/editor', call)
            self.assertNotIn('print-access-token', call)
            self.assertFalse(call[:4] == ['iam', 'service-accounts', 'keys', 'create'])

    def test_wrong_selected_project_stops_before_mutation(self):
        self.update(selected='unrelated-project')
        self.assertNotEqual(self.run_script('--project', PROJECT, '--apply').returncode, 0)
        self.assertEqual(self.current()['mutations'], [])

    def test_conflicting_provider_or_additional_provider_is_never_overwritten(self):
        self.prepare()
        provider = self.current()['providers'][0]
        for providers in [[dict(provider, attributeCondition='true')], [provider, dict(provider, name=provider['name']+'-other')]]:
            self.update(providers=providers)
            before = self.current()['mutations']
            result = self.run_script('--project', PROJECT, '--apply')
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.current()['providers'], providers)
            self.assertEqual(self.current()['mutations'], before + ['enable-apis'])

    def test_existing_project_roles_user_keys_or_extra_impersonators_block_reuse(self):
        self.prepare()
        email = self.current()['accounts'][0]['email']
        original_policy = self.current()['accountPolicy']
        for change in [{'projectPolicy': {'bindings': [{'role': 'roles/viewer', 'members': ['serviceAccount:'+email]}]}}, {'keys': [{'name': 'synthetic-user-key'}]}, {'accountPolicy': {'bindings': [{'role': 'roles/iam.serviceAccountTokenCreator', 'members': ['user:synthetic@example.invalid']}]}}]:
            self.update(projectPolicy={}, keys=[], accountPolicy=original_policy)
            self.update(**change)
            before = self.current()['mutations']
            self.assertNotEqual(self.run_script('--project', PROJECT, '--apply').returncode, 0)
            self.assertEqual(self.current()['mutations'], before + ['enable-apis'])


if __name__ == '__main__':
    unittest.main()
