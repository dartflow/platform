import {scorePlayVisit} from './play-rules';
import type {PlaySessionView,PlayQueuedCommand,PlayResponse} from './play-session-types';
import type {PlayState,PlayVisitInput} from './play-types';
export type StoredPlayClient={version:1;session:PlaySessionView;token?:string;grants:NonNullable<PlaySessionView['privateAccess']>['grants'];queue:PlayQueuedCommand[];participantId?:string;claimToken?:string};
export function projectPlayQueue(base:PlaySessionView,queue:PlayQueuedCommand[]):PlaySessionView{
 let game:PlayState={...structuredClone(base.game),undo:[]};for(const command of queue){if(command.rulesHash!==base.rulesHash||command.writerEpoch!==base.writer.epoch)throw Error('De regels of schrijver zijn gewijzigd. Controle nodig.');if(base.deviceMode==='individual'&&command.participantId!==game.currentThrowerId)throw Error('Wacht tot je eigen beurt is toegestaan.');game=scorePlayVisit(game,command.input);}
 const {undo:_,...snapshot}=game;void _;return{...base,game:snapshot,revision:base.revision+queue.length,permissions:{...base.permissions,canScore:base.permissions.canScore&&game.status==='live'&&(base.deviceMode==='shared'||!queue.length||queue.at(-1)?.participantId===game.currentThrowerId)}};
}
export function queuePlayVisit(record:StoredPlayClient,input:PlayVisitInput,requestId:string):StoredPlayClient{
 if(record.queue.length>=100)throw Error('Synchroniseer eerst de 100 bewaarde beurten.');const projected=projectPlayQueue(record.session,record.queue);if(!projected.permissions.canScore||projected.status!=='active')throw Error('Je hebt nu geen schrijfrecht.');const command:PlayQueuedCommand={requestId,expectedRevision:record.session.revision+record.queue.length,writerEpoch:record.session.writer.epoch,rulesHash:record.session.rulesHash,...(record.session.deviceMode==='individual'?{participantId:record.participantId??projected.game.currentThrowerId}:{}),input};const next={...record,queue:[...record.queue,command]};projectPlayQueue(next.session,next.queue);return next;
}
export function acceptPlayResponse(record:StoredPlayClient,response:PlayResponse):StoredPlayClient{
 const accepted=new Set(response.accepted??[]),queue=record.queue.filter(v=>!accepted.has(v.requestId)),session=response.session??record.session,byToken=new Map(record.grants.map(g=>[g.token,g]));for(const grant of session.privateAccess?.grants??[])byToken.set(grant.token,grant);return{...record,session,queue,grants:[...byToken.values()]};
}
export const playClientKey=(id:string)=>`dartflow-play-v1:${id}`;
export function readPlayClient(id:string):StoredPlayClient|null{try{const raw=localStorage.getItem(playClientKey(id));if(!raw)return null;const value=JSON.parse(raw)as StoredPlayClient;return value.version===1&&value.session.id===id&&Array.isArray(value.queue)?value:null;}catch{return null;}}
export function persistPlayClient(record:StoredPlayClient){
 try{localStorage.setItem(playClientKey(record.session.id),JSON.stringify(record));}
 catch{throw Error('Toestelopslag is niet beschikbaar. Je invoer is nog niet bewaard. Houd dit scherm open en maak opslagruimte vrij.');}
 // The recoverable queue is authoritative; this navigation shortcut is optional.
 try{localStorage.setItem('dartflow-play-last-session',record.session.id);}catch{/* Keep the successfully stored session and its exact action IDs. */}
}
