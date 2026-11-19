import{randomUUID}from'node:crypto';
import type{Fixture,FixtureSource}from'./platform-types';
export type ConsolationState={enabled:true;title:string;completed:boolean;championId?:string;placings:{playerId:string;position:number}[];notice?:string};
/** The separate title receives only actual first-round losers. Empty bye sources
 * remain canonical references and can never manufacture a defeated player. */
export function consolationFixtures(main:Fixture[]):Fixture[]{
 const opening=main.filter(f=>f.phase==='knockout'&&!f.purpose&&f.round===1),real=opening.filter(f=>f.players.filter(Boolean).length===2),empty=opening.find(f=>f.status==='bye');if(real.length<2)return[];
 let size=2;while(size<real.length)size*=2;const byes=size-real.length,slots:(FixtureSource|null)[]=[];let cursor=0;
 for(let pair=0;pair<size/2;pair++)slots.push({fixtureId:real[cursor++].id,outcome:'loser',playedOnly:true},pair<byes?null:{fixtureId:real[cursor++].id,outcome:'loser',playedOnly:true});
 const result:Fixture[]=[];let previous:Fixture[]=[];for(let i=0;i<slots.length;i+=2){const sources=slots.slice(i,i+2).map(source=>source??{fixtureId:empty!.id,outcome:'loser' as const,playedOnly:true}),fixture:Fixture={id:randomUUID(),phase:'knockout',purpose:'consolation',round:1,players:[null,null],status:'scheduled',sources};result.push(fixture);previous.push(fixture);}
 for(let round=2;previous.length>1;round++){const next:Fixture[]=[];for(let i=0;i<previous.length;i+=2){const f:Fixture={id:randomUUID(),phase:'knockout',purpose:'consolation',round,players:[null,null],status:'scheduled',sources:previous.slice(i,i+2).map(f=>({fixtureId:f.id}))};result.push(f);next.push(f);}previous=next;}
 return result;
}
export function consolationOutcome(fixtures:Fixture[],title='Troostbeker'):ConsolationState{
 const games=fixtures.filter(f=>f.purpose==='consolation'),opening=fixtures.filter(f=>f.phase==='knockout'&&!f.purpose&&f.round===1),base:ConsolationState={enabled:true,title,completed:false,placings:[]};
 if(!games.length)return{...base,completed:opening.every(f=>['confirmed','bye','void'].includes(f.status)),notice:'Voor een troosttitel zijn ten minste twee daadwerkelijk verslagen eerste-rondedeelnemers nodig.'};
 if(games.some(f=>!['confirmed','bye','void'].includes(f.status)))return base;
 const participants=new Set(games.filter(f=>f.round===1).flatMap(f=>f.players.filter((id):id is string=>Boolean(id))));if(participants.size<2)return{...base,completed:true,notice:'Er zijn onvoldoende werkelijk gespeelde nederlagen voor een afzonderlijke troosttitel.'};
 const rounds=[...new Set(games.map(f=>f.round))].sort((a,b)=>a-b),finals=games.filter(f=>f.round===rounds.at(-1)),placings:ConsolationState['placings']=[];let eliminated=0;
 for(const round of rounds){const losers=games.filter(f=>f.round===round&&f.status==='confirmed'&&f.winnerId).flatMap(f=>f.players.filter((id):id is string=>Boolean(id)&&id!==f.winnerId));eliminated+=losers.length;for(const playerId of losers)placings.push({playerId,position:participants.size-eliminated+1});}
 const final=finals[0];if(finals.length!==1||!final.winnerId||eliminated!==participants.size-1)return base;placings.push({playerId:final.winnerId,position:1});return{...base,completed:true,championId:final.winnerId,placings};
}
