import type {PoolClient} from 'pg';
import type {SeasonState} from './seasons-types';
import type {PublicSnapshot} from './types';
import {fixtureTotals} from './seasons-domain';

/** Project only the encounter containing this already-authorized canonical game. */
export async function readSeasonDisplay(client:Pick<PoolClient,'query'>,matchId?:string):Promise<Pick<PublicSnapshot,'encounter'>>{
 if(!matchId)return {};
 const state=(await client.query<{state:SeasonState}>(`select s.state from dartflow_private.competition_seasons s join dartflow_private.platform_match_links l on l.entity_id=s.id where l.match_id=$1`,[matchId])).rows[0]?.state;
 if(!state||!['teams','doubles'].includes(state.format))return {};
 const fixture=state.fixtures.find(fixture=>fixture.slots.some(slot=>slot.matchId===matchId));
 if(!fixture)return {};
 const slot=fixture.slots.find(slot=>slot.matchId===matchId)!;
 const home=state.teams.find(team=>team.id===fixture.homeId),away=state.teams.find(team=>team.id===fixture.awayId);
 if(!home||!away)return {};
 const totals=fixtureTotals(fixture),label=state.format==='doubles'?'Koppelpartij':slot.index<4?`Single ${slot.index+1}`:slot.index<6?`Koppel ${slot.index-3}`:'Teampartij';
 return {encounter:{name:state.name,homeName:home.name,awayName:away.name,score:totals.score,legs:totals.legs,component:{index:slot.index,label}}};
}
