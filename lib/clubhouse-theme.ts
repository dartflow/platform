import {DomainError} from './domain';
import {clubIsActiveMember,clubPermission} from './club-access';
import {entity,transaction,uuid,hash,canonical,type Client} from './platform-store';
import {safeClubLogo} from './club-branding';
import {DEFAULT_THEME_PREFERENCE,resolveClubhouseTheme,safeThemeColor,type ThemeCandidate} from './clubhouse-theme-domain';
import type {BrandingDesign,ClubBranding,ThemeCommand} from './clubhouse-types';
export async function platformBrandingAdministrator(client:Client,actor:string){return Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount);}
export async function readThemeCandidates(client:Client,actor:string):Promise<ThemeCandidate[]> {
 const rows=await client.query(`select e.id as "clubId",e.state->>'name' as name,b.published_revision as "brandingRevision",b.published as design,x.ends_at as "endsAt" from dartflow_private.club_branding_versions b join dartflow_private.club_branding_entitlements x on x.club_id=b.club_id join dartflow_private.platform_entities e on e.id=b.club_id and e.kind='club' join dartflow_private.platform_members m on m.entity_id=e.id and m.user_id=$1 and m.status='active' join dartflow_private.club_memberships c on c.club_id=e.id and c.user_id=$1 where coalesce(e.state->>'lifecycle','active')='active' and b.published is not null and x.revoked_at is null and x.starts_at<=now() and x.ends_at>now() order by e.state->>'name',e.id`,[actor]);
 return rows.rows.map(row=>({...row,endsAt:new Date(row.endsAt).toISOString()}));
}
export async function readClubhouseTheme(client:Client,actor:string,clubId?:string) {
 if(clubId)uuid(clubId);
 const row=(await client.query('select mode,club_id as "clubId",color_mode as "colorMode",revision from dartflow_private.player_theme_preferences where user_id=$1',[uuid(actor)])).rows[0];
 return resolveClubhouseTheme(row??{...DEFAULT_THEME_PREFERENCE},await readThemeCandidates(client,actor),clubId);
}
export async function getClubhouseTheme(actor:string,clubId?:string){return transaction(client=>readClubhouseTheme(client,actor,clubId));}
export async function executeThemeCommand(actor:string,command:ThemeCommand){
 if(!command||command.action?.type!=='preference'||!['auto','dartflow','club'].includes(command.action.mode)||!['system','light','dark'].includes(command.action.colorMode)||!Number.isSafeInteger(command.expectedRevision))throw new DomainError('invalid_preference','Kies een geldige weergavevoorkeur.');
 uuid(command.requestId);const a=command.action;if(a.clubId!==null)uuid(a.clubId);
 if(a.mode==='club'&&!a.clubId)throw new DomainError('invalid_preference','Kies een beschikbare vereniging.');
 return transaction(async client=>{
  await client.query('select id from dartflow_private.profiles where id=$1 for update',[uuid(actor)]);
  const previous=(await client.query('select * from dartflow_private.player_theme_preferences where user_id=$1',[actor])).rows[0];
  const candidates=await readThemeCandidates(client,actor);
  if(a.clubId&&!candidates.some(c=>c.clubId===a.clubId))throw new DomainError('theme_unavailable','Deze verenigingsstijl is niet meer beschikbaar. Kies opnieuw.',409);
  // Repeating a committed preference is safe; stale different edits remain a conflict.
  if((previous?.revision??0)!==command.expectedRevision){if(previous?.mode===a.mode&&previous?.club_id===a.clubId&&previous?.color_mode===a.colorMode)return readClubhouseTheme(client,actor);throw new DomainError('revision_conflict','Je weergavevoorkeur is elders gewijzigd. Laad opnieuw.',409);}
  await client.query('insert into dartflow_private.player_theme_preferences(user_id,mode,club_id,color_mode)values($1,$2,$3,$4)on conflict(user_id)do update set mode=excluded.mode,club_id=excluded.club_id,color_mode=excluded.color_mode,revision=player_theme_preferences.revision+1',[actor,a.mode,a.mode==='dartflow'?null:a.clubId,a.colorMode]);
  return readClubhouseTheme(client,actor);
 });
}
export async function readClubBranding(client:Client,actor:string,clubId:string):Promise<ClubBranding>{
 const e=(await client.query('select starts_at as "startsAt",ends_at as "endsAt",revoked_at as "revokedAt",(revoked_at is null and starts_at<=now() and ends_at>now()) as effective from dartflow_private.club_branding_entitlements where club_id=$1',[clubId])).rows[0];
 const b=(await client.query('select draft,published,revision,published_revision as "publishedRevision" from dartflow_private.club_branding_versions where club_id=$1',[clubId])).rows[0];
 return {entitlement:e?{key:'association.branding.global',...e}:null,draft:b?.draft??null,published:b?.published??null,revision:b?.revision??0,publishedRevision:b?.publishedRevision??0,canManage:await clubPermission(client,clubId,actor,'branding.manage'),canManageEntitlement:await platformBrandingAdministrator(client,actor)};
}
export async function brandingAction(client:Client,actor:string,clubId:string,action:Record<string,unknown>,expectedRevision?:number){
 const row=await entity(client,clubId,true);if(row.kind!=='club')throw new DomainError('not_found','Deze vereniging bestaat niet.',404);
 const type=String(action.type);
 if(type.startsWith('entitlement.')){
  if(!await platformBrandingAdministrator(client,actor))throw new DomainError('forbidden','Alleen platformbeheerders beheren premiumrechten.',403);
  if(type==='entitlement.revoke')await client.query('update dartflow_private.club_branding_entitlements set revoked_at=now() where club_id=$1',[clubId]);
  else if(type==='entitlement.grant'){
   const start=new Date(String(action.startsAt)),end=new Date(String(action.endsAt));if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw new DomainError('entitlement_period','Kies een geldige begin- en einddatum.');
   await client.query('insert into dartflow_private.club_branding_entitlements(club_id,starts_at,ends_at,granted_by)values($1,$2,$3,$4)on conflict(club_id)do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,revoked_at=null,granted_by=excluded.granted_by',[clubId,start,end,actor]);
  }else throw new DomainError('invalid_action','Onbekende premiumactie.');
  return;
 }
 if(!await clubIsActiveMember(client,clubId,actor)||!await clubPermission(client,clubId,actor,'branding.manage'))throw new DomainError('forbidden','Je mag deze verenigingsstijl niet beheren.',403);
 const b=await readClubBranding(client,actor,clubId);
 if(expectedRevision!==b.revision)throw new DomainError('revision_conflict','De huisstijl is elders gewijzigd. Laad de nieuwste versie.',409);
 if(type==='branding.save'){
  const d=action.design as BrandingDesign;if(!d||typeof d.name!=='string'||!d.name.trim()||d.name.length>80)throw new DomainError('invalid_branding','Vul een naam voor de huisstijl in.');
  const design:BrandingDesign={name:d.name.trim(),primary:safeThemeColor(d.primary),secondary:safeThemeColor(d.secondary),logoData:await safeClubLogo(d.logoData)};
  await client.query('insert into dartflow_private.club_branding_versions(club_id,draft,revision)values($1,$2,1)on conflict(club_id)do update set draft=excluded.draft,revision=club_branding_versions.revision+1,updated_at=now()',[clubId,JSON.stringify(design)]);
 }else if(type==='branding.publish'){
  if(!b.entitlement?.effective)throw new DomainError('premium_required','Een actief premiumrecht is nodig om deze huisstijl te publiceren.',403);
  if(!b.draft)throw new DomainError('branding_draft_missing','Sla eerst een huisstijlontwerp op.');
  await client.query('update dartflow_private.club_branding_versions set published=draft,revision=revision+1,published_revision=revision+1,updated_at=now() where club_id=$1',[clubId]);
 }else throw new DomainError('invalid_action','Onbekende huisstijlactie.');
 const current=await readClubBranding(client,actor,clubId),stage=type==='branding.publish'?'published':'draft';await client.query('insert into dartflow_private.club_branding_history(club_id,revision,stage,design,actor_id)values($1,$2,$3,$4,$5)',[clubId,current.revision,stage,JSON.stringify(stage==='published'?current.published:current.draft),actor]);
}
export async function getPlatformBranding(actor:string){return transaction(async client=>{if(!await platformBrandingAdministrator(client,actor))throw new DomainError('forbidden','Geen platformbeheerrecht.',403);const rows=await client.query("select id,state->>'name' as name from dartflow_private.platform_entities where kind='club' order by state->>'name',id");const clubs=[];for(const row of rows.rows)clubs.push({...row,branding:await readClubBranding(client,actor,row.id)});return {clubs};});}
// Useful for shared request hashing without serializing private design data in logs.
export const themeCommandHash=(command:unknown)=>hash(canonical(command));
