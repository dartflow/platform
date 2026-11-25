import{createHash,randomUUID}from'node:crypto';
import type{PoolClient}from'pg';
import{DomainError,applyMatchAction,matchView}from'./domain';
import{canonical}from'./platform-store';
import type{MatchCommand,MatchState,MatchView}from'./types';
export type OfflineReplayProof={baseRevision:number;sequence:number;acceptedPrefix?:MatchCommand[]};
export type OfflineScoreConflict={id:string;status:'open'|'resolved';actorId:string;requestId:string;expectedRevision:number;canonicalRevision:number;action:Record<string,unknown>;reason?:string;resolvedBy?:string;decision?:'keep-server'|'use-offline';canResolve?:boolean;readings?:{canonical:MatchView;offline:MatchView|null};commands?:{actorId:string;requestId:string;expectedRevision:number;action:Record<string,unknown>}[]};
/** Called under the normal event/match locks after access and receipt checks. */
export async function registerOfflineConflict(client:PoolClient,source:MatchState,actor:string,command:MatchCommand,effectiveActor=actor,replay?:OfflineReplayProof):Promise<boolean>{
 if(command.offline!==true||!['score','undo'].includes(command.action.type)||(command.expectedRevision>=source.revision&&!replay)||!['live','result','interrupted'].includes(source.status)||source.resultPublished)return false;
 if(source.confirmations.some(Boolean)||source.correction)throw new DomainError('offline_confirmation_locked','Deze scorekaart is al ondertekend of wacht op een correctiebesluit. Laat de leiding de bewaarde invoer via die procedure beoordelen.',409);
 const savedAction={...command.action,...(command.guestId?{guestId:command.guestId}:{})};
 const prior=(await client.query<{status:string;action:Record<string,unknown>;expected_revision:number}>('select status,action,expected_revision from dartflow_private.match_offline_conflicts where match_id=$1 and actor_id=$2 and request_id=$3',[source.id,actor,command.requestId])).rows[0];
 if(prior){if(prior.expected_revision!==command.expectedRevision||JSON.stringify(prior.action)!==JSON.stringify(savedAction)){
  // jsonb canonicalizes key order; compare semantic values, never accept ID reuse.
  const same=await client.query('select 1 from dartflow_private.match_offline_conflicts where match_id=$1 and actor_id=$2 and request_id=$3 and expected_revision=$4 and action=$5::jsonb',[source.id,actor,command.requestId,command.expectedRevision,JSON.stringify(savedAction)]);if(!same.rowCount)throw new DomainError('request_reused','Dit offline actie-ID heeft al andere gegevens.',409);
 }if(prior.status==='resolved')throw new DomainError('offline_conflict_resolved','Deze bewaarde actie is met reden verworpen. Controleer de huidige scorekaart voordat je een nieuwe beurt invoert.',409);return true;}
 // A stale read is not writer authority. The accepted response at the exact
 // claimed base revision proves the writer (or that actor's own undo right).
 const proof=(await client.query<{response:MatchView;actor_id:string}>("select actor_id,response from dartflow_private.action_receipts where match_id=$1 and(response->>'revision')::integer=$2 limit 1",[source.id,replay?.baseRevision??command.expectedRevision])).rows[0];
 const base=proof?.response,unconfirmed=base&&!base.resultPublished&&!base.confirmations.some(Boolean)&&!base.paused&&!base.correction;
 const actorProof=actor===effectiveActor||proof?.actor_id===actor&&base?.guestOperators?.some(g=>g.id===effectiveActor&&(command.action.type==='undo'?g.permissions.canUndo:g.permissions.canScore));
 const right=actorProof&&unconfirmed&&(command.action.type==='score'?base.status==='live'&&base.writerId===effectiveActor: ['live','result'].includes(base.status)&&(base.scoringMode==='per-player'?(base.remoteWriterIds?.[base.visits.at(-1)?.playerIndex??-1]??base.visits.at(-1)?.throwerId??base.visits.at(-1)?.player)===effectiveActor:base.writerId===effectiveActor&&base.visits.length>0));
 if(!right)throw new DomainError('offline_writer_proof_required','Je was op deze basisrevisie niet de bevoegde schrijver voor deze bewaarde actie. Laad de actuele scorekaart.',403);
 if(command.action.type==='score'&&(!Number.isInteger(command.action.score)||command.action.score<0||command.action.score>180))throw new DomainError('invalid_score','Gebruik een geldige offline score.');
 if(source.offlineConflict?.status==='open'&&!replay&&command.expectedRevision>=source.offlineConflict.canonicalRevision)throw new DomainError('offline_conflict_pending','De partij is al gepauzeerd op deze scorekaart. Wacht op het conflictbesluit.',409);
 if(replay&&(replay.sequence<0||command.expectedRevision!==replay.baseRevision+replay.sequence))throw new DomainError('invalid_replay','De offline reeks heeft geen aaneengesloten basis.');
 const open=source.offlineConflict?.status==='open'?source.offlineConflict:null,baseState=open?null:await restoreReplayBase(client,source,base!,actor,effectiveActor,replay),id=randomUUID(),caseId=open?.id??id,canonicalRevision=open?.canonicalRevision??source.revision;
 await client.query('insert into dartflow_private.match_offline_conflicts(id,case_id,match_id,actor_id,request_id,expected_revision,canonical_revision,action,accepted_state,queue_base_revision)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,caseId,source.id,actor,command.requestId,command.expectedRevision,canonicalRevision,JSON.stringify(savedAction),JSON.stringify({canonicalState:source,baseState,revision:source.revision,remaining:source.game.remaining,turn:source.game.turn,leg:source.game.legs,sets:source.previousSets.length,visitCount:[...source.previousSets,source.game].reduce((n,g)=>n+g.visits.length,0)}),replay?.baseRevision??null]);
 if(!open){source.offlineConflict={id:caseId,status:'open',actorId:actor,requestId:command.requestId,expectedRevision:command.expectedRevision,canonicalRevision,action:command.action};source.paused=true;source.pausedBy=actor;source.revision++;await client.query('update dartflow_private.matches set state=$2,revision=$3,updated_at=now()where id=$1',[source.id,JSON.stringify(source),source.revision]);}
 await client.query("insert into dartflow_private.audit_events(actor_id,club_id,event_id,match_id,action,detail)values($1,$2,$3,$4,'offline-conflict.opened',$5)",[actor,source.clubId,source.eventId,source.id,JSON.stringify({conflictId:caseId,requestId:command.requestId,expectedRevision:command.expectedRevision,canonicalRevision,action:command.action})]);
 return true;
}
/** Only this actor's exact accepted queue prefix may advance its proven basis. */
async function restoreReplayBase(client:Pick<PoolClient,'query'>,source:MatchState,base:MatchView,actor:string,effectiveActor:string,replay?:OfflineReplayProof):Promise<MatchState|null>{
 let next=restoreBase(source,base);if(!replay?.sequence)return next;
 const prefix=replay.acceptedPrefix??[];if(prefix.length!==replay.sequence)throw new DomainError('offline_writer_proof_required','De geaccepteerde voorloop van deze wachtrij is niet bewezen.',403);
 for(const[index,command]of prefix.entries()){
  const fingerprint=createHash('sha256').update(canonical({expectedRevision:command.expectedRevision,action:command.action,...(command.guestId?{guestId:command.guestId}:{})})).digest('hex'),receipt=(await client.query<{payload_hash:string;response:MatchView}>('select payload_hash,response from dartflow_private.action_receipts where match_id=$1 and actor_id=$2 and request_id=$3',[source.id,actor,command.requestId])).rows[0];
  if(command.matchId!==source.id||command.expectedRevision!==replay.baseRevision+index||!['score','undo'].includes(command.action.type)||!receipt||receipt.payload_hash!==fingerprint||receipt.response.revision!==command.expectedRevision+1)throw new DomainError('offline_writer_proof_required','Deze voorloop hoort niet bij de werkelijk geaccepteerde eigen wachtrij.',403);
  if(!next)continue;
  try{next=applyMatchAction(next,command.guestId??effectiveActor,false,command.action);}catch{return null;}
  const actual=matchView(next,actor,false),keys=['visits','remaining','legs','sets','status','winnerId']as const;
  if(keys.some(key=>canonical(actual[key])!==canonical(receipt.response[key])))return null;
 }
 return next;
}
function restoreBase(source:MatchState,base:MatchView):MatchState|null{
 const next=structuredClone(source),wanted=base.visits.length;const count=()=>[...next.previousSets,next.game].flatMap(g=>g.visits).length;
 while(count()>wanted){if(!next.game.history.length&&next.previousSets.length)next.game=next.previousSets.pop()!;if(!next.game.history.length)return null;next.game={...structuredClone(next.game.history.at(-1)!),history:structuredClone(next.game.history.slice(0,-1))};}
 if(canonical([...next.previousSets,next.game].flatMap(g=>g.visits))!==canonical(base.visits))return null;
 next.revision=base.revision;next.writerId=base.writerId;next.delegatedWriterId=base.delegatedWriterId;next.remoteWriterIds=base.remoteWriterIds;next.scoringMode=base.scoringMode;next.status=base.status;next.paused=false;next.pausedBy=null;next.offlineConflict=undefined;next.confirmations=[false,false];next.resultPublished=false;next.resultRevision=base.resultRevision;next.winnerId=base.winnerId;return next;
}
export async function canResolveOfflineConflict(client:Pick<PoolClient,'query'>,source:MatchState,actor:string,canManage:boolean):Promise<boolean>{
 if(canManage)return true;return Boolean((await client.query("select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind='lobby'and e.owner_id=$2",[source.id,actor])).rowCount);
}
async function alternative(client:Pick<PoolClient,'query'>,source:MatchState):Promise<MatchState|null>{
 const rows=(await client.query<{actor_id:string;action:Record<string,unknown>;expected_revision:number;accepted_state:{baseState?:MatchState}}>('select actor_id,action,expected_revision,accepted_state from dartflow_private.match_offline_conflicts where match_id=$1 and case_id=$2 order by expected_revision,created_at,id',[source.id,source.offlineConflict?.id])).rows;
 let next=rows[0]?.accepted_state.baseState?structuredClone(rows[0].accepted_state.baseState):null;if(!next)return null;
 try{for(const command of rows){if(command.expected_revision!==next.revision)return null;const{guestId,...action}=command.action;next=applyMatchAction(next,typeof guestId==='string'?guestId:command.actor_id,false,action as MatchCommand['action']);}return next;}catch{return null;}
}
export async function resolveOfflineConflict(client:PoolClient,source:MatchState,actor:string,command:MatchCommand,canManage:boolean):Promise<MatchState>{
 const action=command.action;if(action.type!=='resolve-offline-conflict')throw new DomainError('invalid_action','Kies een conflictbesluit.');
 if(!await canResolveOfflineConflict(client,source,actor,canManage))throw new DomainError('forbidden','Alleen de bevoegde wedstrijdleiding of beheerder van deze vrije partij handelt het conflict af.',403);
 const conflict=source.offlineConflict;if(conflict?.status!=='open'||action.conflictId!==conflict.id)throw new DomainError('offline_conflict_changed','Dit conflict is al gewijzigd. Vernieuw de scorekaart.',409);
 if(typeof action.reason!=='string'||action.reason.trim().length<3||action.reason.length>1000)throw new DomainError('reason_required','Leg vast welke lezing geldig is en waarom.');
 const decision=action.decision??'keep-server';if(!['keep-server','use-offline'].includes(decision))throw new DomainError('invalid_decision','Kies welke scorekaart geldig is.');
 const chosen=decision==='use-offline'?await alternative(client,source):source;if(!chosen)throw new DomainError('offline_base_unavailable','De bewaarde invoer heeft geen aaneengesloten bewezen basis. Behoud de serverstand en corrigeer de getoonde beurten met reden.',409);
 const next=structuredClone(chosen);next.writerId=source.writerId;next.delegatedWriterId=source.delegatedWriterId;next.remoteWriterIds=source.remoteWriterIds;next.boardId=source.boardId;next.remoteBoardIds=source.remoteBoardIds;next.offlineConflict={...conflict,status:'resolved',reason:action.reason.trim(),resolvedBy:actor,decision};next.paused=false;next.pausedBy=null;next.revision=source.revision+1;
 if(source.status==='interrupted'){next.status='interrupted';next.boardInterruption=source.boardInterruption;next.boardId=null;}
 await client.query("update dartflow_private.match_offline_conflicts set status='resolved',reason=$2,resolved_by=$3,resolved_at=clock_timestamp()where case_id=$1 and status='open'",[conflict.id,action.reason.trim(),actor]);return next;
}
export function offlineConflictPermissions(view:MatchView):MatchView{
 if(view.offlineConflict?.status!=='open')return view;
 return{...view,permissions:{...view.permissions,canScore:false,canWrite:false,canUndo:false,canResume:false,canTakeOver:false,canConfirm:false,canRequestCorrection:false,canAnswerCorrection:false}};
}

export async function offlineConflictDetails(client:Pick<PoolClient,'query'>,view:MatchView,source?:MatchState,actor?:string):Promise<MatchView>{
 if(!view.offlineConflict)return view;
 const commands=(await client.query<{actor_id:string;request_id:string;expected_revision:number;action:Record<string,unknown>}>('select actor_id,request_id,expected_revision,action from dartflow_private.match_offline_conflicts where match_id=$1 and case_id=$2 order by created_at,id',[view.id,view.offlineConflict.id])).rows.map(r=>({actorId:r.actor_id,requestId:r.request_id,expectedRevision:r.expected_revision,action:r.action}));
 const canResolve=source&&actor?await canResolveOfflineConflict(client,source,actor,view.permissions.canManage):view.permissions.canManage;
 const candidate=source?await alternative(client,source):null;const plain={...view,offlineConflict:undefined};delete plain.scoringState;
 return{...view,offlineConflict:{...view.offlineConflict,commands,canResolve,...(source?{readings:{canonical:plain,offline:candidate?matchView({...candidate,offlineConflict:undefined},actor??'',false):null}}:{})}};
}

/** Historical writer proof permits queue submission only; current event ACL remains mandatory. */
export async function historicalOfflineWriter(client:Pick<PoolClient,'query'>,source:MatchState,actor:string,command:MatchCommand,baseRevision=command.expectedRevision):Promise<boolean>{
 if(!command.offline||!['score','undo'].includes(command.action.type))return false;
 return Boolean((await client.query("select 1 from dartflow_private.action_receipts where match_id=$1 and(response->>'revision')::integer=$2 and response->>'writerId'=$3 and response->>'resultPublished'='false'and response->>'paused'is distinct from'true'and not exists(select 1 from jsonb_array_elements(response->'confirmations')v where v='true'::jsonb)",[source.id,baseRevision,actor])).rowCount);
}
