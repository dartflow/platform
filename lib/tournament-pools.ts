import {createHash} from 'node:crypto';
import type {Fixture,PoolCriterion,PoolRow} from './platform-types';

export const POOL_CRITERIA:PoolCriterion[]=['points','legDifference','legsFor','headToHead'];
export function poolProof(fixtures:Fixture[]):string{return createHash('sha256').update(JSON.stringify(fixtures.map(f=>[f.id,f.status,f.players,f.winnerId,f.score,f.administrative]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');}
/** Each remaining tied group is compared once, using the whole group's mini-table. */
export function poolStandings(fixtures:Fixture[],players:string[],criteria:PoolCriterion[]=POOL_CRITERIA):PoolRow[]{
 const rows:PoolRow[]=players.map(id=>({id,position:0,shared:false,played:0,won:0,drawn:0,points:0,legsFor:0,legsAgainst:0,headToHead:null}));
 for(const f of fixtures.filter(f=>f.status==='confirmed'))for(const [side,id]of f.players.entries()){
  const row=rows.find(r=>r.id===id);if(!row)continue;row.played++;row.won+=+(f.winnerId===id);row.drawn+=+(f.winnerId===null);row.points+=f.winnerId===id?2:f.winnerId===null?1:0;
  if(!f.administrative){row.legsFor+=f.score?.[side]??0;row.legsAgainst+=f.score?.[1-side]??0;}
 }
 let groups=[rows];
 for(const criterion of criteria){const next:PoolRow[][]=[];for(const group of groups){
  if(group.length<2){next.push(group);continue;}
  if(criterion==='headToHead'){
   const ids=new Set(group.map(r=>r.id)),internal=fixtures.filter(f=>f.players.every(id=>id&&ids.has(id)));
   if(internal.length!==group.length*(group.length-1)/2||internal.some(f=>f.status!=='confirmed')){next.push(group);continue;}
   for(const row of group)row.headToHead=internal.reduce((n,f)=>n+(f.winnerId===row.id?2:f.winnerId===null&&f.players.includes(row.id)?1:0),0);
  }
  const value=(row:PoolRow)=>criterion==='legDifference'?row.legsFor-row.legsAgainst:criterion==='headToHead'?row.headToHead??0:row[criterion];
  const sorted=[...group].sort((a,b)=>value(b)-value(a)),split:PoolRow[][]=[];
  for(const row of sorted){if(!split.length||value(split.at(-1)![0])!==value(row))split.push([]);split.at(-1)!.push(row);}next.push(...split);
 }groups=next;}
 let position=1;for(const group of groups){for(const row of group){row.position=position;row.shared=group.length>1;}position+=group.length;}
 return groups.flat();
}
export function tournamentFixtureReleased(fixture:Fixture):boolean{return !fixture.requiresRelease||fixture.released===true;}
