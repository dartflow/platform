/** Synthetic local previews only. This module never connects to a database or mail transport. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {renderMail,templateById} from '../lib/integrations-mail';
const destination=resolve(process.argv[2]||'docs/evidence/identity-social-mail-previews-2026-11-19');
const cases=[
 {id:'friend-request',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)'}},
 {id:'friend-accepted',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)'}},
 {id:'room-invite',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)',roomName:'Vrijdagavond & vrienden'}},
 {id:'club-invite',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)',clubName:'Onze vereniging'}},
 {id:'club-request',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)',clubName:'Onze vereniging'}},
 {id:'challenge-invite',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)',startScore:'501',bestOf:'5'}},
 {id:'challenge-accepted',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)',startScore:'501',bestOf:'5'}},
 {id:'competition-lobby-ready',variables:{name:'Mila de Groot',actorName:'Zoë & Darts (@zoe.darts)',eventName:'Donderdagcompetitie'}},
 {id:'friend-accepted',suffix:'neutral',variables:{}},
 {id:'friend-request',suffix:'escaped-long',variables:{name:'Élodie van de Lange Openbare Displaynaam',actorName:'Zoë <Darts> & lange openbare displaynaam (@zoe.darts)'}}
];
await mkdir(destination,{recursive:true});const files=[];
for(const example of cases){const stem=example.id+(example.suffix?'-'+example.suffix:''),preview=renderMail(example.id,templateById(example.id).fields,example.variables as Record<string,string>,'https://dartflow.nl');for(const extension of ['html','txt'] as const){const value=extension==='html'?preview.html:preview.text;await writeFile(resolve(destination,`${stem}.${extension}`),value);files.push({file:`${stem}.${extension}`,sha256:createHash('sha256').update(value).digest('hex')});}}
await writeFile(resolve(destination,'manifest.json'),JSON.stringify({syntheticOnly:true,externalMessagesSent:0,origin:'https://dartflow.nl',logo:'/assets/dartflow-logo.png',files},null,2)+'\n');
process.stdout.write(JSON.stringify({previews:cases.length,files:files.length,destination})+'\n');
