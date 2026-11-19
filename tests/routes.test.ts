import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacyDestination,ownsPrivatePlayFragment} from '../lib/routes';
test('legacy hubs resolve but unknown prototype IDs never become a current match',()=>{
  assert.equal(legacyDestination('#home'),'/');
  assert.equal(legacyDestination('#match/1'),'/link-onbekend');
  assert.equal(legacyDestination('#baan-phone/duindorp-baan-1'),'/link-onbekend');
  assert.equal(legacyDestination('#baan-screen/duindorp-baan-1'),'/link-onbekend');
  assert.equal(legacyDestination('#match/30000000-0000-4000-8000-000000000001'),'/wedstrijd/30000000-0000-4000-8000-000000000001');
  assert.equal(legacyDestination('#baan-screen/30000000-0000-4000-8000-000000000001'),'/oche-live/30000000-0000-4000-8000-000000000001');
  assert.equal(legacyDestination('#baanbeheer'),'/app/locations');
  assert.equal(legacyDestination('#reservations'),'/app/reservations');
  assert.equal(legacyDestination('#feed'),'/app/feed');
});

test('private guest and challenge fragments belong only to their exact new destination',()=>{const id='30000000-0000-4000-8000-000000000001',token=id+'.'+'a'.repeat(43);for(const purpose of['controller','participant','claim','recovery'])assert.equal(ownsPrivatePlayFragment('/spelen/'+id,'#'+purpose+'='+token),true);assert.equal(ownsPrivatePlayFragment('/leg/'+id,'#code='+'a'.repeat(43)),true);assert.equal(ownsPrivatePlayFragment('/app','#controller='+token),false);assert.equal(ownsPrivatePlayFragment('/spelen/'+id,'#match/'+id),false);assert.equal(ownsPrivatePlayFragment('/spelen/'+id,'#controller=invalid'),false);});
