import {test}from'node:test';
import assert from'node:assert/strict';
import{normalizeUsername,normalizeDisplayName,validUsername,validDisplayName,hasConfirmedUsername}from'../lib/display-name';
import{publicIdentity,socialIdentityLabel}from'../lib/public-identity';
import{verifiedProfileValues}from'../lib/accounts';
test('one canonical case/Unicode handle rejects all whitespace and invisible changes without restricting public display names',()=>{
 assert.equal(normalizeUsername('@Ｄａｎｎｙ'),'danny');assert.equal(normalizeUsername('E\u0308'),'ë');
 for(const name of ['Danny','@danny','李明','Zoë','¼','²','Ⅷ'])assert.equal(validUsername(name),true,name);
 for(const name of ['Danny Boy',' Danny','Danny ','Dan\t ny','Dan\nny','Dan\u00a0ny','Dan\u200bny','Dan\u034fny','Dan\ufe0fny','@ danny','@@danny','\u00a8a','a'.repeat(81),'Nieuwe speler'])assert.equal(validUsername(name),false,name);
 assert.equal(normalizeDisplayName('  Zoë\u00a0 de Groot '),'Zoë de Groot');assert.equal(validDisplayName('Zoë de Groot'),true);
 assert.equal(hasConfirmedUsername({name:'Openbaar',username:'danny',displayNameConfirmed:true}),true);
 assert.equal(hasConfirmedUsername({name:'Private legacy',username:null,displayNameConfirmed:true}),false);
});
test('provider personal names and private fields cannot become public fallbacks',()=>{
 const profile=verifiedProfileValues({id:'00000000-0000-4000-8000-000000000001',user_metadata:{full_name:' Persoonlijke Naam ',name:'Other private',role:'owner',display_name_confirmed:true}});
 assert.equal(profile.name,'Nieuwe speler');assert.equal(profile.fullName,'Persoonlijke Naam');assert.equal(profile.displayName,null);
 const privateProfile={id:profile.id,name:'Private legacy',fullName:'Secret person',email:'secret@example.invalid',displayName:null,username:null};
 assert.deepEqual(publicIdentity(privateProfile),{id:profile.id,name:'Speler',displayName:null,username:null});
 assert.equal(publicIdentity({...privateProfile,username:'danny'}).name,'@danny');
 assert.equal(socialIdentityLabel({displayName:'De Pijl',username:'danny'}),'De Pijl (@danny)');
});
