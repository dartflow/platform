import {database} from './db';
import {DomainError} from './domain';
import {assertAccountActive} from './account-removal';
import {readChallengeSource} from './play-challenges';
import {legSourceEligibility} from './play-rules';
import {finalResultSql} from './result-visibility';
import type {MatchState} from './types';
import type {StoredPlaySession} from './play-session-types';
export type PlaySourceOption={sourceKind:'match'|'play';sourceId:string;playerId:string;set:number;leg:number;name:string;eligible:boolean;reason:string|null;comparison:'darts'|'visits'|null;publicAllowed:boolean};
export async function getPlaySources(actor:string,sharedId?:string):Promise<{sources:PlaySourceOption[]}>{await assertAccountActive(actor);const c=database(),sources:PlaySourceOption[]=[];
 const matches=(await c.query<{state:MatchState}>(`select m.state from dartflow_private.matches m join dartflow_private.match_results r on r.match_id=m.id where exists(select 1 from dartflow_private.match_players p where p.match_id=m.id and p.user_id=$1)and ${finalResultSql} order by r.created_at desc limit 30`,[actor])).rows;
 const add=async(kind:'match'|'play',id:string,playerId:string,set:number,leg:number,label:string)=>{try{const result=await readChallengeSource({accountId:actor},kind,id,playerId,set,leg),e=legSourceEligibility(result.source);sources.push({sourceKind:kind,sourceId:id,playerId,set,leg,name:`${label} · set ${set}, leg ${leg} · ${result.source.startScore}`,eligible:e.eligible,reason:e.reason,comparison:e.comparison,publicAllowed:result.publicAllowed});}catch(e){if(!(e instanceof DomainError)||e.status>=500)throw e;sources.push({sourceKind:kind,sourceId:id,playerId,set,leg,name:`${label} · set ${set}, leg ${leg}`,eligible:false,reason:e.message,comparison:null,publicAllowed:false});}};
 for(const {state:m}of matches){if((m.settings.discipline??'x01')!=='x01')continue;for(const [set,g]of [...m.previousSets,m.game].entries()){for(const leg of [...new Set(g.visits.filter(v=>v.checkout&&v.player===actor).map(v=>v.leg))]){await add('match',m.id,actor,set+1,leg,'Mijn gespeelde leg');if(sources.length>=100)return{sources};}}}
 const sessions=(await c.query<{state:StoredPlaySession}>("select state from dartflow_private.play_sessions where status='completed' and exists(select 1 from jsonb_array_elements(state->'participants')p where p->>'accountId'=$1::text or p->>'claimedBy'=$1::text)order by updated_at desc limit 30",[actor])).rows;
 for(const {state:s}of sessions){if(s.game.rules.mode!=='x01')continue;const p=s.participants.find(p=>p.accountId===actor||p.claimedBy===actor);if(!p)continue;for(const v of s.game.visits.filter(v=>v.finish&&v.throwerId===p.id)){await add('play',s.id,p.id,v.set,v.leg,'Mijn vrije leg');if(sources.length>=100)return{sources};}}
 if(sharedId){await readChallengeSource({accountId:actor},'match',sharedId);const share=(await c.query('select source_id from dartflow_private.feed_shares where id=$1 and revoked_at is null',[sharedId])).rows[0],m=(await c.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[share?.source_id??sharedId])).rows[0]?.state;if(m)for(const [set,g]of[...m.previousSets,m.game].entries())for(const v of g.visits.filter(v=>v.checkout))await add('match',sharedId,m.players[v.playerIndex].id,set+1,v.leg,'Gedeelde gespeelde leg');}
 return{sources};}
