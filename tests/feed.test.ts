import {test}from'node:test';
import assert from'node:assert/strict';
import {feedChannelIdentity}from'../lib/feed';
test('feed identities preserve server UUID scopes and reject ambiguous audiences',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 assert.deepEqual(feedChannelIdentity('club:'+id),{kind:'club',id,key:'club:'+id});
 assert.equal(feedChannelIdentity('platform').key,'platform');assert.equal(feedChannelIdentity('friends').kind,'friends');
 for(const value of['club','club:nope','club:'+id+':public','platform:'+id,'friends:'+id,'public','match:'+id,'//evil'])assert.throws(()=>feedChannelIdentity(value));
});
