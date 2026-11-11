import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyRelease} from '../ops/release-gate.mjs';
import {brokerForInstalledName} from '../ops/retry-deploy.mjs';

const sha='a'.repeat(40),head='b'.repeat(40),repository='fixture/dartflow';
const input={repository,integrationBranch:'main',sha,requiredChecks:[{workflow:'ci.yml',jobs:['Verify'],events:['push']}],githubToken:'fixture-only-read-token',deploymentWorkflow:'deploy-production.yml',deploymentRun:{id:'5000',attempt:1}};
function fixture(overrides:{health?:Record<string,unknown>;ready?:Record<string,unknown>;publicResponse?:Response;publicError?:Error}={}) {
  const run={id:20,workflow_id:9,head_sha:sha,head_branch:'main',head_repository:{full_name:repository},run_attempt:1,event:'push',status:'completed',conclusion:'success'};
  const identity={sha,releaseId:'4000-1',buildConfigId:'staging-config-v1',runtimeConfigId:'staging-config-v1'};
  const publicRequests:string[]=[];
  const fetchFn:typeof fetch=async(resource,options)=>{
    const url=new URL(typeof resource==='string'?resource:resource instanceof URL?resource.href:resource.url);
    if(url.origin==='https://staging.dartflow.nl') {
      publicRequests.push(url.href);
      assert.equal(new Headers(options?.headers).has('Authorization'),false,'GitHub credentials must not reach the staging app');
      assert.equal(options?.redirect,'error');
      if(overrides.publicError)throw overrides.publicError;
      if(overrides.publicResponse)return overrides.publicResponse;
      const value=url.pathname==='/api/health'?{status:'ok',mode:'supabase',...identity,...overrides.health}:{status:'ready',database:'ok',auth:'reachable',...identity,...overrides.ready};
      return new Response(JSON.stringify(value),{status:200});
    }
    assert.equal(url.origin,'https://api.github.com');
    assert.equal(new Headers(options?.headers).get('Authorization'),`Bearer ${input.githubToken}`);
    const path=url.pathname.replace('/repos/'+repository,'');
    const values:Record<string,unknown>={
      '':{id:42,full_name:repository},'/branches/main':{name:'main',commit:{sha:head}},[`/commits/${sha}`]:{sha},[`/compare/${sha}...${head}`]:{status:'ahead',base_commit:{sha}},
      '/actions/workflows/ci.yml':{id:9,path:'.github/workflows/ci.yml',state:'active'},'/actions/workflows/9/runs':{workflow_runs:[run]},
      '/actions/runs/20/attempts/1/jobs':{jobs:[{run_id:20,name:'Verify',head_sha:sha,status:'completed',conclusion:'success'}]},'/actions/runs/20':run,
      '/actions/workflows/deploy-production.yml':{id:10,path:'.github/workflows/deploy-production.yml',state:'active'},
      '/actions/runs/5000':{id:5000,workflow_id:10,head_sha:head,head_branch:'main',head_repository:{full_name:repository},run_attempt:1,event:'workflow_dispatch',status:'in_progress',conclusion:null},
    };
    assert.ok(path in values,`Unconfigured fixture route ${path}`);
    return new Response(JSON.stringify(values[path]),{status:200});
  };
  return {fetchFn,publicRequests};
}

test('production uses its own manual workflow and promotes the exact healthy staging SHA',async()=>{
  const f=fixture();const result=await verifyRelease(input,{fetchFn:f.fetchFn});
  assert.equal(result.deploymentRunUrl,'https://github.com/fixture/dartflow/actions/runs/5000');
  assert.deepEqual(result.stagingEvidence,{origin:'https://staging.dartflow.nl',sha,releaseId:'4000-1',configId:'staging-config-v1'});
  assert.deepEqual(f.publicRequests,['https://staging.dartflow.nl/api/health','https://staging.dartflow.nl/api/ready']);
  assert.ok(!JSON.stringify(result).includes(input.githubToken));
});

test('production refuses a different staging commit or unready real backend',async()=>{
  for(const overrides of [{health:{sha:head}},{ready:{sha:head}},{health:{mode:'local'}},{ready:{status:'unavailable'}},{ready:{database:'schema_mismatch'}},{ready:{auth:'local-only'}}]) {
    const f=fixture(overrides);await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/staging|Staging/);
  }
});

test('production refuses missing, inconsistent or changing staging release/configuration identity',async()=>{
  for(const overrides of [{health:{releaseId:null}},{ready:{buildConfigId:null}},{ready:{runtimeConfigId:'another-config'}},{ready:{releaseId:'4001-1'}},{ready:{buildConfigId:'staging-config-v2',runtimeConfigId:'staging-config-v2'}}]) {
    const f=fixture(overrides);await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/staging|Staging/);
  }
});

test('staging transport failures and redirects stop promotion without exposing credentials',async()=>{
  for(const overrides of [{publicResponse:new Response('private-provider-detail',{status:302,headers:{Location:'https://other.invalid'}})},{publicResponse:new Response('x'.repeat(65537),{status:200})},{publicError:new Error(input.githubToken)}]) {
    const f=fixture(overrides);await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),error=>{
      assert.ok(error instanceof Error);assert.ok(!error.message.includes(input.githubToken));assert.ok(!error.message.includes('private-provider-detail'));return true;
    });
  }
});

test('only fixed deployment workflow identities and installed broker names are allowed',async()=>{
  const f=fixture();await assert.rejects(verifyRelease({...input,deploymentWorkflow:'deploy-arbitrary.yml'},{fetchFn:f.fetchFn}),/Fixed deployment workflow/);
  assert.equal(f.publicRequests.length,0);
  assert.equal(brokerForInstalledName('dartflow-retry-deploy.mjs'),'/usr/local/bin/dg-dartflow-deploy');
  assert.equal(brokerForInstalledName('dartflow-production-retry-deploy.mjs'),'/usr/local/bin/dg-dartflow-production-deploy');
  assert.throws(()=>brokerForInstalledName('caller-selected-environment.mjs'),/Unknown fixed/);
});
