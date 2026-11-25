import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertSupportTransition,supportPermissions,supportStatusTransitions,supportWaitingOn} from '../lib/support-domain';
import {SUPPORT_STATUSES} from '../lib/support-types';
import {safeNext} from '../lib/config';

test('support transitions preserve who is next and require reopening resolved conversations',()=>{
 for(const status of SUPPORT_STATUSES){
  assert.throws(()=>assertSupportTransition(status,status),{code:'ticket_transition'});
  for(const next of supportStatusTransitions(status))assert.doesNotThrow(()=>assertSupportTransition(status,next));
 }
 assert.equal(supportWaitingOn('new'),'support');assert.equal(supportWaitingOn('waiting_for_user'),'user');assert.equal(supportWaitingOn('resolved'),'none');
 assert.equal(supportPermissions('waiting_for_user',false).canReply,true);
 for(const status of ['resolved','closed']as const){assert.equal(supportPermissions(status,false).canReply,false);assert.equal(supportPermissions(status,false).canReopen,true);}
 assert.throws(()=>assertSupportTransition('closed','waiting_for_user'),{code:'ticket_transition'});
});
test('support capabilities distinguish current platform staff and an erased owner',()=>{
 assert.equal(supportPermissions('new',false).canNote,false);assert.equal(supportPermissions('new',false).canAssign,false);
 assert.equal(supportPermissions('new',true).canNote,true);assert.equal(supportPermissions('new',true).canAssign,true);
 const erased=supportPermissions('closed',true,false);for(const key of ['canReply','canClose','canReopen','canNote','canChangeStatus','canEditDetails']as const)assert.equal(erased[key],false,key);
});
test('the own moderation destination survives login without admitting arbitrary report links',()=>{
 assert.equal(safeNext('/app/reports'),'/app/reports');for(const path of['/app/reports?actor=someone','/app/reports/internal','//evil.invalid/app/reports'])assert.equal(safeNext(path),'/');
});
