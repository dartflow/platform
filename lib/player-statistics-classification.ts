import type {Fixture} from './platform-types';
import {standings} from './platform-domain';

type OfficialCompetition={kind:'league'|'tournament';state:{fixtures?:Fixture[];standings?:{id?:string;playerId?:string}[]}};
/** Reuse the competition's official outcome order; pool tables are never an overall knockout placing. */
export function competitionStatisticsClassification(competition:OfficialCompetition,actor:string):string|null{
 const fixtures=competition.state.fixtures??[];
 if(competition.kind==='league'){
  if(!fixtures.length||fixtures.some(f=>!['confirmed','bye'].includes(f.status)))return null;
  const players=[...new Set(fixtures.flatMap(f=>f.players).filter((id):id is string=>id!==null))];
  const persisted=competition.state.standings;
  const ordered=persisted?.length?persisted:standings(fixtures.filter(f=>f.phase!=='knockout'),players);
  const index=ordered.findIndex(row=>('id'in row&&row.id===actor)||('playerId'in row&&row.playerId===actor));
  return index<0?null:`${index+1}e plaats`;
 }
 const knockout=fixtures.filter(f=>f.phase==='knockout'&&!f.purpose),lastRound=Math.max(0,...knockout.map(f=>f.round)),finals=knockout.filter(f=>f.round===lastRound);
 if(finals.length!==1)return null;
 const final=finals[0];
 if(!['confirmed','bye'].includes(final.status)||!final.winnerId||!final.players.includes(final.winnerId)||!final.players.includes(actor))return null;
 return final.winnerId===actor?'Winnaar':'Finalist';
}
