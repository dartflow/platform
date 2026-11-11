import {readFile} from 'node:fs/promises';
import {ReleaseGateError,verifyRelease} from './release-gate.mjs';
try {
  const args=process.argv.slice(2);
  const environment=args.length===0 ? 'staging' : args.length===2 && args[0]==='--environment' && ['staging','production'].includes(args[1]) ? args[1] : null;
  if(!environment)throw new ReleaseGateError('Use the fixed staging or production policy');
  const policyFile=environment==='production'?'./release-policy.production.json':'./release-policy.json';
  const policy=JSON.parse(await readFile(new URL(policyFile,import.meta.url),'utf8'));
  if(policy.environment!==environment || policy.deploymentWorkflow!==`deploy-${environment}.yml`)throw new ReleaseGateError('Fixed environment policy differs');
  if(!policy.repository || !policy.integrationBranch)throw new ReleaseGateError('Record the verified DartFlow repository and integration branch before a release');
  if(process.env.GITHUB_REPOSITORY!==policy.repository || process.env.GITHUB_REF!==`refs/heads/${policy.integrationBranch}`)throw new ReleaseGateError('Dispatch must use the recorded repository and integration branch');
  if(process.env.DARTFLOW_REQUIRE_NATIVE==='1' && policy.nativeEnabled!==true)throw new ReleaseGateError('Native host contract is not yet installed and verified');
  const result=await verifyRelease({...policy,sha:process.env.SOURCE_SHA,githubToken:process.env.GH_TOKEN});
  if(process.env.GITHUB_OUTPUT) {
    const {appendFile}=await import('node:fs/promises');
    await appendFile(process.env.GITHUB_OUTPUT,`source_sha=${result.sha}\nrepository=${result.repository}\nintegration_branch=${result.integrationBranch}\nci_run_url=${result.ciRunUrl}\n`);
  }
  console.log(JSON.stringify(result));
}catch(error){console.error(error instanceof ReleaseGateError?error.message:'Release policy verification failed');process.exitCode=1;}
