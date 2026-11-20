import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import {deriveThemeTokens} from './clubhouse-theme-domain';
import type {BrandingDesign} from './clubhouse-types';
import type {OcheClubBrandingChoice,OcheScreenTheme} from './oche-device-types';
type Client=Pick<PoolClient,'query'>;
type Candidate={id:string;name:string;brandingRevision:number;design:BrandingDesign;endsAt:Date|string;grantEndsAt:Date|string|null};
/** Location consent is explicit. A player's memberships or personal preference
 * are intentionally absent from this query and from the resulting screen DTO. */
async function candidates(client:Client,locationId:string):Promise<Candidate[]>{
 return(await client.query<Candidate>(`select e.id,e.state->>'name' as name,b.published_revision as "brandingRevision",b.published as design,x.ends_at as "endsAt",g.ends_at as "grantEndsAt"
 from dartflow_private.club_location_planning_grants g
 join dartflow_private.locations l on l.id=g.location_id and l.kind='venue'
 join dartflow_private.platform_entities e on e.id=g.club_id and e.kind='club' and coalesce(e.state->>'lifecycle','active')='active'
 join dartflow_private.club_branding_versions b on b.club_id=g.club_id and b.published is not null
 join dartflow_private.club_branding_entitlements x on x.club_id=g.club_id and x.revoked_at is null and x.starts_at<=clock_timestamp() and x.ends_at>clock_timestamp()
 where g.location_id=$1 and g.status='active' and(g.starts_at is null or g.starts_at<=clock_timestamp())and(g.ends_at is null or g.ends_at>clock_timestamp())
 and exists(select 1 from dartflow_private.club_location_planning_boards gb join dartflow_private.location_boards lb on lb.board_id=gb.board_id and lb.location_id=g.location_id and lb.archived_at is null where gb.grant_id=g.id and gb.active)
 order by e.state->>'name',e.id`,[locationId])).rows;
}
export async function readOcheLocationBrandingChoices(client:Client,locationId:string):Promise<OcheClubBrandingChoice[]>{return(await candidates(client,locationId)).map(({id,name,brandingRevision})=>({id,name,brandingRevision}));}
export async function requireOcheLocationClubTheme(client:Client,device:{scope:string;location_id:string|null},clubId:string):Promise<void>{
 if(device.scope!=='location'||!device.location_id)throw new DomainError('invalid_theme_scope','Een clubhuisstijl kan alleen voor een fysiek locatiescherm worden ingesteld.');
 if(!(await candidates(client,device.location_id)).some(c=>c.id===clubId))throw new DomainError('theme_unavailable','Kies een actuele gepubliceerde premiumstijl met expliciete planningskoppeling aan deze locatie.',403);
}
export async function resolveOcheDeviceTheme(client:Client,device:{scope:string;location_id:string|null;theme:string;branding_club_id:string|null}):Promise<OcheScreenTheme>{
 if(device.theme==='onzetrots')return{id:'onzetrots',version:1};
 if(device.theme!=='club'||device.scope!=='location'||!device.location_id||!device.branding_club_id)return{id:'dartflow',version:1};
 const candidate=(await candidates(client,device.location_id)).find(c=>c.id===device.branding_club_id);if(!candidate)return{id:'dartflow',version:1};
 const validUntil=new Date(Math.min(Date.now()+300_000,new Date(candidate.endsAt).getTime(),candidate.grantEndsAt?new Date(candidate.grantEndsAt).getTime():Infinity)).toISOString();
 try{return{id:'club',version:1,name:candidate.name,logoData:candidate.design.logoData,brandingRevision:candidate.brandingRevision,validUntil,tokens:{light:deriveThemeTokens(candidate.design,false),dark:deriveThemeTokens(candidate.design,true)}};}catch(error){if(error instanceof DomainError)return{id:'dartflow',version:1};throw error;}
}
