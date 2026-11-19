import type {PoolClient} from 'pg';
import {clubIsActiveMember,clubPermission} from './club-access';
import type {SeasonState} from './seasons-types';
type Client=Pick<PoolClient,'query'>;
type Scope=Pick<SeasonState,'scope'|'clubId'|'managerIds'>;
/** Technical platform authority may appoint an official, without granting that official a platform role. */
export async function nationalSeasonAuthority(client:Client,actor:string):Promise<boolean>{return Boolean((await client.query("select 1 from dartflow_private.platform_roles r join dartflow_private.profiles p on p.id=r.user_id where r.user_id=$1 and r.role in('owner','admin') and p.deleted_at is null and p.deletion_requested_at is null",[actor])).rowCount);}
export async function activeSeasonOfficial(client:Client,actor:string):Promise<boolean>{return Boolean((await client.query('select 1 from dartflow_private.profiles p where p.id=$1 and p.display_name_confirmed and p.deleted_at is null and p.deletion_requested_at is null and not exists(select 1 from dartflow_private.event_guests g where g.profile_id=p.id)',[actor])).rowCount);}
/** Fresh, season-scoped authority; managerIds never grants a club or platform role. */
export async function seasonManager(client:Client,s:Scope,actor:string):Promise<boolean>{
 if(s.scope==='national')return await nationalSeasonAuthority(client,actor)||s.managerIds.includes(actor)&&await activeSeasonOfficial(client,actor);
 return s.clubId!==null&&(await clubPermission(client,s.clubId,actor,'competitions.manage')||s.managerIds.includes(actor)&&await clubIsActiveMember(client,s.clubId,actor));
}
export async function seasonDelegationAuthority(client:Client,s:Scope,actor:string):Promise<boolean>{return s.scope==='national'?nationalSeasonAuthority(client,actor):seasonManager(client,s,actor);}
