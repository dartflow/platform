import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyRelease} from '../ops/release-gate.mjs';
import {withLockRetry} from '../ops/retry-deploy.mjs';
const sha='a'.repeat(40),head='b'.repeat(40),repository='fixture/dartflow';
const input={repository,integrationBranch:'main',sha,requiredChecks:[{workflow:'ci.yml',jobs:['Verify'],events:['push']}],githubToken:'fixture-token-not-a-credential'};
function fixture(overrides:Record<string,unknown>={}) {
  const run={id:20,workflow_id:9,head_sha:sha,head_branch:'main',head_repository:{full_name:repository},run_attempt:1,event:'push',status:'completed',conclusion:'success'};
  const values:Record<string,unknown>={
    repo:{id:42,full_name:repository},branch:{name:'main',commit:{sha:head}},commit:{sha},comparison:{status:'ahead',base_commit:{sha}},
    workflow:{id:9,path:'.github/workflows/ci.yml',state:'active'},runs:[run],
    deployWorkflow:{id:10,path:'.github/workflows/deploy-staging.yml',state:'active'},
    deployment:{id:5000,workflow_id:10,head_sha:head,head_branch:'main',head_repository:{full_name:repository},run_attempt:1,event:'workflow_dispatch',status:'in_progress',conclusion:null},
    jobs:[{id:30,run_id:20,name:'Verify',head_sha:sha,status:'completed',conclusion:'success'}],latest:run,...overrides,
  };
  const requests:string[]=[];
  const fetchFn:typeof fetch=async(resource,options)=>{
    const url=new URL(typeof resource==='string'?resource:resource instanceof URL?resource.href:resource.url);
    assert.equal(url.origin,'https://api.github.com');assert.equal(new Headers(options?.headers).get('Authorization'),`Bearer ${input.githubToken}`);assert.ok(!url.href.includes(input.githubToken));requests.push(url.pathname+url.search);
    const path=url.pathname.replace('/repos/'+repository,'');let body:unknown;
    if(path==='')body=values.repo;
    else if(path==='/branches/main')body=values.branch;
    else if(path===`/commits/${sha}`)body=values.commit;
    else if(path===`/compare/${sha}...${head}`)body=values.comparison;
    else if(path==='/actions/workflows/ci.yml')body=values.workflow;
    else if(path==='/actions/workflows/deploy-staging.yml')body=values.deployWorkflow;
    else if(path==='/actions/workflows/9/runs') {assert.equal(url.searchParams.get('head_sha'),sha);body={workflow_runs:Array.isArray(values.runPages)?values.runPages[Number(url.searchParams.get('page'))-1]??[]:values.runs};}
    else if(path==='/actions/runs/20/attempts/1/jobs')body={jobs:Array.isArray(values.jobPages)?values.jobPages[Number(url.searchParams.get('page'))-1]??[]:values.jobs};
    else if(path==='/actions/runs/20')body=values.latest;
    else if(path==='/actions/runs/5000')body=values.deployment;
    else throw new Error('Unconfigured fixture route');
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  };
  return {values,requests,fetchFn,run};
}
test('release gate proves fixed repository, branch ancestry, exact SHA and current required CI attempt',async()=>{
  const f=fixture();const result=await verifyRelease(input,{fetchFn:f.fetchFn});
  assert.equal(result.sha,sha);assert.equal(result.status,'passed');assert.equal(result.ciRunUrl,'https://github.com/fixture/dartflow/actions/runs/20');
  assert.ok(f.requests.some(path=>path.includes('/attempts/1/jobs')));assert.ok(!JSON.stringify(result).includes(input.githubToken));
});
test('malformed release identity is refused before any remote request',async()=>{
  for(const changes of [{sha:'main'},{sha:'a'.repeat(39)},{repository:null},{integrationBranch:'../main'},{requiredChecks:[]}]) {
    const f=fixture();await assert.rejects(verifyRelease({...input,...changes},{fetchFn:f.fetchFn}));assert.equal(f.requests.length,0);
  }
});
test('required CI evidence is checked across paginated runs and current-attempt jobs',async()=>{
  const f=fixture();
  f.values.runPages=[Array.from({length:100},(_,index)=>({...f.run,id:100+index,event:'pull_request'})),[f.run]];
  f.values.jobPages=[Array.from({length:100},(_,index)=>({name:`Unrelated ${index}`})),f.values.jobs];
  assert.equal((await verifyRelease(input,{fetchFn:f.fetchFn})).status,'passed');
  assert.ok(f.requests.some(path=>path.includes('/runs?') && path.endsWith('page=2')));
  assert.ok(f.requests.some(path=>path.includes('/jobs?') && path.endsWith('page=2')));
  f.values.runPages=Array.from({length:20},()=>Array.from({length:100},()=>({...f.run,event:'pull_request'})));
  await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/bounded review window/);
});
test('a green check on another commit, repository, event or branch is never release evidence',async()=>{
  for(const changes of [{head_sha:head},{head_branch:'feature'},{head_repository:{full_name:'attacker/fork'}},{event:'pull_request'}]) {
    const f=fixture();f.values.runs=[{...f.run,...changes}];await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/Required CI run is missing/);
  }
  for(const comparison of [{status:'behind',base_commit:{sha}},{status:'diverged',base_commit:{sha}},{status:'ahead',base_commit:{sha:head}}]) {
    const f=fixture({comparison});await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/not contained/);
  }
});
test('latest unsuccessful or incomplete run overrides any earlier successful run',async()=>{
  for(const [status,conclusion] of [['queued',null],['in_progress',null],['completed','failure'],['completed','cancelled'],['completed','skipped'],['completed','neutral']]) {
    const f=fixture();f.values.runs=[{...f.run,status,conclusion},{...f.run,id:19}];
    await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/Latest required CI run/);
  }
});
test('missing, skipped, failed or wrong-SHA required jobs fail even when the workflow is green',async()=>{
  for(const jobs of [[],[{name:'Different job'}],[{name:'Verify',run_id:20,head_sha:sha,status:'completed',conclusion:'skipped'}],[{name:'Verify',run_id:20,head_sha:head,status:'completed',conclusion:'success'}]]) {
    const f=fixture({jobs});await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/Required CI job/);
  }
  const f=fixture();f.values.latest={...f.run,run_attempt:2,status:'in_progress',conclusion:null};await assert.rejects(verifyRelease(input,{fetchFn:f.fetchFn}),/CI changed/);
});
test('GitHub authentication failures and provider errors reveal no credential',async()=>{
  for(const fetchFn of [async()=>new Response('secret provider body',{status:403}),async()=>{throw new Error(input.githubToken);}]) {
    await assert.rejects(verifyRelease(input,{fetchFn}),error=>{assert.ok(error instanceof Error);assert.ok(!error.message.includes(input.githubToken));assert.ok(!error.message.includes('secret provider body'));return true;});
  }
});
test('native deployment provenance requires a real current manual run of the fixed workflow',async()=>{
  const invocation={...input,deploymentRun:{id:'5000',attempt:1}};
  const f=fixture();assert.equal((await verifyRelease(invocation,{fetchFn:f.fetchFn})).deploymentRunUrl,'https://github.com/fixture/dartflow/actions/runs/5000');
  for(const changes of [{id:9999},{run_attempt:2},{workflow_id:9},{event:'push'},{head_branch:'feature'},{head_repository:{full_name:'attacker/fork'}},{status:'completed',conclusion:'success'}]) {
    const f=fixture();f.values.deployment={...(f.values.deployment as object),...changes};
    await assert.rejects(verifyRelease(invocation,{fetchFn:f.fetchFn}),/Native deployment run/);
  }
  const old=fixture();old.values.deployment={...(old.values.deployment as object),head_sha:sha};
  assert.equal((await verifyRelease(invocation,{fetchFn:old.fetchFn})).status,'passed');
});
test('only genuine lock-busy exit75 causes bounded delayed retries; activation errors never retry',async()=>{
  let calls=0;const delays:number[]=[];
  assert.equal(await withLockRetry(async()=>++calls<3?75:0,{delays:[1,2,3],sleep:async(ms:number)=>{delays.push(ms);}}),0);assert.equal(calls,3);assert.deepEqual(delays,[1,2]);
  calls=0;assert.equal(await withLockRetry(async()=>{calls++;return 1;},{sleep:async()=>{throw new Error('Activation failures must not retry');}}),1);assert.equal(calls,1);
  calls=0;assert.equal(await withLockRetry(async()=>{calls++;return 75;},{delays:[1,2],sleep:async()=>{}}),75);assert.equal(calls,3);
});
