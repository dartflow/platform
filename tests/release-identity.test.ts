import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseIdentity} from '../lib/release';
test('health identity exposes only bounded source, run and configuration metadata',()=>{
  const keys=['DARTFLOW_RELEASE_SHA','DARTFLOW_RELEASE_ID','DARTFLOW_BUILD_CONFIG_ID','DARTFLOW_RUNTIME_CONFIG_ID'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    process.env.DARTFLOW_RELEASE_SHA='a'.repeat(40);process.env.DARTFLOW_RELEASE_ID='123-2';process.env.DARTFLOW_BUILD_CONFIG_ID='staging-v1';process.env.DARTFLOW_RUNTIME_CONFIG_ID='staging-v1';
    assert.deepEqual(releaseIdentity(),{sha:'a'.repeat(40),releaseId:'123-2',buildConfigId:'staging-v1',runtimeConfigId:'staging-v1',configId:'staging-v1'});
    const accidentalSecret='postgresql://app:secret@private/db';process.env.DARTFLOW_BUILD_CONFIG_ID=accidentalSecret;process.env.DARTFLOW_RUNTIME_CONFIG_ID=accidentalSecret;assert.ok(!JSON.stringify(releaseIdentity()).includes(accidentalSecret));
  } finally {for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
