import {database,getBoardForActor,getOverview} from './db';
import {DomainError} from './domain';
import {getPlatformOverview} from './platform';
import {getLocationOverview} from './locations';
import {getSeasonPlayerFixtures} from './seasons';
import {uuid} from './platform-store';
import {boardGamePreference,defaultBoardGame} from './player-experience-store';
import {listBoardScreenDevices} from './board-screens';
import type {PlayerExperience,ExperienceBoard,BoardGamePreference} from './player-experience-types';
import type {Game} from './types';
import type {SeasonPlayerFixture} from './seasons-types';

export function focusedTrainingValue(focus:string,game?:Game):number|null{
 if(!game)return null;
 const visits=game.visits.filter(v=>v.playerIndex===0);
 if(focus==='first9'){
  const first=visits.slice(0,3);if(first.length!==3||first.some(v=>v.darts!==3))return null;
  return first.reduce((n,v)=>n+(v.bust?0:v.score),0)/3;
 }
 if(focus==='checkout'&&game.stats[0]?.darts)return game.stats[0].highestFinish;
 return null;
}
function instant(value:unknown):string|null{const t=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(t)?new Date(t).toISOString():null;}
/** Monday midnight in the same Amsterdam timezone shown throughout the planning UI. */
export function experienceWeekStart(now=new Date()):number{
 const parts=(date:Date)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const p=parts(now),day=Date.UTC(p.year,p.month-1,p.day),monday=day-(new Date(day).getUTCDay()+6)%7*86400_000,local=parts(new Date(monday));
 return monday-(Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute,local.second)-monday);
}
export async function getPlayerExperience(actorId:string):Promise<PlayerExperience>{
 const actor=uuid(actorId),client=database();
 const [platform,locations,overview,seasons,prefs]=await Promise.all([getPlatformOverview(actor),getLocationOverview(actor),getOverview(actor),getSeasonPlayerFixtures(actor),client.query<{favorites:string[];last_games:Record<string,BoardGamePreference>;weekly_goal:number}>('select favorites,last_games,weekly_goal from dartflow_private.player_experience where user_id=$1',[actor])]);
 const saved=prefs.rows[0],favorites=saved?.favorites??[],lastGames=saved?.last_games??{},candidates=new Set([...favorites,...platform.clubBoards.map(b=>b.id),...overview.boards.map(b=>b.id),...locations.locations.flatMap(l=>l.boards.filter(b=>!b.archived).map(b=>b.id)),...locations.bookableLocations.flatMap(l=>l.boards.map(b=>b.id))]);
 const boards:ExperienceBoard[]=[];
 for(const id of [...candidates].slice(0,150)){
  try{
   const allowed=await getBoardForActor(actor,id),managed=locations.locations.find(l=>l.boards.some(b=>b.id===id)),club=platform.clubBoards.find(b=>b.id===id);
   let devices:ExperienceBoard['devices']=[];let canManage=false;
   try{const access=await listBoardScreenDevices(actor,id);canManage=true;devices=access.devices.map(d=>({...d,lastSeenAt:d.lastSeenAt??null,online:Boolean(d.lastSeenAt&&Date.now()-Date.parse(d.lastSeenAt)<40_000&&!d.revoked&&Date.parse(d.expiresAt)>Date.now())}));}catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}
   const rotation=(await client.query<{rotation:0|90|270}>('select rotation from dartflow_private.board_screen_preferences where board_id=$1',[id])).rows[0]?.rotation??90;
   boards.push({id,name:allowed.board.name,locationName:managed?.name??allowed.location?.name??(club?platform.clubs.find(c=>c.id===club.clubId)?.name:null)??allowed.event.name,favorite:favorites.includes(id),canManage,canStart:allowed.canStart,occupied:allowed.board.occupied,playUrl:`/baan/${id}`,screenUrl:`/oche-live/${id}/`,game:lastGames[id]??defaultBoardGame,devices,rotation,activeMatchId:allowed.matchId??managed?.boards.find(b=>b.id===id)?.activeGame?.id??null});
  }catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}
 }
 const legacy:SeasonPlayerFixture[]=[];
 for(const competition of [...platform.leagues,...platform.tournaments].filter(c=>!c.state.seasonManaged)){
  const self=competition.members.find(m=>m.id===actor),presence=self?.attributes??{};
  for(const f of competition.state.fixtures??[]){if(!f.players.includes(actor)||['confirmed','bye'].includes(f.status))continue;
   const match=platform.matches.find(m=>m.id===f.matchId),scheduled=instant(f.time??f.proposedTime);
   legacy.push({seasonId:competition.id,revision:-1,seasonName:competition.name,fixtureId:f.id,scope:'internal',status:f.status==='proposed'?'proposed':f.status==='live'?'live':'scheduled',round:f.round,startsAt:scheduled,windowStart:scheduled??new Date().toISOString(),windowEnd:scheduled?new Date(Date.parse(scheduled)+45*60_000).toISOString():new Date(Date.now()+86400_000).toISOString(),opponent:competition.members.find(m=>m.id===f.players.find(id=>id!==actor))?.name??'Tegenstander volgt',boardIds:match?.boardId?[match.boardId]:[],matchId:match?.id??null,writerId:match?.writerId??null,checkedIn:presence.checkedIn===true,available:presence.available!==false,canCheckIn:presence.registered===true&&presence.checkedIn!==true,canConfirm:match?.status==='result',href:match?`/wedstrijd/${match.id}`:`/app/${competition.kind==='league'?'competitions':'tournaments'}/${competition.id}`});
  }
 }
 const fixtures=[...seasons,...legacy].sort((a,b)=>Number(b.status==='live'||b.status==='provisional')-Number(a.status==='live'||a.status==='provisional')||Date.parse(a.startsAt??a.windowStart)-Date.parse(b.startsAt??b.windowStart)).slice(0,100);
 const writerLabels=(await client.query<{id:string;name:string}>('select id,name from dartflow_private.profile_labels where id=any($1::uuid[])',[platform.matches.map(m=>m.writerId).filter(Boolean)])).rows;
 const resume=platform.matches.filter(m=>['called','ready','live','result','disputed','interrupted'].includes(m.status)).map(m=>({id:m.id,players:m.players.map(p=>p.name),remaining:m.remaining,writer:writerLabels.find(p=>p.id===m.writerId)?.name??'Aangewezen schrijver',lastVisit:m.visits?.at(-1)?`${m.players[m.visits.at(-1)!.playerIndex]?.name??'Speler'} · ${m.visits.at(-1)!.bust?'Bust':m.visits.at(-1)!.score+' punten'}`:null,revision:m.revision,href:`/wedstrijd/${m.id}`,actionLabel:m.status==='result'?(m.permissions.canConfirm?'Bevestig de uitslag':'Bekijk uitslag'):m.status==='disputed'?'Bekijk beoordeling':m.status==='called'?'Bevestig deelname':m.status==='ready'?'Start je partij':m.status==='interrupted'?'Bekijk hervatting':'Hervat je partij'}));
 const actions=[...resume.map(m=>({id:m.id,label:m.actionLabel,href:m.href,detail:m.players.join(' – ')})),...fixtures.filter(f=>f.available&&(f.canCheckIn||['live','provisional','disputed','interrupted'].includes(f.status))).map(f=>({id:f.fixtureId,label:f.canConfirm?'Bevestig de uitslag':f.canCheckIn&&!f.checkedIn?'Check in voor je wedstrijd':'Open je wedstrijd',href:f.href,detail:`${f.seasonName} · ${f.opponent}`}))].filter((v,i,a)=>a.findIndex(x=>x.href===v.href)===i).slice(0,2);
 const trainings=await client.query<{id:string;state:{focus?:string;completed?:boolean;discarded?:boolean;game?:Game};updated_at:Date}>("select id,state,updated_at from dartflow_private.platform_entities where kind='training' and owner_id=$1 and state->>'completed'='true' and coalesce(state->>'discarded','false')<>'true' and state->>'focus' in('first9','checkout') order by updated_at desc,id desc limit 100",[actor]);
 const sessions=trainings.rows.flatMap(row=>{const value=focusedTrainingValue(row.state.focus!,row.state.game);return value===null?[]:[{id:row.id,focus:row.state.focus as 'first9'|'checkout',completedAt:row.updated_at.toISOString(),value,href:`/app/training/${row.id}`}];});
 const weekStart=experienceWeekStart();
 return{serverNow:Date.now(),weeklyGoal:saved?.weekly_goal??3,fixtures,actions,boards:boards.sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.locationName.localeCompare(b.locationName)||a.name.localeCompare(b.name)),resume,training:{thisWeek:sessions.filter(s=>Date.parse(s.completedAt)>=weekStart).length,sessions}};
}
/** Explicit desired values make preference retries naturally idempotent. No browser state is authoritative. */
export async function updatePlayerExperience(actorId:string,input:Record<string,unknown>):Promise<{ok:true}>{
 const actor=uuid(actorId),client=database();
 if(input.type==='weekly-goal'){
  if(!Number.isSafeInteger(input.weeklyGoal)||Number(input.weeklyGoal)<1||Number(input.weeklyGoal)>14)throw new DomainError('invalid_goal','Kies één tot veertien trainingen per week.');
  await client.query('insert into dartflow_private.player_experience(user_id,weekly_goal) values($1,$2) on conflict(user_id) do update set weekly_goal=$2,updated_at=now()',[actor,input.weeklyGoal]);return{ok:true};
 }
 const boardId=uuid(input.boardId);await getBoardForActor(actor,boardId);
 if(input.type==='favorite'){
  if(typeof input.favorite!=='boolean')throw new DomainError('invalid_favorite','Kies bewaren of verwijderen.');
  await client.query(`insert into dartflow_private.player_experience(user_id,favorites) values($1,case when $3 then array[$2::uuid] else '{}'::uuid[] end)
   on conflict(user_id) do update set favorites=case when $3 then array(select distinct unnest(dartflow_private.player_experience.favorites||array[$2::uuid])) else array_remove(dartflow_private.player_experience.favorites,$2::uuid) end,updated_at=now()`,[actor,boardId,input.favorite]);
 }else if(input.type==='board-game'){
  const game=boardGamePreference(input);
  await client.query(`insert into dartflow_private.player_experience(user_id,last_games) values($1,jsonb_build_object($2::text,$3::jsonb)) on conflict(user_id) do update set last_games=jsonb_set(dartflow_private.player_experience.last_games,array[$2::text],$3::jsonb),updated_at=now()`,[actor,boardId,JSON.stringify(game)]);
 }else throw new DomainError('invalid_action','Onbekende spelersvoorkeur.');
 return{ok:true};
}
