import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasConfirmedUsername,normalizeDisplayName,validDisplayName} from '../lib/display-name';
import {verifiedProfileValues} from '../lib/accounts';

test('usernames retain Unicode scoreboard label rules and require a server-owned confirmed claim',()=>{
 for(const name of ['Zoë de Groot','李明','محمد','Darter 42','Speler met spaties','¼','²','Ⅷ'])assert.equal(validDisplayName(name),true);
 assert.equal(normalizeDisplayName(' \uFEFF Zoë\u00A0\u2007 de\u202F Groot\u3000 '),'Zoë de Groot');
 assert.equal(hasConfirmedUsername({name:'Speler met spaties',displayNameConfirmed:true}),true);
 assert.equal(hasConfirmedUsername({name:'Speler met spaties',displayNameConfirmed:false}),false);
 assert.equal(hasConfirmedUsername({name:'Nieuwe speler',displayNameConfirmed:true}),false);
 assert.equal(hasConfirmedUsername({name:'\u200BNaam',displayNameConfirmed:true}),false);
 const proposal=verifiedProfileValues({id:'00000000-0000-4000-8000-000000000001',user_metadata:{full_name:' Zoë\u00A0  de Groot ',display_name_confirmed:true}});
 assert.equal(proposal.name,'Zoë de Groot');assert.equal('displayNameConfirmed' in proposal,false);
});
