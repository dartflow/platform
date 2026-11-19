import{randomUUID}from'node:crypto';
import type{PoolClient}from'pg';
import{DomainError}from'./domain';
import type{MatchCommand,MatchState,MatchView}from'./types';
export type OfflineScoreConflict={id:string;status:'open'|'resolved';actorId:string;requestId:string;expectedRevision:number;canonicalRevision:number;action:Record<string,unknown>;reason?:string;resolvedBy?:string;commands?:{actorId:string;requestId:string;expectedRevision:number;action:Record<string,unknown>}[]};
/** Called under the normal event/match locks after access and receipt checks. */
export async function registerOfflineConflict(client:PoolClient,source:MatchState,actor:string,command:MatchCommand,effectiveActor=actor):Promise<boolean>{
 if(command.offline!==true||!['score','undo'].includes(command.action.type)||command.expectedRevision>=source.revision||!['live','result'].includes(source.status)||source.resultPublished)return false;
 const supported=await client.query("select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind='tournament'",[source.id]);
 if(!supported.rowCount)return false;
 const savedAction={...command.action,...(command.guestId?{guestId:command.guestId}:{})};
 const prior=(await client.query<{status:string;action:Record<string,unknown>;expected_revision:number}>('select status,action,expected_revision from dartflow_private.match_offline_conflicts where match_id=$1 and actor_id=$2 and request_id=$3',[source.id,actor,command.requestId])).rows[0];
 if(prior){if(prior.expected_revision!==command.expectedRevision||JSON.stringify(prior.action)!==JSON.stringify(savedAction)){
  // jsonb canonicalizes key order; compare semantic values, never accept ID reuse.
  const same=await client.query('select 1 from dartflow_private.match_offline_conflicts where match_id=$1 and actor_id=$2 and request_id=$3 and expected_revision=$4 and action=$5::jsonb',[source.id,actor,command.requestId,command.expectedRevision,JSON.stringify(savedAction)]);if(!same.rowCount)throw new DomainError('request_reused','Dit offline actie-ID heeft al andere gegevens.',409);
 }if(prior.status==='resolved')throw new DomainError('offline_conflict_resolved','Deze bewaarde actie is met reden verworpen. Controleer de huidige scorekaart voordat je een nieuwe beurt invoert.',409);return true;}
 // A stale read is not writer authority. The accepted response at the exact
 // claimed base revision proves the writer (or that actor's own undo right).
 const proof=(await client.query<{response:MatchView;actor_id:string}>("select actor_id,response from dartflow_private.action_receipts where match_id=$1 and(response->>'revision')::integer=$2 limit 1",[source.id,command.expectedRevision])).rows[0];
 const base=proof?.response,unconfirmed=base&&!base.resultPublished&&!base.confirmations.some(Boolean)&&!base.paused&&!base.correction;
 const actorProof=actor===effectiveActor||proof?.actor_id===actor&&base?.guestOperators?.some(g=>g.id===effectiveActor&&(command.action.type==='undo'?g.permissions.canUndo:g.permissions.canScore));
 const right=actorProof&&unconfirmed&&(command.action.type==='score'?base.status==='live'&&base.writerId===effectiveActor: ['live','result'].includes(base.status)&&(base.scoringMode==='per-player'?proof.actor_id===actor&&base.permissions.canUndo:base.writerId===effectiveActor&&base.visits.length>0));
 if(!right)throw new DomainError('offline_writer_proof_required','Je was op deze basisrevisie niet de bevoegde schrijver voor deze bewaarde actie. Laad de actuele scorekaart.',403);
 if(command.action.type==='score'&&(!Number.isInteger(command.action.score)||command.action.score<0||command.action.score>180))throw new DomainError('invalid_score','Gebruik een geldige offline score.');
 if(source.offlineConflict?.status==='open'&&command.expectedRevision>=source.offlineConflict.canonicalRevision)throw new DomainError('offline_conflict_pending','De partij is al gepauzeerd op deze scorekaart. Wacht op het conflictbesluit.',409);
 const id=randomUUID(),open=source.offlineConflict?.status==='open'?source.offlineConflict:null,caseId=open?.id??id,canonicalRevision=open?.canonicalRevision??source.revision;
 await client.query('insert into dartflow_private.match_offline_conflicts(id,case_id,match_id,actor_id,request_id,expected_revision,canonical_revision,action,accepted_state)values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,caseId,source.id,actor,command.requestId,command.expectedRevision,canonicalRevision,JSON.stringify(savedAction),JSON.stringify({revision:source.revision,remaining:source.game.remaining,turn:source.game.turn,leg:source.game.legs,sets:source.previousSets.length,visitCount:[...source.previousSets,source.game].reduce((n,g)=>n+g.visits.length,0)})]);
 if(!open){source.offlineConflict={id:caseId,status:'open',actorId:actor,requestId:command.requestId,expectedRevision:command.expectedRevision,canonicalRevision,action:command.action};source.paused=true;source.pausedBy=actor;source.revision++;await client.query('update dartflow_private.matches set state=$2,revision=$3,updated_at=now()where id=$1',[source.id,JSON.stringify(source),source.revision]);}
 await client.query("insert into dartflow_private.audit_events(actor_id,club_id,event_id,match_id,action,detail)values($1,$2,$3,$4,'offline-conflict.opened',$5)",[actor,source.clubId,source.eventId,source.id,JSON.stringify({conflictId:caseId,requestId:command.requestId,expectedRevision:command.expectedRevision,canonicalRevision,action:command.action})]);
 return true;
}
export async function resolveOfflineConflict(client:PoolClient,source:MatchState,actor:string,command:MatchCommand,canManage:boolean):Promise<MatchState>{
 const action=command.action;if(action.type!=='resolve-offline-conflict')throw new DomainError('invalid_action','Kies een conflictbesluit.');
 if(!canManage)throw new DomainError('forbidden','Alleen de bevoegde wedstrijdleiding handelt het offline conflict af.',403);
 const conflict=source.offlineConflict;if(conflict?.status!=='open'||action.conflictId!==conflict.id)throw new DomainError('offline_conflict_changed','Dit conflict is al gewijzigd. Vernieuw de scorekaart.',409);
 if(typeof action.reason!=='string'||action.reason.trim().length<3||action.reason.length>1000)throw new DomainError('reason_required','Leg vast waarom de geaccepteerde scorekaart wordt behouden en de offline acties vervallen.');
 const next=structuredClone(source);next.offlineConflict={...conflict,status:'resolved',reason:action.reason.trim(),resolvedBy:actor};next.paused=false;next.pausedBy=null;next.revision++;
 await client.query("update dartflow_private.match_offline_conflicts set status='resolved',reason=$2,resolved_by=$3,resolved_at=clock_timestamp()where case_id=$1 and status='open'",[conflict.id,action.reason.trim(),actor]);
 return next;
}
export function offlineConflictPermissions(view:MatchView):MatchView{
 if(view.offlineConflict?.status!=='open')return view;
 return{...view,permissions:{...view.permissions,canScore:false,canWrite:false,canUndo:false,canResume:false,canTakeOver:false,canConfirm:false,canRequestCorrection:false,canAnswerCorrection:false}};
}

export async function offlineConflictDetails(client:Pick<PoolClient,'query'>,view:MatchView):Promise<MatchView>{
 if(!view.offlineConflict)return view;
 const commands=(await client.query<{actor_id:string;request_id:string;expected_revision:number;action:Record<string,unknown>}>('select actor_id,request_id,expected_revision,action from dartflow_private.match_offline_conflicts where match_id=$1 and case_id=$2 order by created_at,id',[view.id,view.offlineConflict.id])).rows.map(r=>({actorId:r.actor_id,requestId:r.request_id,expectedRevision:r.expected_revision,action:r.action}));
 return{...view,offlineConflict:{...view.offlineConflict,commands}};
}
