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
  assert.match(phone.view(), /Resterende scores/);
  assert.doesNotMatch(phone.view(), /Wedstrijdhistorie|Legs|data-form="baan-phone-score"/i);
  phone.handleAction({closest:() => ({dataset:{action:'baan-phone-ask-takeover'}})});
  assert.match(phone.view(), /Ja, ik neem over/);

  apply(first, {type:'score', score:180, darts:3});
  assert.match(phone.view(), /321/);
  assert.match(phone.view(), /Ja, ik neem over/);

  apply(second, {type:'take-over'});
  assert.match(phone.view(), /Score invoeren/);
  assert.match(phone.view(), /data-form="baan-phone-score"/);
  assert.doesNotMatch(phone.view(), /Ja, ik neem over/);
});

test('Sprint phone keeps the remaining score and locks its keypad during double confirmation', async () => {
  const player = {id:'sam', name:'Sam'};
  let board = createBoard('duindorp-baan-1');
  function send(action) {
    const result = applyBoard(board, player, action);
    assert.equal(result.error, undefined);
    board = result.state;
    return result;
  }
  send({type:'start', mode:'practice', startScore:301, bestOfLegs:3, matchId:'sprint-1'});
  send({type:'score', score:180});
  send({type:'score', score:81});
  const actions = [];
  const phone = createBaanPhone({
    state:() => boardView(board, player), actor:() => player, online:() => true, url:() => '/', render:() => {},
    send(action) { actions.push(action); return send(action); }
  });

  assert.match(phone.view(), />40</);
  phone.handleForm({dataset:{form:'baan-phone-score'}}, {score:'40', darts:'1'});
  await Promise.resolve();
  assert.match(phone.view(), /Dubbel geraakt\?/);
  assert.match(phone.view(), />40</);
  assert.doesNotMatch(phone.view(), /data-form="baan-phone-score"/);
  phone.handleAction({closest:() => ({dataset:{action:'baan-phone-double'}})});
  await Promise.resolve();
  assert.deepEqual(actions.map(({matchId, doubleConfirmed}) => [matchId, doubleConfirmed]), [['sprint-1',false], ['sprint-1',true]]);
  assert.match(phone.view(), />301</);
  assert.match(phone.view(), /data-form="baan-phone-score"/);
});
