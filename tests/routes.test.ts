import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacyDestination} from '../lib/routes';
test('legacy hubs resolve but unknown prototype IDs never become a current match',()=>{
  assert.equal(legacyDestination('#home'),'/');
  assert.equal(legacyDestination('#match/1'),'/link-onbekend');
  assert.equal(legacyDestination('#baan-phone/duindorp-baan-1'),'/link-onbekend');
  assert.equal(legacyDestination('#baan-screen/duindorp-baan-1'),'/link-onbekend');
  assert.equal(legacyDestination('#match/30000000-0000-4000-8000-000000000001'),'/wedstrijd/30000000-0000-4000-8000-000000000001');
});
