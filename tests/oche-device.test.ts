import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {codeDigest,createOcheAccess,decryptOcheReceipt,encryptOcheReceipt,formatOcheCode,newOcheCode,normalizedOcheCode,readOcheAccess,secretHash} from '../lib/oche-device-crypto';
import {ocheName} from '../lib/oche-device-store';
import {buildOcheScorecard} from '../lib/oche-scorecard';
import type {OcheDisplaySnapshot} from '../lib/oche-device-types';

test('Oche short codes contain 40 random Crockford bits and normalize human input',()=>{
 process.env.DARTFLOW_DATA_MODE='local';
 const codes=new Set(Array.from({length:1000},()=>newOcheCode()));assert.equal(codes.size,1000);
 for(const code of codes){assert.match(code,/^[0-9A-HJKMNP-TV-Z]{8}$/);assert.equal(normalizedOcheCode(formatOcheCode(code).toLowerCase()),code);assert.match(codeDigest(code),/^[a-f0-9]{64}$/);assert.notEqual(codeDigest(code),secretHash(code));}
 assert.equal(normalizedOcheCode('oIl0-1234'),'01101234');assert.throws(()=>normalizedOcheCode('ABCD'));assert.throws(()=>normalizedOcheCode('ABCDWXYZ0'));
});
test('Oche encrypted retry receipts and access credentials have purpose-bound authenticated integrity',()=>{
 process.env.DARTFLOW_DATA_MODE='local';const id='00000000-0000-4000-8000-000000000001',expires=Date.now()+120000;
 const token=createOcheAccess(id,2,expires);assert.deepEqual(readOcheAccess(token),{deviceId:id,version:2,expires});
 assert.throws(()=>readOcheAccess(`${token}x`),{code:'device_unauthorized'});assert.throws(()=>readOcheAccess(token.replace(/^[^.]+/,Buffer.from(JSON.stringify({d:id,v:3,e:expires,a:'oche-display-v1'})).toString('base64url'))),{code:'device_unauthorized'});
 const value={refreshToken:'synthetic-secret',nonce:'synthetic-nonce'},cipher=encryptOcheReceipt(value);assert.equal(cipher.includes('synthetic'),false);assert.deepEqual(decryptOcheReceipt(cipher),value);
 assert.throws(()=>decryptOcheReceipt(`${cipher.slice(0,-8)}AAAAAAAA`));
 assert.equal(ocheName('  Mijn   scherm  '),'Mijn scherm');assert.throws(()=>ocheName('   '));assert.throws(()=>ocheName('naam\u0000'));
});
test('shared Android/browser display fixtures use one privacy allowlist and stable five-row scorecard',async()=>{
 const root=new URL('../contracts/fixtures/oche-display-v1/',import.meta.url),files=await readdir(root);assert.ok(files.length>=10);
 for(const file of files){const snapshot=JSON.parse(await readFile(new URL(file,root),'utf8')) as OcheDisplaySnapshot;
  assert.equal(snapshot.apiVersion,1);assert.equal(snapshot.pollAfterMs,2000);assert.deepEqual(snapshot.permissions,{read:true,score:false,extend:false});
  assert.equal(snapshot.display?.screen?.paired??false,false);assert.equal(snapshot.display?.snapshot.boardActivity?.canExtend??false,false);
  if(snapshot.display?.snapshot.match){const match=snapshot.display.snapshot.match,card=buildOcheScorecard(match);assert.ok(card.rows.length>=5);assert.equal(card.startScore,501);for(const player of match.players){assert.match(player.id,/^player-[12]$/);assert.equal('email'in player,false);}}
  for(const privateField of ['refreshToken','installationSecret','token_hash','secret_hash','privateNote'])assert.equal(JSON.stringify(snapshot).includes(privateField),false);
 }
});
