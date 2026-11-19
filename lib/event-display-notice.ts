import type {PoolClient} from 'pg';
import type {EntityRow} from './platform-store';
import {decorateCircuitQualificationState} from './circuit-qualifications';

/** Only a neutral public status; private case reasons and identities stay private. */
export async function matchEventNotice(client:Pick<PoolClient,'query'>,matchId?:string):Promise<string|null>{
 if(!matchId)return null;
 const source=(await client.query<EntityRow>('select e.* from dartflow_private.platform_entities e join dartflow_private.platform_match_links l on l.entity_id=e.id where l.match_id=$1',[matchId])).rows[0];
 if(!source)return null;
 const row=await decorateCircuitQualificationState(client,source);
 return row.state.circuitSourceStale?'Erkenning herzien':row.state.primaryCorrectionOpen||row.state.primaryCorrectionHold?'Uitslag onder herbeoordeling':null;
}
