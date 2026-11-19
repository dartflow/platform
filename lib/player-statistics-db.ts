import {isMultiPlayerMatch,matchParticipants,matchSideIndex} from './match-sides';
import {playerContribution} from './player-contributions';
import type {PoolClient} from 'pg';
import {database} from './db';
import {finalResultSql} from './result-visibility';
import {DomainError} from './domain';
import type {Game,MatchState,Profile} from './types';
import type {Fixture} from './platform-types';
import {competitionStatisticsClassification} from './player-statistics-classification';
import type {OcheHistoricalStatistics,PlayerStatisticsResponse,StatisticsFilter,StatisticsMatch,StatisticsSummary,TrainingStatisticsSource,TournamentStatistics} from './player-statistics-types';
import {statisticsRulesMatch,buildOpponentStatistics,calculatePlayerMeasures,combinePlayerMeasures,currentPlayerProfiles,matchGames,practiceStatistics,statisticsMatchRow,summarizePlayerStatistics,uniqueStatisticsMatches} from './player-statistics';
type Client=Pick<PoolClient,'query'>;
const uuid=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new DomainError('invalid_id','Ongeldige identificatie.');return value;};
const page=(value:number|undefined,fallback:number,max=100_000)=>Number.isSafeInteger(value)&&value!>=0?Math.min(value!,max):fallback;
const stamp=(value:string|Date)=>value instanceof Date?value.toISOString():new Date(value).toISOString();
async function profiles(client:Client,ids:string[]):Promise<Profile[]>{if(!ids.length)return[];return(await client.query<Profile>('select id,name,username,show_public_statistics as "showPublicStatistics",display_name_confirmed as "displayNameConfirmed" from dartflow_private.profile_labels where id=any($1::uuid[])',[ids])).rows;}
/** Account IDs, not names, select the history. A projection/link can never create another match identity. */
export async function readPlayerStatisticsMatches(client:Client,actor:string):Promise<StatisticsMatch[]>{
 const {rows}=await client.query<{id:string;state:MatchState;completed_at:string|Date;competition_id:string|null;competition_name:string|null;competition_kind:'league'|'tournament'|null;fixture_id:string|null;competition_state:{fixtures?:{id:string;phase:string;round:number}[]}|null}>(`select m.id,jsonb_set(jsonb_set(m.state,'{game}',(m.state->'game')-'history'),'{previousSets}',coalesce((select jsonb_agg(g.value-'history') from jsonb_array_elements(coalesce(m.state->'previousSets','[]'::jsonb)) g(value)),'[]'::jsonb)) state,r.created_at completed_at,competition.id competition_id,competition.kind competition_kind,competition.state->>'name' competition_name,competition.state competition_state,link.fixture_id
  from dartflow_private.matches m join dartflow_private.match_results r on r.match_id=m.id
  left join lateral(select l.entity_id,l.fixture_id from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=m.id and e.kind in('league','tournament') order by l.entity_id limit 1) link on true
  left join dartflow_private.platform_entities competition on competition.id=link.entity_id
  where (exists(select 1 from dartflow_private.match_players participant where participant.match_id=m.id and participant.user_id=$1) or exists(select 1 from jsonb_array_elements(coalesce(m.state->'sideParticipants','[]'::jsonb)) side cross join lateral jsonb_array_elements(side.value) person where person.value->>'id'=$1::text)) and (${finalResultSql}) order by r.created_at desc,m.id desc`,[uuid(actor)]);
 const current=await profiles(client,[...new Set(rows.flatMap(r=>matchParticipants(r.state).map(p=>p.id)))]);
 return rows.map(row=>{const fixture=row.competition_state?.fixtures?.find(f=>f.id===row.fixture_id);return{id:row.id,completedAt:stamp(row.completed_at),state:currentPlayerProfiles(row.state,current),profiles:current,...(row.competition_id&&row.competition_kind?{competition:{id:row.competition_id,name:row.competition_name??'Evenement',kind:row.competition_kind,...(fixture?{phase:fixture.phase,round:fixture.round}:{})}}:{})};});
}
async function trainingRows(client:Client,actor:string){const {rows}=await client.query<{id:string;state:Record<string,unknown>;updated_at:string|Date}>(`select id,state,updated_at from dartflow_private.platform_entities where kind='training' and owner_id=$1 and state->>'completed'='true' and coalesce(state->>'discarded','false')<>'true' order by updated_at desc,id desc`,[actor]);return rows.map(r=>practiceStatistics({id:r.id,name:String(r.state.name??'Oefenen'),mode:String(r.state.mode??'solo'),completedAt:stamp(r.updated_at),completed:true,discarded:false,game:r.state.game as Game|undefined,rounds:r.state.rounds as number[]|undefined}as TrainingStatisticsSource,actor)).filter((v):v is NonNullable<typeof v>=>Boolean(v));}
export type PlayerStatisticsOptions={outRule?:StatisticsFilter['outRule'];inRule?:StatisticsFilter['inRule'];handicap?:boolean;startScore?:301|501|701;offset?:number;limit?:number;opponent?:string;search?:string;opponentOffset?:number;practiceOffset?:number};
export async function getPlayerStatistics(actor:string,options:PlayerStatisticsOptions={}):Promise<PlayerStatisticsResponse>{
 uuid(actor);const client=await database().connect();try{await client.query('begin isolation level repeatable read read only');const result=await readPlayerStatistics(client,actor,options);await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
async function readPlayerStatistics(client:Client,actor:string,options:PlayerStatisticsOptions):Promise<PlayerStatisticsResponse>{
 if(options.startScore!==undefined&&![301,501,701].includes(options.startScore))throw new DomainError('invalid_filter','Kies 301, 501 of 701.');
 if(options.outRule&&!['double-out','straight-out','master-out'].includes(options.outRule)||options.inRule&&!['single','double'].includes(options.inRule))throw new DomainError('invalid_filter','Kies geldige spelregels.');
 const filter:StatisticsFilter={startScore:options.startScore??501,outRule:options.outRule??'double-out',...(options.inRule?{inRule:options.inRule}:{}),...(options.handicap?{handicap:true}:{})},offset=page(options.offset,0),limit=Math.max(1,page(options.limit,20,50)),opponentOffset=page(options.opponentOffset,0),practiceOffset=page(options.practiceOffset,0),all=await readPlayerStatisticsMatches(client,actor),played=uniqueStatisticsMatches(all),selected=played.filter(r=>statisticsRulesMatch(r.state,filter)&&(!options.opponent||r.state.players.some(p=>p.id===uuid(options.opponent!)))),rows=selected.map(r=>statisticsMatchRow(r,actor));
 const search=(options.search??'').trim().replace(/^@/,'').normalize('NFC').toLocaleLowerCase('nl'),opponents=buildOpponentStatistics(played.filter(r=>statisticsRulesMatch(r.state,filter)),actor).filter(r=>!search||[r.opponent.name,r.opponent.username??''].some(name=>name.normalize('NFC').toLocaleLowerCase('nl').includes(search))),sessions=await trainingRows(client,actor),records:PlayerStatisticsResponse['practice']['records']=[];
 for(const session of sessions){let record=records.find(r=>r.mode===session.mode&&r.startScore===session.startScore);if(!record){record={mode:session.mode,startScore:session.startScore,sessions:0,bestAverage:null,bestLegDarts:null,highestFinish:null,bestHits:null};records.push(record);}record.sessions++;if(session.average!==null)record.bestAverage=record.bestAverage===null?session.average:Math.max(record.bestAverage,session.average);if(session.bestLegDarts!==null)record.bestLegDarts=record.bestLegDarts===null?session.bestLegDarts:Math.min(record.bestLegDarts,session.bestLegDarts);if(session.highestFinish!==null)record.highestFinish=Math.max(record.highestFinish??0,session.highestFinish);if(session.hits!==null)record.bestHits=Math.max(record.bestHits??0,session.hits);}
 const competitions=await client.query<{id:string;kind:'league'|'tournament';state:{name:string;fixtures?:Fixture[];standings?:{id?:string;playerId?:string}[]}}>(`select e.id,e.kind,e.state from dartflow_private.platform_entities e where e.kind in('league','tournament') and (e.owner_id=$1 or exists(select 1 from dartflow_private.platform_members p where p.entity_id=e.id and p.user_id=$1 and p.attributes->>'registered'='true')) order by e.updated_at desc,e.id`,[actor]);
 const tournaments:TournamentStatistics[]=competitions.rows.map(e=>{const games=played.filter(r=>r.competition?.id===e.id),fixtures=(e.state.fixtures??[]).filter(f=>f.players.includes(actor));return{id:e.id,name:e.state.name,kind:e.kind,classification:competitionStatisticsClassification(e,actor),summary:summarizePlayerStatistics(games,actor,filter),administrative:fixtures.filter(f=>f.status==='bye'||f.status==='confirmed'&&!games.some(g=>g.id===f.matchId)).map(f=>({id:f.id,status:f.status,phase:f.phase,round:f.round,...(f.score?{score:f.score}:{})}))};});
 const teamContributions=all.filter(row=>isMultiPlayerMatch(row.state)&&row.state.resultPublished&&!row.state.administrativeDecision).slice(0,50).map(row=>{const side=matchSideIndex(row.state,actor);return {matchId:row.id,completedAt:row.completedAt,sideName:row.state.sideNames?.[side]??'Team',partners:row.state.sideParticipants?.[side]?.filter(player=>player.id!==actor).map(player=>player.name)??[],discipline:row.state.settings.discipline??'x01' as 'x01'|'cricket',measures:playerContribution(row.state,actor)};}),cricketMatches=all.filter(row=>row.state.settings.discipline==='cricket'&&!isMultiPlayerMatch(row.state)&&row.state.resultPublished&&!row.state.administrativeDecision),cricketMeasures=cricketMatches.map(row=>playerContribution(row.state,actor)),cricketDarts=cricketMeasures.reduce((sum,row)=>sum+row.darts,0),creditedMarks=cricketMeasures.reduce((sum,row)=>sum+row.creditedMarks,0);
 return{teamContributions,cricket:{matches:cricketMatches.length,won:cricketMatches.filter(row=>row.state.winnerId===actor).length,points:cricketMeasures.reduce((sum,row)=>sum+row.points,0),darts:cricketDarts,creditedMarks,marksPerRound:cricketDarts?3*creditedMarks/cricketDarts:null},filter,summary:summarizePlayerStatistics(options.opponent?selected:all,actor,filter),matches:rows.slice(offset,offset+limit),pagination:{offset,limit,total:rows.length,hasMore:offset+limit<rows.length},opponents:opponents.slice(opponentOffset,opponentOffset+limit),opponentPagination:{offset:opponentOffset,limit,total:opponents.length,hasMore:opponentOffset+limit<opponents.length},tournaments,practice:{sessions:sessions.slice(practiceOffset,practiceOffset+limit),pagination:{offset:practiceOffset,limit,total:sessions.length,hasMore:practiceOffset+limit<sessions.length},records}};
}
/** Compatibility adapter for the existing navigation/dashboard statistics contract. */
export async function getPlayerStatisticsSummary(actor:string){
 const client=await database().connect();try{
  await client.query('begin isolation level repeatable read read only');
  const records=await readPlayerStatisticsMatches(client,uuid(actor)),played=uniqueStatisticsMatches(records),s=summarizePlayerStatistics(records,actor),all=combinePlayerMeasures(played.map(r=>calculatePlayerMeasures(matchGames(r.state),actor))),practice=await trainingRows(client,actor);
  await client.query('commit');
  // Existing dashboard outcome counters cover every played x01 type; AVG keeps its comparable 501 cohort.
  return{played:played.length,won:played.filter(r=>r.state.winnerId===actor).length,drawn:played.filter(r=>r.state.winnerId===null).length,average:s.last50.average??0,oneEighties:all.oneEighties,highestFinish:all.highestFinish,totalDarts:all.darts,trainingSessions:practice.length};
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}

type Kickoff={players:{id:string;last50:StatisticsSummary['last50'];bestAverage:number|null}[];headToHead?:{wins:number[];drawn:number;previousLegs:number[]}};
async function kickoff(client:Client,state:MatchState):Promise<Kickoff>{
 const summaries:Kickoff['players']=[];let ownRecords:StatisticsMatch[]=[];
 for(const player of state.players){const records=(await readPlayerStatisticsMatches(client,player.id)).filter(r=>r.id!==state.id);if(player.id===state.players[0].id)ownRecords=records;const summary=summarizePlayerStatistics(records,player.id,{startScore:state.settings.startScore,outRule:'double-out'});const bestAverage=uniqueStatisticsMatches(records).filter(r=>r.state.settings.startScore===state.settings.startScore).reduce<number|null>((best,r)=>{const avg=calculatePlayerMeasures(matchGames(r.state),player.id).average;return avg===null?best:best===null?avg:Math.max(avg,best);},null);summaries.push({id:player.id,last50:summary.last50,bestAverage});}
 const h2h=uniqueStatisticsMatches(ownRecords).filter(r=>state.players.every(p=>r.state.players.some(other=>other.id===p.id)));const previous=h2h[0];return{players:summaries,...(h2h.length&&previous?{headToHead:{wins:state.players.map(p=>h2h.filter(r=>r.state.winnerId===p.id).length),drawn:h2h.filter(r=>r.state.winnerId===null).length,previousLegs:state.players.map(p=>matchGames(previous.state).reduce((sum,g)=>sum+(g.legs[previous.state.players.findIndex(other=>other.id===p.id)]??0),0))}}:{})};
}
/** Called under the match transaction before its first accepted live action. Resumes never overwrite it. */
export async function captureMatchStatistics(client:Client,source:MatchState,next:MatchState):Promise<void>{
 if(isMultiPlayerMatch(source)||source.settings.discipline==='cricket')return;
 if(!['live','result','confirmed'].includes(next.status)||source.status==='abandoned'||source.status==='interrupted'&&next.status!=='live')return;
 const exists=Boolean((await client.query('select 1 from dartflow_private.player_match_kickoffs where match_id=$1',[source.id])).rowCount);
 const extra=await client.query<{board_id:string}>("select unnest(board_ids) board_id from dartflow_private.board_activity_sessions where source_id=$1 and status in('active','completed')",[source.id]);
 const boards=[...new Set([...(source.boardId?[source.boardId]:[]),...extra.rows.map(r=>r.board_id)])];
 if(exists){if(next.status==='live')await client.query('update dartflow_private.player_match_kickoffs set board_ids=$2 where match_id=$1 and board_ids is distinct from $2::uuid[]',[source.id,boards]);return;}
 const frozen=await kickoff(client,source);
 await client.query('insert into dartflow_private.player_match_kickoffs(match_id,board_ids,snapshot) values($1,$2,$3) on conflict(match_id) do nothing',[source.id,boards,JSON.stringify(frozen)]);
}
/** Privacy is applied here, never by hiding fields in the display component. */
export async function getOcheStatistics(client:Client,input:{boardId:string;state?:MatchState|null;lobbyId?:string|null;allowRecap?:boolean}):Promise<OcheHistoricalStatistics|undefined>{
 let state=input.state??null,completedAt:string|null=null,frozen:Kickoff|null=null;
 if(!state&&input.allowRecap){
  const recent=await client.query<{state:MatchState;created_at:string|Date;snapshot:Kickoff}>(`select m.state,r.created_at,k.snapshot from dartflow_private.player_match_kickoffs k join dartflow_private.matches m on m.id=k.match_id join dartflow_private.match_results r on r.match_id=m.id where k.board_ids @> array[$1]::uuid[] and r.created_at>clock_timestamp()-interval '15 seconds' and m.state->>'status'='confirmed' order by r.created_at desc,m.id desc limit 1`,[input.boardId]);
  if(recent.rows[0]){state=recent.rows[0].state;completedAt=stamp(recent.rows[0].created_at);frozen=recent.rows[0].snapshot;}
 }
 if(!state&&input.lobbyId){
  const lobby=await client.query<{state:{settings?:MatchState['settings'];matchId?:string;closed?:boolean};owner_id:string}>("select state,owner_id from dartflow_private.platform_entities where id=$1 and kind='lobby'",[input.lobbyId]);
  if(!lobby.rows[0]||lobby.rows[0].state.matchId||lobby.rows[0].state.closed)return;
  const members=await client.query<{user_id:string}>("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active' order by case when user_id=$2 then 0 else 1 end,created_at,user_id limit 3",[input.lobbyId,lobby.rows[0].owner_id]);
  if(members.rows.length!==2)return;
  const people=await profiles(client,members.rows.map(p=>p.user_id));
  if(people.length!==2||!people.every(p=>p.showPublicStatistics===true&&p.displayNameConfirmed===true))return;
  const pseudo={id:input.lobbyId,players:members.rows.map(p=>people.find(person=>person.id===p.user_id)!),settings:lobby.rows[0].state.settings??{startScore:501,bestOfLegs:3,bestOfSets:1}}as MatchState;
  const summary=await kickoff(client,pseudo);
  if(!summary.headToHead)return;
  return{players:[],headToHead:{...summary.headToHead,names:pseudo.players.map(p=>p.name)}};
 }
 if(!state||state.settings.discipline==='cricket'||isMultiPlayerMatch(state)||['abandoned','interrupted'].includes(state.status))return;
 const people=await profiles(client,state.players.map(p=>p.id));
 const visible=(id:string)=>people.some(p=>p.id===id&&p.showPublicStatistics===true&&p.displayNameConfirmed===true);
 const allowed=state.players.every(p=>visible(p.id));
 if(!frozen){const result=await client.query<{snapshot:Kickoff}>('select snapshot from dartflow_private.player_match_kickoffs where match_id=$1',[state.id]);frozen=result.rows[0]?.snapshot??null;}
 if(!frozen&&['planned','called','ready'].includes(state.status)&&allowed)frozen=await kickoff(client,state);
 if(state.status==='confirmed'&&!completedAt){const result=await client.query<{created_at:string|Date}>('select created_at from dartflow_private.match_results where match_id=$1',[state.id]);completedAt=result.rows[0]?stamp(result.rows[0].created_at):null;}
 const players=state.players.map((player,playerIndex)=>{const live=calculatePlayerMeasures(matchGames(state!),player.id),prior=frozen?.players.find(p=>p.id===player.id),last50=visible(player.id)&&prior?.last50.average!==null&&prior?.last50.average!==undefined?{average:prior.last50.average,measured:prior.last50.measured,window:prior.last50.window}:null;return{playerIndex,last50,live:{average:live.average,oneEighties:live.oneEighties,highestFinish:live.highestFinish},...(state!.status==='confirmed'?{recap:{averageDifference:last50&&live.average!==null?live.average-last50.average:null,personalRecord:visible(player.id)&&live.average!==null&&prior?.bestAverage!==null&&prior?.bestAverage!==undefined&&live.average>prior.bestAverage}}:{})};});
 const expiresAt=completedAt?new Date(new Date(completedAt).getTime()+15_000).toISOString():null;
 const recap=state.status==='confirmed'&&!state.administrativeDecision&&expiresAt&&new Date(expiresAt).getTime()>Date.now()?{expiresAt,players:state.players.map((player,i)=>({name:people.find(p=>p.id===player.id)?.name??player.name,legs:matchGames(state!).reduce((sum,g)=>sum+(g.legs[i]??0),0),sets:matchGames(state!).filter(g=>g.status==='finished'&&g.winner===player.id).length,average:players[i].live.average,highestFinish:players[i].live.highestFinish,averageDifference:players[i].recap?.averageDifference??null,personalRecord:players[i].recap?.personalRecord??false}))}:undefined;
 return{players,...(allowed&&frozen?.headToHead?{headToHead:{...frozen.headToHead,names:state.players.map(p=>people.find(person=>person.id===p.id)?.name??p.name)}}:{}),...(recap?{recap}:{})};
}
