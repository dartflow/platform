import {getPublicPlaySessionForOwner} from './play-sessions';
import {resolveOcheDeviceTheme} from './oche-device-branding';
import {publicTactics} from './tactics';
import{publicBullStart}from'./bull-start';
import {matchEventNotice} from './event-display-notice';
import {readSeasonDisplay} from './season-display';
import {publicMatchSides,publicMatchVisit,publicMatchSettings} from './match-sides';
import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {getMatch} from './db';
import {checkout} from './domain';
import {projectBoardScreenForDevice} from './board-screens';
import {readSourceBoardActivity} from './board-activity';
import {readBoardScoreEvents} from './score-events';
import {authorizeOcheAccess,ocheTransaction,type OcheDeviceRow} from './oche-device-store';
import type {OcheDisplayPanel,OcheDisplaySnapshot,OcheEvents} from './oche-device-types';
import type {ClubBoardScreenView} from './platform-types';
import type {Game,PublicSnapshot,Visit} from './types';
import {readOcheHomeEvents} from './oche-device-events';

const opaque=(value:string)=>createHash('sha256').update(`oche:v1:${value}`).digest('hex').slice(0,32);
const visits=(items:Visit[])=>items.map(item=>({player:`player-${item.playerIndex+1}`,playerIndex:item.playerIndex,score:item.score,darts:item.darts,remainingBefore:item.remainingBefore,remainingAfter:item.remainingAfter,bust:item.bust,leg:item.leg,checkout:item.checkout}));
async function homeProjection(client:PoolClient,device:OcheDeviceRow):Promise<ClubBoardScreenView|null>{
 const selection=(await client.query<{source_id:string|null}>('select source_id from dartflow_private.oche_home_selections where owner_id=$1',[device.owner_id])).rows[0]?.source_id;
 if(!selection)return null;
 const selectedPlay=await getPublicPlaySessionForOwner(selection,device.owner_id!,client);
 if(selectedPlay)return {board:{id:`home-${device.id}`,name:'Thuis',clubName:'Mijn spel',access:'club',blocked:false,occupied:selectedPlay.status==='active',publicScan:false,playUrl:'/app/spelen',screenUrl:'/oche-live'},status:'playing',snapshot:{board:{id:`home-${device.id}`,name:'Thuis'},event:{name:'Mijn spel'},match:null,play:selectedPlay,sessionKey:selectedPlay.sessionKey,scoreEvents:[]},screen:{rotation:0,paired:false}};
 let match:PublicSnapshot['match']=null,boardId:string|null=null,sourceId=selection,title='Mijn scherm thuis';
 const source=(await client.query<{id:string;state:Record<string,unknown>;kind:'training'|'lobby';revision:number}>(`select id,state,kind,revision from dartflow_private.platform_entities where id=$1 and owner_id=$2 and kind in('training','lobby') and coalesce(state->>'closed','false')<>'true' and coalesce(state->>'discarded','false')<>'true'`,[selection,device.owner_id])).rows[0];
 if(source?.kind==='lobby'){
  title=String(source.state.name??title);boardId=typeof source.state.boardId==='string'?source.state.boardId:null;
  if(typeof source.state.matchId==='string')sourceId=source.state.matchId;
 }
 const ownMatch=(await client.query<{id:string}>(`select m.id from dartflow_private.matches m where (exists(select 1 from dartflow_private.match_players p where p.match_id=m.id and p.user_id=$2) or m.state->'remoteWriterIds' ? $2::text or jsonb_path_exists(m.state,'$.sideParticipants[*][*] ? (@.id == $actor)',jsonb_build_object('actor',$2::text))) and m.id=$1 and m.state->>'status' not in('abandoned','interrupted')`,[sourceId,device.owner_id])).rows[0];
 if(ownMatch){
  const view=await getMatch(device.owner_id!,ownMatch.id,client);boardId=view.boardId;
  match={id:`home-${device.id}`,revision:view.revision,status:view.status,...(view.cricket?{cricket:view.cricket}:{}),...(view.tactics?{tactics:publicTactics(view.tactics)}:{}),...publicMatchSides(view),...publicBullStart(view),players:view.players.map((player,index)=>({id:`player-${index+1}`,name:player.name})),remaining:view.remaining,legs:view.legs,sets:view.sets,turn:view.turn,checkout:view.checkout,visits:(view.currentLegVisits??[]).map(visit=>publicMatchVisit(view,visit)),currentLegVisits:(view.currentLegVisits??[]).map(visit=>publicMatchVisit(view,visit)),currentLegStartScore:view.currentLegStartScore,scoringMode:view.scoringMode,winnerId:view.winnerId?`player-${view.players.findIndex(player=>player.id===view.winnerId)+1}`:null,resultPublished:view.resultPublished,settings:publicMatchSettings(view.settings),writerId:'',stats:view.stats.map(stat=>({total:stat.total,darts:stat.darts,average:stat.average,oneEighties:stat.oneEighties,highestFinish:stat.highestFinish,measurementComplete:stat.measurementComplete})),legNumber:view.legNumber,setNumber:view.setNumber,paused:Boolean(view.paused)};
 }else if(source?.kind==='training'&&source.state.game){
  const game=source.state.game as Game;boardId=typeof source.state.boardId==='string'?source.state.boardId:null;
  const name=(await client.query<{name:string}>('select name from dartflow_private.profile_labels where id=$1',[device.owner_id])).rows[0]?.name??'Speler';
  const legNumber=Math.max(1,game.legs[0]+(game.status==='finished'?0:1)),current=visits(game.visits.filter(visit=>visit.leg===legNumber));
  match={id:`home-${device.id}`,revision:source.revision,status:game.status==='finished'?'result':'live',...(game.cricket?{cricket:game.cricket}:{}),...(game.tactics?{tactics:publicTactics(game.tactics)}:{}),players:[{id:'player-1',name}],remaining:[game.remaining[0]],legs:[game.legs[0]],sets:[0],turn:0,checkout:game.status==='live'&&!['cricket','tactics'].includes(game.discipline??'')?checkout(game.remaining[0]):null,visits:current,currentLegVisits:current,currentLegStartScore:game.startScore,winnerId:game.status==='finished'?'player-1':null,resultPublished:false,settings:publicMatchSettings({startScore:game.startScore as 301|501|701,bestOfLegs:1,bestOfSets:1,...(game.discipline?{discipline:game.discipline}:{}),...(game.cricketMode?{cricketMode:game.cricketMode}:{}),...(game.tactics?{tacticsPreset:game.tactics.preset,tacticsMode:game.tactics.mode}:{}),...(game.inRule?{inRule:game.inRule}:{}),...(game.outRule?{outRule:game.outRule}:{}),...(game.sideStartScores?{sideStartScores:game.sideStartScores}:{})}),writerId:'',stats:[{total:game.stats[0].total,darts:game.stats[0].darts,average:game.stats[0].darts?3*game.stats[0].total/game.stats[0].darts:0,oneEighties:game.stats[0].oneEighties,highestFinish:game.stats[0].highestFinish}],legNumber,setNumber:1,paused:false};
 }else if(!source)return null;
 const activity=await readSourceBoardActivity(client,sourceId);if(activity)activity.canExtend=false;
 const scoreEvents=boardId?await readBoardScoreEvents(client,boardId,sourceId,match?.revision):{sessionKey:opaque(sourceId),scoreEvents:match?await readOcheHomeEvents(client,sourceId,device.owner_id!,ownMatch?'match':'training',match.revision):[]};
 return {board:{id:`home-${device.id}`,name:'Thuis',clubName:title,access:'club',blocked:false,occupied:true,publicScan:false,playUrl:'/app/spelen',screenUrl:'/oche-live'},status:match?'playing':'waiting',snapshot:{board:{id:`home-${device.id}`,name:'Thuis'},event:{name:[title,await matchEventNotice(client,ownMatch?.id)].filter(Boolean).join(' · ')},match,...await readSeasonDisplay(client,ownMatch?.id),...scoreEvents,...(activity?{boardActivity:activity}:{})},screen:{rotation:0,paired:false}};
}
/** Keep legacy primary projection unchanged unless the client opts in to panels. */
export async function getOcheDeviceSnapshot(token:string,includePanels=false):Promise<OcheDisplaySnapshot>{
 return ocheTransaction(async client=>{
  const device=await authorizeOcheAccess(token,client);
  const serverNow=Number((await client.query<{now:string}>('select extract(epoch from clock_timestamp())*1000 as now')).rows[0].now);
  const location=device.location_id?(await client.query<{id:string;name:string}>('select id,name from dartflow_private.locations where id=$1',[device.location_id])).rows[0]??null:null;
  const theme=await resolveOcheDeviceTheme(client,device);
  const timeout=includePanels?(await client.query<{value:string;milliseconds:string}>("select current_setting('statement_timeout') as value,setting as milliseconds from pg_settings where name='statement_timeout'")).rows[0]:null;
  const project=async(boardId:string|null,sourceClient:PoolClient=client):Promise<OcheDisplaySnapshot>=>{
   const display=device.scope==='home'?await homeProjection(sourceClient,device):boardId?await projectBoardScreenForDevice(sourceClient,boardId):null;
   if(display)display.snapshot.theme=theme;
   const activity=display?.snapshot.boardActivity;let state:OcheDisplaySnapshot['state']=display?display.status==='available'?'standby':display.status==='playing'?'live':display.status:'unassigned';
   if(activity?.phase==='warning')state='warning';
   if(display?.snapshot.match&&['result','confirmed','disputed'].includes(display.snapshot.match.status)||display?.snapshot.play?.status==='completed')state='result';
   const revision=display?.snapshot.play?.revision??display?.snapshot.match?.revision??0;
   const stableTheme=theme.id==='club'?{...theme,validUntil:0}:theme;
   const stableDisplay=display?{...display,snapshot:{...display.snapshot,theme:stableTheme,...(display.snapshot.play?{play:{...display.snapshot.play,serverNow:0}}:{}),...(activity?{boardActivity:{...activity,serverNow:0}}:{})}}:null;
   const group=opaque(JSON.stringify({device:device.id,grant:device.grant_version,scope:device.scope,location:device.location_id,board:boardId,session:display?.snapshot.sessionKey??'unassigned'}));
   const eventId=`v1:${group}:${revision}:${opaque(JSON.stringify({name:device.name,location,display:stableDisplay,theme:stableTheme,state}))}`;
   return {apiVersion:1,serverNow,state,scope:device.scope,device:{id:device.id,name:device.name,platform:device.platform,grantVersion:device.grant_version},location,board:boardId&&display?{id:boardId,name:display.board.name}:null,display,theme,eventId,revision,pollAfterMs:2000,permissions:{read:true,score:false,extend:false}};
  };
  const pane=async(position:'left'|'right',boardId:string|null):Promise<OcheDisplayPanel>=>{
   const sourceId=boardId??(device.scope==='home'?`home:${device.id}`:null);
   if(device.scope==='location'&&!boardId)return {position,sourceId,status:'unassigned',snapshot:null};
   const available=async(sourceClient:PoolClient)=>!boardId||Boolean((await sourceClient.query('select 1 from dartflow_private.location_boards where board_id=$1 and location_id=$2 and archived_at is null',[boardId,device.location_id])).rowCount);
   if(!includePanels)return await available(client)?{position,sourceId,status:'ready',snapshot:await project(boardId)}:{position,sourceId,status:'unavailable',snapshot:null};
   // The entire source gets one second, including all of its SQL statements.
   // Recompute each query's remaining budget rather than restarting the timer.
   // Two stalled sources therefore fit the existing 2500 ms client deadline.
   const configured=Number(timeout?.milliseconds??0),deadline=performance.now()+Math.min(1000,configured>0?configured:1000);
   const boundedClient=new Proxy(client,{get(target,key){
    if(key==='query')return async(...args:unknown[])=>{
     const remaining=Math.floor(deadline-performance.now());if(remaining<=0)throw new Error('Oche source deadline exceeded');
     await target.query("select set_config('statement_timeout',$1,true)",[`${remaining}ms`]);
     const result=await Reflect.apply(target.query,target,args);if(performance.now()>deadline)throw new Error('Oche source deadline exceeded');return result;
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});
   await client.query('savepoint oche_panel');
   try{
    const result:OcheDisplayPanel=await available(boundedClient)?{position,sourceId,status:'ready',snapshot:await project(boardId,boundedClient)}:{position,sourceId,status:'unavailable',snapshot:null};
    await client.query("select set_config('statement_timeout',$1,true)",[timeout!.value]);await client.query('release savepoint oche_panel');return result;
   }catch{
    // Rollback also restores the previous SET LOCAL statement_timeout value.
    await client.query('rollback to savepoint oche_panel');await client.query('release savepoint oche_panel');
    return {position,sourceId,status:'error',snapshot:null};
   }
  };
  const left=await pane('left',device.board_id);
  const primary=left.snapshot??{apiVersion:1 as const,serverNow,state:'unassigned' as const,scope:device.scope,device:{id:device.id,name:device.name,platform:device.platform,grantVersion:device.grant_version},location,board:null,display:null,theme,eventId:`v1:${opaque(`${device.id}:${device.grant_version}:${device.board_id}:${left.status}`)}:0:${opaque(left.status)}`,revision:0,pollAfterMs:2000,permissions:{read:true as const,score:false as const,extend:false as const}};
  if(!includePanels)return primary;
  const panels=[left];if(device.layout?.scoreboards===2)panels.push(await pane('right',device.secondary_board_id));
  const eventId=`${primary.eventId.slice(0,primary.eventId.lastIndexOf(':'))}:${opaque(JSON.stringify({configuration:device.configuration_revision,layout:device.layout,panels:panels.map(panel=>({position:panel.position,source:panel.sourceId,status:panel.status,event:panel.snapshot?.eventId}))}))}`;
  return {...primary,eventId,layout:device.layout??null,configurationRevision:device.configuration_revision??0,panels};
 });
}
export async function pollOcheDeviceEvents(token:string,after?:string,includePanels=false):Promise<OcheEvents>{
 const snapshot=await getOcheDeviceSnapshot(token,includePanels);
 const cursor=/^v1:([a-f0-9]{32}):(\d+):[a-f0-9]{32}$/;
 const previous=after?cursor.exec(after):null,current=cursor.exec(snapshot.eventId)!;
 const events=snapshot.display?.snapshot.scoreEvents??[];
 const oldestRevision=events.length?Math.min(...events.map(event=>event.revision)):0;
 // A changed state/score is an ordinary update, not an event gap. The current
 // full snapshot always accompanies it. Reset only a foreign/unknown cursor or
 // one older than the retained accepted-event window; clients baseline that
 // recovery and can animate fresh events on subsequent ordinary updates.
 const reset=Boolean(after&&(!previous||previous[1]!==current[1]||Number(previous[2])>snapshot.revision||events.length>=64&&Number(previous[2])<oldestRevision-1));
 return {apiVersion:1,eventId:snapshot.eventId,reset,snapshot};
}
