import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasRecentVerifiedAuthentication, googleSignInOptions } from '../lib/reauth';

const actor='00000000-0000-4000-8000-000000000001';
const now=Date.parse('2026-11-11T17:54:19Z');
const claims=(method:unknown='otp',timestamp:unknown=now/1000)=>({sub:actor,aal:'aal1',amr:[{method,timestamp}]});

test('recent authentication permits genuine current OTP/OAuth and keeps the fifteen-minute boundary',()=>{
 for(const method of ['otp','oauth','password','totp','magiclink','sso/saml'])assert.equal(hasRecentVerifiedAuthentication(actor,claims(method),{now}),true);
 assert.equal(hasRecentVerifiedAuthentication(actor,claims('otp',now/1000-900),{now}),true);
 assert.equal(hasRecentVerifiedAuthentication(actor,claims('otp',now/1000-900),{now:now+1}),false);
 // Regression for the observed owner session: re-opening the login page did not replace its old OTP AMR.
 assert.equal(hasRecentVerifiedAuthentication(actor,claims('otp',now/1000-1226),{now}),false);
 assert.equal(hasRecentVerifiedAuthentication(actor,claims('otp',now/1000+1),{now}),false);
});

test('token refresh and user-controlled metadata cannot make a stale login recent',()=>{
 const stale=claims('otp',now/1000-1200);
 assert.equal(hasRecentVerifiedAuthentication(actor,{...stale,iat:now/1000,auth_time:now/1000,amr:[...stale.amr,{method:'token_refresh',timestamp:now/1000}],user_metadata:{amr:claims().amr}},{now}),false);
 for(const method of ['token_refresh','anonymous','email_change','unknown',null])assert.equal(hasRecentVerifiedAuthentication(actor,claims(method),{now}),false);
 for(const timestamp of [String(now/1000),null,undefined,Number.NaN,Infinity,now/1000+.5])assert.equal(hasRecentVerifiedAuthentication(actor,{sub:actor,amr:[{method:'otp',timestamp}]},{now}),false);
 for(const value of [null,{},[],{sub:actor,auth_time:now/1000},{sub:actor,amr:'otp'},{...claims(),sub:'other-actor'}])assert.equal(hasRecentVerifiedAuthentication(actor,value,{now}),false);
});

test('MFA and OTP recovery constraints cannot be substituted with another fresh method',()=>{
 assert.equal(hasRecentVerifiedAuthentication(actor,claims(),{now,requireMfa:true}),false);
 assert.equal(hasRecentVerifiedAuthentication(actor,{...claims(),aal:'aal2'},{now,requireMfa:true}),true);
 assert.equal(hasRecentVerifiedAuthentication(actor,claims('oauth'),{now,method:'otp'}),false);
 assert.equal(hasRecentVerifiedAuthentication(actor,claims(),{now,method:'otp'}),true);
 assert.equal(hasRecentVerifiedAuthentication(actor,claims(),{now:Number.NaN}),false);
});

test('explicit Google reauthentication requests account selection with only the configured callback',()=>{
 const origin='https://staging.dartflow.nl';
 assert.deepEqual(googleSignInOptions(origin,'1'),{provider:'google',options:{redirectTo:`${origin}/auth/callback`,queryParams:{prompt:'select_account'}}});
 for(const reauth of [undefined,null,'0','otp','https://outside.invalid/callback',{prompt:'none'}])assert.deepEqual(googleSignInOptions(origin,reauth),{provider:'google',options:{redirectTo:`${origin}/auth/callback`}});
});
