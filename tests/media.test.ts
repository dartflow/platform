import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {turnCredentials} from '../lib/media';

test('TURN access is time-limited and binds actor plus immutable match with separate environment keys',()=>{
  const urls=['turn:192.0.2.10:3478?transport=udp'];
  const value=turnCredentials('actor','match','staging-key',urls,1000000);
  assert.equal(value.username,'1600:actor:match');
  assert.equal(value.expiresAt,1600);
  assert.equal(value.credential,createHmac('sha1','staging-key').update(value.username).digest('base64'));
  assert.notEqual(value.credential,turnCredentials('actor','other-match','staging-key',urls,1000000).credential);
  assert.notEqual(value.credential,turnCredentials('actor','match','production-key',urls,1000000).credential);
});
