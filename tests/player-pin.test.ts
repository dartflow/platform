import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validPlayerPin,validatePlayerPinFields,playerPinConfigured,playerPinPolicy} from '../lib/player-pin';

test('player PIN uses exactly six ASCII digits as text, preserving leading zeroes',()=>{
 assert.equal(validPlayerPin('012345'),true);assert.equal(validPlayerPin('000000'),true);
 for(const value of [123456,'12345','1234567',' 123456','123456 ','１２３４５６','١٢٣٤٥٦','12345a',null])assert.equal(validPlayerPin(value),false);
 validatePlayerPinFields('012345','012345');
 assert.throws(()=>validatePlayerPinFields('12345','12345'),{code:'player_pin_format'});
 assert.throws(()=>validatePlayerPinFields('012345',''),{code:'player_pin_confirmation'});
 assert.throws(()=>validatePlayerPinFields('012345','112345'),{code:'player_pin_mismatch'});
});
test('player PIN configuration rejects missing secrets and weak/unbounded KDF configuration',()=>{
 const names=['DARTFLOW_PLAYER_PIN_PEPPERS','DARTFLOW_PLAYER_PIN_PEPPER_VERSION','DARTFLOW_PLAYER_PIN_MEMORY_KIB','DARTFLOW_PLAYER_PIN_PASSES'];const original=names.map(name=>process.env[name]);
 try{
  delete process.env.DARTFLOW_PLAYER_PIN_PEPPERS;delete process.env.DARTFLOW_PLAYER_PIN_PEPPER_VERSION;assert.equal(playerPinConfigured(),false);
  process.env.DARTFLOW_PLAYER_PIN_PEPPERS=`v1:${Buffer.alloc(32,71).toString('base64')}`;process.env.DARTFLOW_PLAYER_PIN_PEPPER_VERSION='v1';assert.equal(playerPinConfigured(),true);
  process.env.DARTFLOW_PLAYER_PIN_MEMORY_KIB='8192';assert.equal(playerPinConfigured(),false);assert.throws(()=>playerPinPolicy(),{code:'player_pin_configuration'});
  process.env.DARTFLOW_PLAYER_PIN_MEMORY_KIB='19456';process.env.DARTFLOW_PLAYER_PIN_PASSES='1';assert.equal(playerPinConfigured(),false);
  process.env.DARTFLOW_PLAYER_PIN_PASSES='2';assert.equal(playerPinConfigured(),true);
 }finally{names.forEach((name,index)=>{if(original[index]===undefined)delete process.env[name];else process.env[name]=original[index];});}
});
