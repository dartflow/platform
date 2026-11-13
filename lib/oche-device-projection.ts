import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {getMatch} from './db';
import {checkout} from './domain';
import {projectBoardScreenForDevice} from './board-screens';
import {readSourceBoardActivity} from './board-activity';
import {readBoardScoreEvents} from './score-events';
import {authorizeOcheAccess,ocheTransaction,type OcheDeviceRow} from './oche-device-store';
import type {OcheDisplaySnapshot,OcheEvents} from './oche-device-types';
import type {ClubBoardScreenView} from './platform-types';
import type {Game,PublicSnapshot,Visit} from './types';
import {readOcheHomeEvents} from './oche-device-events';

const opaque=(value:string)=>createHash('sha256').update(`oche:v1:${value}`).digest('hex').slice(0,32);
const visits=(items:Visit[])=>items.map(item=>({player:`player-${item.playerIndex+1}`,playerIndex:item.playerIndex,score:item.score,darts:item.darts,remainingBefore:item.remainingBefore,remainingAfter:item.remainingAfter,bust:item.bust,leg:item.leg,checkout:item.checkout}));
async function homeProjection(client:PoolClient,device:OcheDeviceRow):Promise<ClubBoardScreenView|null>{
 const selection=(await client.query<{source_id:string|null}>('select source_id from dartflow_private.oche_home_selections where owner_id=$1',[device.owner_id])).rows[0]?.source_id;
 if(!selection)return null;
 let match:PublicSnapshot['match']=null,boardId:string|null=null,sourceId=selection,title='Mijn scherm thuis';
 const source=(await client.query<{id:string;state:Record<string,unknown>;kind:'training'|'lobby';revision:number}>(`select id,state,kind,revision from dartflow_private.platform_entities where id=$1 and owner_id=$2 and kind in('training','lobby') and coalesce(state->>'closed','false')<>'true' and coalesce(state->>'discarded','false')<>'true'`,[selection,device.owner_id])).rows[0];
 if(source?.kind==='lobby'){
  title=String(source.state.name??title);boardId=typeof source.state.boardId==='string'?source.state.boardId:null;
  if(typeof source.state.matchId==='string')sourceId=source.state.matchId;
 }
 const ownMatch=(await client.query<{id:string}>(`select m.id from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id and p.user_id=$2 where m.id=$1 and m.state->>'status' not in('abandoned','interrupted')`,[sourceId,device.owner_id])).rows[0];
 if(ownMatch){
  const view=await getMatch(device.owner_id!,ownMatch.id);boardId=view.boardId;
  match={id:`home-${device.id}`,revision:view.revision,status:view.status,players:view.players.map((player,index)=>({id:`player-${index+1}`,name:player.name})),remaining:view.remaining,legs:view.legs,sets:view.sets,turn:view.turn,checkout:view.checkout,visits:visits(view.currentLegVisits??[]),currentLegVisits:visits(view.currentLegVisits??[]),currentLegStartScore:view.currentLegStartScore,scoringMode:view.scoringMode,winnerId:view.winnerId?`player-${view.players.findIndex(player=>player.id===view.winnerId)+1}`:null,resultPublished:view.resultPublished,settings:{startScore:view.settings.startScore,bestOfLegs:view.settings.bestOfLegs,bestOfSets:view.settings.bestOfSets,...(view.settings.legLimit===undefined?{}:{legLimit:view.settings.legLimit})},writerId:'',stats:view.stats.map(stat=>({total:stat.total,darts:stat.darts,average:stat.average,oneEighties:stat.oneEighties,highestFinish:stat.highestFinish,measurementComplete:stat.measurementComplete})),legNumber:view.legNumber,setNumber:view.setNumber,paused:Boolean(view.paused)};
 }else if(source?.kind==='training'&&source.state.game){
  const game=source.state.game as Game;boardId=typeof source.state.boardId==='string'?source.state.boardId:null;
  const name=(await client.query<{name:string}>('select name from dartflow_private.profile_labels where id=$1',[device.owner_id])).rows[0]?.name??'Speler';
  const legNumber=Math.max(1,game.legs[0]+(game.status==='finished'?0:1)),current=visits(game.visits.filter(visit=>visit.leg===legNumber));
  match={id:`home-${device.id}`,revision:source.revision,status:game.status==='finished'?'result':'live',players:[{id:'player-1',name}],remaining:[game.remaining[0]],legs:[game.legs[0]],sets:[0],turn:0,checkout:game.status==='live'?checkout(game.remaining[0]):null,visits:current,currentLegVisits:current,currentLegStartScore:game.startScore,winnerId:game.status==='finished'?'player-1':null,resultPublished:false,settings:{startScore:game.startScore as 301|501|701,bestOfLegs:1,bestOfSets:1},writerId:'',stats:[{total:game.stats[0].total,darts:game.stats[0].darts,average:game.stats[0].darts?3*game.stats[0].total/game.stats[0].darts:0,oneEighties:game.stats[0].oneEighties,highestFinish:game.stats[0].highestFinish}],legNumber,setNumber:1,paused:false};
 }else if(!source)return null;
 const activity=await readSourceBoardActivity(client,sourceId);if(activity)activity.canExtend=false;
 const scoreEvents=boardId?await readBoardScoreEvents(client,boardId,sourceId,match?.revision):{sessionKey:opaque(sourceId),scoreEvents:match?await readOcheHomeEvents(client,sourceId,device.owner_id!,ownMatch?'match':'training',match.revision):[]};
 return {board:{id:`home-${device.id}`,name:'Thuis',clubName:title,access:'club',blocked:false,occupied:true,publicScan:false,playUrl:'/app/spelen',screenUrl:'/oche-live'},status:match?'playing':'waiting',snapshot:{board:{id:`home-${device.id}`,name:'Thuis'},event:{name:title},match,...scoreEvents,...(activity?{boardActivity:activity}:{})},screen:{rotation:0,paired:false}};
}
export async function getOcheDeviceSnapshot(token:string):Promise<OcheDisplaySnapshot>{
 return ocheTransaction(async client=>{
  const device=await authorizeOcheAccess(token,client);
  const serverNow=Number((await client.query<{now:string}>('select extract(epoch from clock_timestamp())*1000 as now')).rows[0].now);
  const location=device.location_id?(await client.query<{id:string;name:string}>('select id,name from dartflow_private.locations where id=$1',[device.location_id])).rows[0]??null:null;
  const display=device.scope==='home'?await homeProjection(client,device):device.board_id?await projectBoardScreenForDevice(client,device.board_id):null;
  const activity=display?.snapshot.boardActivity;let state:OcheDisplaySnapshot['state']=display?display.status==='available'?'standby':display.status==='playing'?'live':display.status:'unassigned';
  if(activity?.phase==='warning')state='warning';
  if(display?.snapshot.match&&['result','confirmed','disputed'].includes(display.snapshot.match.status))state='result';
  const revision=display?.snapshot.match?.revision??0;
  // State, assignment and deadline mutations matter even when the score revision is unchanged.
  const stableDisplay=display?{...display,snapshot:{...display.snapshot,...(activity?{boardActivity:{...activity,serverNow:0}}:{})}}:null;
  const group=opaque(JSON.stringify({device:device.id,grant:device.grant_version,scope:device.scope,location:device.location_id,board:device.board_id,session:display?.snapshot.sessionKey??'unassigned'}));
  const eventId=`v1:${group}:${revision}:${opaque(JSON.stringify({name:device.name,location,display:stableDisplay,state}))}`;
  return {apiVersion:1,serverNow,state,scope:device.scope,device:{id:device.id,name:device.name,platform:device.platform,grantVersion:device.grant_version},location,board:device.board_id&&display?{id:device.board_id,name:display.board.name}:null,display,eventId,revision,pollAfterMs:2000,permissions:{read:true,score:false,extend:false}};
 });
}
export async function pollOcheDeviceEvents(token:string,after?:string):Promise<OcheEvents>{
 const snapshot=await getOcheDeviceSnapshot(token);
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
