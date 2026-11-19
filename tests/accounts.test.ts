import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifiedProfileValues} from '../lib/accounts';

test('verified Auth identity maps one profile without metadata privilege or email trust',()=>{
  const id='00000000-0000-4000-8000-000000000099';
  const result=verifiedProfileValues({id,email:'Speler@example.invalid',email_confirmed_at:undefined,user_metadata:{name:'  Speler\u0000  ',role:'owner',email_verified:true}});
  assert.deepEqual(result,{id,name:'Nieuwe speler',fullName:'Speler',displayName:null,email:'speler@example.invalid',emailVerified:false});
  assert.equal(verifiedProfileValues({id,email:'a@example.invalid',email_confirmed_at:'2026-11-11T00:00:00Z',user_metadata:{}}).emailVerified,true);
  assert.equal(verifiedProfileValues({id,user_metadata:{name:5}}).name,'Nieuwe speler');
});
