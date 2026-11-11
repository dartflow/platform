// Only bounded public identity fields leave the health endpoints.
export function releaseIdentity() {
  const metadata=(value:string|undefined,pattern:RegExp)=>value && pattern.test(value) ? value : null;
  const buildConfigId=metadata(process.env.DARTFLOW_BUILD_CONFIG_ID,/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/);
  const runtimeConfigId=metadata(process.env.DARTFLOW_RUNTIME_CONFIG_ID,/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/);
  return {
    sha:metadata(process.env.DARTFLOW_RELEASE_SHA,/^[a-f0-9]{40}$/) || 'local-unreleased',
    releaseId:metadata(process.env.DARTFLOW_RELEASE_ID,/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/),
    buildConfigId,runtimeConfigId,configId:runtimeConfigId,
  };
}
