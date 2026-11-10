import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBaanPhone} from '../public/baan-phone.js';
import {applyBoard, boardView, createBoard} from '../worker/baan-domain.js';

test('an incoming score does not close the open writer takeover confirmation', () => {
  const first = {id:'sam', name:'Sam'};
  const second = {id:'bo', name:'Bo'};
  let board = createBoard('duindorp-baan-1');
  const apply = (actor, action) => {
    const result = applyBoard(board, actor, action);
    assert.equal(result.error, undefined);
    board = result.state;
  };
  apply(first, {type:'start', mode:'local', matchId:'local-1'});
  apply(second, {type:'join'});
  apply(second, {type:'accept'});
  const phone = createBaanPhone({
    state:() => boardView(board, second), actor:() => second, history:() => [],
    online:() => true, url:() => '/', render:() => {}
  });
  phone.view();
  phone.handleAction({closest:() => ({dataset:{action:'baan-phone-ask-takeover'}})});
  assert.match(phone.view(), /Ja, ik neem over/);

  apply(first, {type:'score', score:180, darts:3});
  assert.match(phone.view(), /321/);
  assert.match(phone.view(), /Ja, ik neem over/);

  apply(second, {type:'take-over'});
  assert.match(phone.view(), /Score invoeren/);
  assert.doesNotMatch(phone.view(), /Ja, ik neem over/);
});
