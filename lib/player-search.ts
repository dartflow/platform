import{database}from'./db';
import{DomainError}from'./domain';
import{assertAccountActive}from'./account-removal';
import type{Profile}from'./types';
export type PlayerSearchResponse={players:Profile[];offset:number;nextOffset:number|null};
/** Public identity directory. Filtering precedes paging; personal names are never searched. */
export async function searchPlayers(actor:string,search:unknown='',offsetValue:unknown=0):Promise<PlayerSearchResponse>{
 await assertAccountActive(actor);if(typeof search!=='string'||search.length>80)throw new DomainError('invalid_search','Gebruik maximaal 80 tekens om op displaynaam of gebruikersnaam te zoeken.');
 const query=search.normalize('NFKC').toLowerCase().trim().replace(/^@/,''),offset=Number(offsetValue??0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new DomainError('invalid_page','Kies een geldige resultaatpagina.');
 const rows=(await database().query<Profile>(`select p.id,l.name,l.username,l.display_name as "displayName",null::text as avatar
 from dartflow_private.profiles p join dartflow_private.profile_labels l using(id)
 left join dartflow_private.platform_preferences f on f.user_id=p.id
 where p.id<>$1 and p.display_name_confirmed and p.deletion_requested_at is null and p.deleted_at is null and coalesce(f.discoverable,true)
 and not exists(select 1 from dartflow_private.event_guests g where g.profile_id=p.id)
 and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block'and((b.source_id=$1 and b.target_id=p.id)or(b.source_id=p.id and b.target_id=$1)))
 and($2=''or position($2 in dartflow_private.username_key(coalesce(p.display_name,'')))>0 or position(dartflow_private.username_key($2)in dartflow_private.username_key(p.name))>0)
 order by case when dartflow_private.username_key(p.name)=$2 then 0 else 1 end,l.name,p.id limit 51 offset $3`,[actor,query,offset])).rows;
 return{players:rows.slice(0,50),offset,nextOffset:rows.length>50?offset+50:null};
}
