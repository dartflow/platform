import type {PoolClient} from 'pg';
import {socialAction} from './platform-social';
import {notifyClubhouse} from './clubhouse-notifications';
import {enqueueAuditedNotification} from './notification-audit-source';
import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {clubIsActiveMember,clubPermission} from './club-access';
import {clubView} from './club-domain';
import {canonical,entity,hash,number,save,text,transaction,uuid,type Client,type EntityRow} from './platform-store';
import {readClubhouseTheme,readClubBranding,brandingAction,platformBrandingAdministrator} from './clubhouse-theme';
import {readClubChannels,readClubChannel,clubChannelAction,channelAccess} from './clubhouse-chat';
import {getClubSeasons} from './seasons';
import {competitionPlanningLocations} from './competition-planning-access';
import {getOverview} from './db';
import {getCommunityFeed} from './community';
import {CLUBHOUSE_PAGES,type ClubhouseCommand,type ClubhousePage,type ClubhouseView,type ClubTeam,type ClubActivity,type ClubTask} from './clubhouse-types';
import type {ClubPermission} from './club-types';
async function access(client:Client,actor:string,clubId:string,permission?:ClubPermission,lock=false){
 const row=await entity(client,uuid(clubId),lock);
 if(row.kind!=='club'||!await clubIsActiveMember(client,row.id,uuid(actor)))throw new DomainError('forbidden','Alleen huidige leden hebben toegang tot dit Clubhouse.',403);
 if(permission&&!await clubPermission(client,row.id,actor,permission))throw new DomainError('forbidden','Je hebt geen beheerrecht voor dit onderdeel.',403);
 return row;
}
const teamsSql='select id,club_id as "clubId",name,captain_id as "captainId",member_ids as "memberIds",reserve_ids as "reserveIds",active,revision from dartflow_private.club_teams';
export async function readClubTeams(client:Client,clubId:string):Promise<ClubTeam[]>{return (await client.query<ClubTeam>(teamsSql+' where club_id=$1 order by name,id',[clubId])).rows;}
export async function assertClubRoster(client:Client,clubId:string,ids:string[]){
 for(const id of [...new Set(ids)].sort())if(!await clubIsActiveMember(client,clubId,uuid(id)))throw new DomainError('invalid_club_member','Selecteer uitsluitend huidige actieve verenigingsleden.');
}
function ids(value:unknown,max=100):string[]{if(!Array.isArray(value)||value.length>max)throw new DomainError('invalid_roster','Kies een geldige ledenlijst.');const result=value.map(uuid);if(new Set(result).size!==result.length)throw new DomainError('duplicate_member','Een lid mag maar één keer worden gekozen.');return result;}
function instant(value:unknown):string{if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new DomainError('invalid_time','Gebruik een tijdstip met expliciete tijdzone-offset.');return new Date(value).toISOString();}
function revision(expected:unknown,actual:number){if(expected!==actual)throw new DomainError('revision_conflict','Dit onderdeel is elders gewijzigd. Laad de nieuwste versie.',409);}
async function readActivities(client:Client,actor:string,clubId:string,manage:boolean):Promise<ClubActivity[]>{
 const {rows}=await client.query<ClubActivity>(`select a.id,a.club_id as "clubId",title,description,type,organizer_id as "organizerId",last_change as "lastChange",updated_at as "updatedAt",location,organizer_name as "organizerName",starts_at as "startsAt",ends_at as "endsAt",time_zone as "timeZone",capacity,revision,(select count(*)::int from dartflow_private.club_activity_entries e where e.activity_id=a.id and e.status='registered') as registered,(select count(*)::int from dartflow_private.club_activity_entries e where e.activity_id=a.id and e.status='waitlisted') as waitlisted,(select status from dartflow_private.club_activity_entries e where e.activity_id=a.id and e.user_id=$2) as "myStatus" from dartflow_private.club_activities a where club_id=$1 order by starts_at,id limit 500`,[clubId,actor]);
 for(const row of rows){row.participants=(await client.query<ClubActivity['participants'][number]>(`select e.user_id as "userId",p.name,e.status from dartflow_private.club_activity_entries e join dartflow_private.profile_labels p on p.id=e.user_id where e.activity_id=$1 and ($3::boolean or e.user_id=$2) order by e.created_at,e.user_id`,[row.id,actor,manage])).rows;}
 return rows.map(row=>({...row,canManage:manage,startsAt:new Date(row.startsAt).toISOString(),endsAt:new Date(row.endsAt).toISOString()}));
}
async function readTasks(client:Client,actor:string,clubId:string,manage:boolean):Promise<ClubTask[]>{
 const {rows}=await client.query<ClubTask>(`select t.id,title,description,starts_at as "startsAt",ends_at as "endsAt",function,activity_id as "activityId",owner_id as "ownerId",deadline,status,capacity,revision,case when $2 then private_note else null end as "privateNote",activity,coalesce((select array_agg(user_id order by user_id) from dartflow_private.club_task_volunteers v where v.task_id=t.id),'{}') as "volunteerIds" from dartflow_private.club_tasks t where club_id=$1 order by deadline nulls last,id limit 500`,[clubId,manage]);
 return rows.map(row=>({...row,deadline:row.deadline?new Date(row.deadline).toISOString():null,...(!manage?{privateNote:undefined}:{})}));
}
async function readView(client:Client,actor:string,clubId:string,page:ClubhousePage):Promise<ClubhouseView>{
 const row=await access(client,actor,clubId);const club=await clubView(client,row,actor),permissions=club.clubAccess.permissions;
 const competitions=await getClubSeasons(actor,clubId),overview=await getOverview(actor,clubId),locations=await competitionPlanningLocations(client,clubId);
 const linkedIds=new Set(competitions.flatMap(s=>s.fixtures.flatMap(f=>f.slots.flatMap(slot=>slot.matchId?[slot.matchId]:[]))));
 const matches:ClubhouseView['matches']=competitions.flatMap(s=>s.fixtures.map(f=>{const label=(id:string)=>s.teams.find(t=>t.id===id)?.name??s.participants.find(p=>p.id===id)?.name??'Deelnemer',matchId=f.slots.map(slot=>slot.matchId).find(id=>overview.matches.some(m=>m.id===id))??null;return{id:f.id,matchId,seasonId:s.id,name:`${s.name} · ${label(f.homeId)} – ${label(f.awayId)}`,status:f.status,playerNames:[label(f.homeId),label(f.awayId)],startsAt:f.startsAt??null,endsAt:f.endsAt??null,canOpen:true};}));
 matches.push(...overview.matches.filter(m=>!linkedIds.has(m.id)).map(m=>({id:m.id,matchId:m.id,seasonId:null,name:m.players.map(p=>p.name).join(' – '),status:m.status,playerNames:m.players.map(p=>p.name),startsAt:null,endsAt:null,canOpen:true})));
 matches.sort((a,b)=>(a.startsAt??'9999').localeCompare(b.startsAt??'9999')||a.id.localeCompare(b.id));
 const teams=await readClubTeams(client,clubId),activities=await readActivities(client,actor,clubId,permissions.includes('calendar.manage')),tasks=await readTasks(client,actor,clubId,permissions.includes('tasks.manage'));
 const now=new Date(),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString(),to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();
 const individual=(await client.query(`select count(*)::int as n from dartflow_private.matches m join dartflow_private.match_results r on r.match_id=m.id where m.club_id=$1 and m.state->>'status'='confirmed' and r.created_at>=$2 and r.created_at<$3 and not exists(select 1 from dartflow_private.platform_match_links ml join dartflow_private.competition_seasons cs on cs.id=ml.entity_id where ml.match_id=m.id and cs.state->>'format' in('teams','doubles'))`,[clubId,from,to])).rows[0].n;
 const teamMatches=competitions.filter(s=>['teams','doubles'].includes(s.format)).reduce((n,s)=>n+s.fixtures.filter(f=>f.status==='confirmed'&&f.confirmedAt&&f.confirmedAt>=from&&f.confirmedAt<to).length,0);
 const ownership=(await client.query('select id,recipient_id as "recipientId",expires_at as "expiresAt" from dartflow_private.club_ownership_transfers where club_id=$1 and status=\'pending\' and expires_at>now() and (owner_id=$2 or recipient_id=$2)',[clubId,actor])).rows[0]??null;
 const reports:ClubhouseView['reports']=permissions.includes('chat.moderate')?(await client.query(`select r.id,p.name as "reporterName",r.category,r.reason,r.status,r.decision,r.target_type as "targetType",r.content_id as "contentId",r.created_at as "createdAt" from dartflow_private.platform_reports r join dartflow_private.profile_labels p on p.id=r.reporter_id where r.scope_kind='club' and r.scope_id=$1 and r.target_id is distinct from $2 order by r.created_at desc,r.id limit 100`,[clubId,actor])).rows:[];
 return {club,page,permissions,reports,competitions,matches,locations,nextMatch:matches.find(m=>m.startsAt&&Date.parse(m.startsAt)>=Date.now()&&!['confirmed','abandoned','canceled'].includes(m.status))??matches.find(m=>!m.startsAt&&!['confirmed','abandoned','canceled'].includes(m.status))??null,pages:CLUBHOUSE_PAGES,revision:row.revision,theme:await readClubhouseTheme(client,actor,clubId),metrics:{basis:'confirmed_results',period:{from,to},members:club.members.filter(m=>m.status==='active').length,activeTeams:teams.filter(t=>t.active).length,individualMatches:individual,teamMatches},teams,activities,tasks,dues:[],channels:await readClubChannels(client,actor,clubId),branding:permissions.includes('branding.manage')?await readClubBranding(client,actor,clubId):null,ownershipTransfer:ownership,...(['overview','feed'].includes(page)?{feed:await getCommunityFeed(actor,{kind:'club',id:clubId,scopeOnly:true,limit:page==='overview'?3:30},client)}:{})};
}
export async function getClubhouse(actor:string,clubId:string,pageValue:unknown='overview'){
 if(typeof pageValue!=='string'||!CLUBHOUSE_PAGES.includes(pageValue as ClubhousePage))throw new DomainError('invalid_page','Deze Clubhouse-pagina bestaat niet.',404);
 return transaction(client=>readView(client,actor,clubId,pageValue as ClubhousePage));
}
async function actionPermission(client:Client,actor:string,row:EntityRow,type:string){
 const permission:ClubPermission|undefined=type==='report.resolve'?'chat.moderate':type.startsWith('branding.')?'branding.manage':type==='channel.save'||type==='channel.archive'?'channels.manage':type.startsWith('member.')?'members.manage':type.startsWith('team.')?'teams.manage':type==='activity.save'?'calendar.manage':type==='task.save'?'tasks.manage':undefined;
 if(permission&&!await clubPermission(client,row.id,actor,permission))throw new DomainError('forbidden','Je mag dit onderdeel niet beheren.',403);
 if(type.startsWith('entitlement.')&&!await platformBrandingAdministrator(client,actor))throw new DomainError('forbidden','Alleen platformbeheerders beheren premiumrechten.',403);
 if(type.startsWith('ownership.')&&type!=='ownership.accept'&&row.owner_id!==actor)throw new DomainError('forbidden','Alleen de huidige eigenaar kan een overdracht aanbieden of intrekken.',403);
}
async function teamAction(client:Client,actor:string,clubId:string,a:Record<string,unknown>,expected?:number){
 const id=a.id?uuid(a.id):randomUUID(),old=(await client.query(teamsSql+' where id=$1 and club_id=$2 for update',[id,clubId])).rows[0];
 if(a.id&&!old)throw new DomainError('team_missing','Dit team hoort niet bij deze vereniging.',404);revision(expected??0,old?.revision??0);
 if(a.type==='team.archive'){await client.query('update dartflow_private.club_teams set active=false,revision=revision+1 where id=$1',[id]);return;}
 if(a.type!=='team.save')throw new DomainError('invalid_action','Onbekende teamactie.');
 const members=ids(a.memberIds),reserves=ids(a.reserveIds??[]),captain=uuid(a.captainId);if(!members.includes(captain)||members.some(id=>reserves.includes(id)))throw new DomainError('invalid_roster','De aanvoerder is een vaste speler; reserves staan apart.');
 await assertClubRoster(client,clubId,[...members,...reserves]);
 await client.query('insert into dartflow_private.club_teams(id,club_id,name,captain_id,member_ids,reserve_ids)values($1,$2,$3,$4,$5,$6)on conflict(id)do update set name=excluded.name,captain_id=excluded.captain_id,member_ids=excluded.member_ids,reserve_ids=excluded.reserve_ids,active=true,revision=club_teams.revision+1',[id,clubId,text(a.name,80),captain,members,reserves]);
}
async function activityAction(client:Client,actor:string,clubId:string,a:Record<string,unknown>,expected?:number){
 const id=a.id?uuid(a.id):randomUUID(),old=(await client.query('select * from dartflow_private.club_activities where id=$1 and club_id=$2 for update',[id,clubId])).rows[0];
 if(a.id&&!old)throw new DomainError('activity_missing','Deze activiteit hoort niet bij deze vereniging.',404);
 if(a.type==='activity.save'){
  revision(expected??0,old?.revision??0);const start=instant(a.startsAt),end=instant(a.endsAt),tz=text(a.timeZone??'Europe/Amsterdam',80);try{new Intl.DateTimeFormat('nl',{timeZone:tz}).format();}catch{throw new DomainError('invalid_time_zone','Kies een geldige tijdzone.');}
  if(Date.parse(end)<=Date.parse(start))throw new DomainError('invalid_period','De eindtijd moet na de begintijd liggen.');
  const capacity=number(a.capacity,20,1,10000),registered=(await client.query("select count(*)::int as n from dartflow_private.club_activity_entries where activity_id=$1 and status='registered'",[id])).rows[0].n;
  if(capacity<registered)throw new DomainError('capacity_conflict','De capaciteit kan niet lager zijn dan het aantal deelnemers.',409);
  await client.query('insert into dartflow_private.club_activities(id,club_id,title,description,starts_at,ends_at,time_zone,capacity,location,organizer_name)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)on conflict(id)do update set title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,time_zone=excluded.time_zone,capacity=excluded.capacity,location=excluded.location,organizer_name=excluded.organizer_name,revision=club_activities.revision+1',[id,clubId,text(a.title,160),text(a.description??'',4000,false),start,end,tz,capacity,text(a.location??'',160,false),text(a.organizerName??'',160,false)]);
  const type=String(a.typeOfActivity??a.activityType??old?.type??'club'),organizer=a.organizerId?uuid(a.organizerId):old?.organizer_id??actor;if(!['club','training','match','social','meeting','other'].includes(type))throw new DomainError('invalid_activity_type','Kies een geldig soort activiteit.');await assertClubRoster(client,clubId,[organizer]);
  const changed=old&&(new Date(old.starts_at).toISOString()!==start||new Date(old.ends_at).toISOString()!==end||old.location!==text(a.location??'',160,false));
  await client.query('update dartflow_private.club_activities set type=$2,organizer_id=$3,last_change=$4,updated_at=now() where id=$1',[id,type,organizer,changed?'Tijd of locatie gewijzigd. Je deelname is behouden; controleer de actuele afspraak.':old?.last_change??'']);
  if(changed)await notifyClubhouse(client,{clubId,actorId:actor,templateId:'club-activity-update',resourceId:id,revision:old.revision+1,recipientIds:(await client.query('select user_id from dartflow_private.club_activity_entries where activity_id=$1',[id])).rows.map(r=>r.user_id),name:text(a.title,160),expiresAt:end});
 }else{
  if(!old||new Date(old.starts_at).getTime()<=Date.now())throw new DomainError('registration_closed','De inschrijving is gesloten.',409);
  if(a.type==='activity.join'){
   const registered=(await client.query("select count(*)::int as n from dartflow_private.club_activity_entries where activity_id=$1 and status='registered'",[id])).rows[0].n;
   await client.query('insert into dartflow_private.club_activity_entries(activity_id,user_id,status)values($1,$2,$3)on conflict do nothing',[id,actor,registered<old.capacity?'registered':'waitlisted']);
  }else if(a.type==='activity.leave'){const previous=(await client.query('delete from dartflow_private.club_activity_entries where activity_id=$1 and user_id=$2 returning created_at',[id,actor])).rows[0];if(previous&&old.organizer_id)await notifyClubhouse(client,{clubId,actorId:actor,templateId:'club-activity-withdrawal',resourceId:id,revision:old.revision,eventSuffix:`${actor}:${new Date(previous.created_at).getTime()}`,recipientIds:[old.organizer_id],name:old.title,expiresAt:new Date(old.ends_at).toISOString()});}
  else throw new DomainError('invalid_action','Onbekende agenda-actie.');
 }
 // Hold the activity row lock while filling places in stable wait-list order.
 const current=(await client.query('select capacity from dartflow_private.club_activities where id=$1',[id])).rows[0];
 const count=(await client.query("select count(*)::int as n from dartflow_private.club_activity_entries where activity_id=$1 and status='registered'",[id])).rows[0].n;
 const promoted=(await client.query("update dartflow_private.club_activity_entries set status='registered' where (activity_id,user_id) in(select activity_id,user_id from dartflow_private.club_activity_entries where activity_id=$1 and status='waitlisted' order by created_at,user_id limit $2)returning user_id,created_at::text as joined",[id,Math.max(0,current.capacity-count)])).rows;
 for(const member of promoted)await enqueueAuditedNotification(client,{eventId:`activity-promoted:${id}:${member.user_id}:${member.joined}`,templateId:'club-activity-promoted',actorId:actor,recipientIds:[member.user_id],source:{kind:'club-activity',activityId:id,clubId},href:`/app/clubs/${clubId}/agenda?activity=${id}`,status:'Je hebt nu een bevestigde plaats voor deze activiteit.'});
}
async function taskAction(client:Client,actor:string,clubId:string,a:Record<string,unknown>,expected?:number){
 const id=a.id?uuid(a.id):randomUUID(),old=(await client.query('select * from dartflow_private.club_tasks where id=$1 and club_id=$2 for update',[id,clubId])).rows[0];if(a.id&&!old)throw new DomainError('task_missing','Deze taak hoort niet bij deze vereniging.',404);
 const change={at:new Date().toISOString(),actorId:actor,action:String(a.type)};
 if(a.type==='task.save'){
  revision(expected??0,old?.revision??0);const owner=a.ownerId?uuid(a.ownerId):null;if(owner)await assertClubRoster(client,clubId,[owner]);const status=String(a.status??'open');if(!['open','in_progress','done'].includes(status))throw new DomainError('invalid_status','Kies een geldige taakstatus.');const capacity=number(a.capacity,1,1,1000),count=(await client.query('select count(*)::int as n from dartflow_private.club_task_volunteers where task_id=$1',[id])).rows[0].n;if(capacity<count)throw new DomainError('capacity_conflict','Er zijn al meer vrijwilligers ingeschreven.',409);
  await client.query('insert into dartflow_private.club_tasks(id,club_id,title,description,owner_id,deadline,status,capacity,private_note,activity)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)on conflict(id)do update set title=excluded.title,description=excluded.description,owner_id=excluded.owner_id,deadline=excluded.deadline,status=excluded.status,capacity=excluded.capacity,private_note=excluded.private_note,activity=club_tasks.activity||excluded.activity,revision=club_tasks.revision+1',[id,clubId,text(a.title,160),text(a.description??'',4000,false),owner,a.deadline?instant(a.deadline):null,status,capacity,text(a.privateNote??'',4000,false),JSON.stringify([change])]);
  const starts=a.startsAt===undefined?(old?.starts_at?new Date(old.starts_at).toISOString():null):a.startsAt?instant(a.startsAt):null,ends=a.endsAt===undefined?(old?.ends_at?new Date(old.ends_at).toISOString():null):a.endsAt?instant(a.endsAt):null,activityId=a.activityId===undefined?old?.activity_id??null:a.activityId?uuid(a.activityId):null,role=text(a.function??old?.function??'',120,false);
  if(Boolean(starts)!==Boolean(ends)||starts&&ends&&Date.parse(ends)<=Date.parse(starts))throw new DomainError('invalid_period','Vul voor een dienst een begin- en eindtijd in.');
  if(activityId&&!(await client.query('select 1 from dartflow_private.club_activities where id=$1 and club_id=$2',[activityId,clubId])).rowCount)throw new DomainError('activity_missing','Koppel uitsluitend een activiteit van deze vereniging.',404);
  await client.query('update dartflow_private.club_tasks set starts_at=$2,ends_at=$3,function=$4,activity_id=$5 where id=$1',[id,starts,ends,role,activityId]);
  if(old&&((old.starts_at?new Date(old.starts_at).toISOString():null)!==starts||(old.ends_at?new Date(old.ends_at).toISOString():null)!==ends||old.function!==role))await notifyClubhouse(client,{clubId,actorId:actor,templateId:'club-task-update',resourceId:id,revision:old.revision+1,recipientIds:(await client.query('select user_id from dartflow_private.club_task_volunteers where task_id=$1',[id])).rows.map(r=>r.user_id),name:text(a.title,160),expiresAt:ends?new Date(ends).toISOString():undefined});
 }else if(a.type==='task.status'){
  if(!old)throw new DomainError('task_missing','Deze taak bestaat niet.',404);if(old.owner_id!==actor&&!await clubPermission(client,clubId,actor,'tasks.manage'))throw new DomainError('forbidden','Je mag alleen je eigen taak afronden of heropenen.',403);revision(expected,old.revision);const status=String(a.status);if(!['open','in_progress','done'].includes(status))throw new DomainError('invalid_status','Kies een geldige taakstatus.');await client.query('update dartflow_private.club_tasks set status=$2,revision=revision+1,activity=activity||$3::jsonb where id=$1',[id,status,JSON.stringify([{...change,action:`task.status.${status}`}])]);
 }else{
  if(!old||old.status==='done')throw new DomainError('task_closed','Deze taak is afgerond.',409);
  if(a.type==='task.volunteer'){
   const existing=await client.query('select 1 from dartflow_private.club_task_volunteers where task_id=$1 and user_id=$2',[id,actor]);if(!existing.rowCount){const count=(await client.query('select count(*)::int as n from dartflow_private.club_task_volunteers where task_id=$1',[id])).rows[0].n;if(count>=old.capacity)throw new DomainError('capacity_reached','Alle vrijwilligersplaatsen zijn gevuld.',409);await client.query('insert into dartflow_private.club_task_volunteers(task_id,user_id)values($1,$2)',[id,actor]);}
  }else if(a.type==='task.withdraw')await client.query('delete from dartflow_private.club_task_volunteers where task_id=$1 and user_id=$2',[id,actor]);else throw new DomainError('invalid_action','Onbekende taakactie.');
  await client.query('update dartflow_private.club_tasks set revision=revision+1,activity=activity||$2::jsonb where id=$1',[id,JSON.stringify([change])]);
 }
}
async function ownershipAction(client:Client,actor:string,row:EntityRow,a:Record<string,unknown>){
 if(a.type==='ownership.offer'){
  const recipient=uuid(a.recipientId);if(recipient===actor)throw new DomainError('invalid_owner','Kies een ander actief lid.');await assertClubRoster(client,row.id,[recipient]);
  await client.query("update dartflow_private.club_ownership_transfers set status='cancelled' where club_id=$1 and status='pending'",[row.id]);await client.query("insert into dartflow_private.club_ownership_transfers(id,club_id,owner_id,recipient_id,expires_at,status)values($1,$2,$3,$4,now()+interval '7 days','pending')",[randomUUID(),row.id,actor,recipient]);
 }else if(a.type==='ownership.cancel')await client.query("update dartflow_private.club_ownership_transfers set status='cancelled' where club_id=$1 and owner_id=$2 and status='pending'",[row.id,actor]);
 else if(a.type==='ownership.accept'){
  const offer=(await client.query("select * from dartflow_private.club_ownership_transfers where id=$1 and club_id=$2 and recipient_id=$3 and status='pending' and expires_at>now() for update",[uuid(a.transferId),row.id,actor])).rows[0];if(!offer||offer.owner_id!==row.owner_id)throw new DomainError('transfer_expired','Deze overdracht is niet meer beschikbaar.',409);await assertClubRoster(client,row.id,[actor,offer.owner_id]);
  await client.query("update dartflow_private.platform_members set role='member' where entity_id=$1 and user_id=$2",[row.id,row.owner_id]);await client.query("update dartflow_private.platform_members set role='owner' where entity_id=$1 and user_id=$2",[row.id,actor]);await client.query('delete from dartflow_private.club_member_roles where club_id=$1 and user_id=any($2::uuid[])',[row.id,[row.owner_id,actor]]);await client.query("update dartflow_private.club_memberships set role=case when user_id=$2 then 'organizer' else 'player' end where club_id=$1 and user_id=any($3::uuid[])",[row.id,actor,[row.owner_id,actor]]);row.owner_id=actor;await save(client,row);await client.query("update dartflow_private.club_ownership_transfers set status='accepted' where id=$1",[offer.id]);
 }else throw new DomainError('invalid_action','Onbekende overdrachtsactie.');
}
async function memberAction(client:Client,actor:string,row:EntityRow,a:Record<string,unknown>){
 const target=uuid(a.userId);if(target===row.owner_id||target===actor)throw new DomainError('invalid_member','Het eigenaarschap en je eigen toegang wijzig je via de daarvoor bestemde actie.');
 const current=(await client.query('select role,status from dartflow_private.platform_members where entity_id=$1 and user_id=$2 for update',[row.id,target])).rows[0];if(current&&current.role!=='member'&&row.owner_id!==actor)throw new DomainError('owner_required','Alleen de eigenaar kan de toegang van een functionaris wijzigen.',403);if(!current)throw new DomainError('member_missing','Dit lid hoort niet bij deze vereniging.',404);
 if((await client.query("select 1 from dartflow_private.match_players p join dartflow_private.matches m on m.id=p.match_id where p.user_id=$1 and m.club_id=$2 and m.state->>'status' not in('confirmed','planned','abandoned')",[target,row.id])).rowCount)throw new DomainError('active_match','Rond de actieve wedstrijd van dit lid eerst af.',409);
 if(a.type==='member.restore'){
  if(!['banned','left'].includes(current.status))throw new DomainError('invalid_status','Dit lid is niet geschorst of uitgeschreven.',409);
  const capacity=(await client.query("select count(*)::int as n from dartflow_private.platform_members where entity_id=$1 and status='active'",[row.id])).rows[0].n;
  if(capacity>=Number(row.state.capacity??64))throw new DomainError('capacity_reached','De vereniging heeft geen vrije ledenplaatsen.',409);
  await client.query("update dartflow_private.platform_members set status='active',role='member' where entity_id=$1 and user_id=$2",[row.id,target]);await client.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'player')on conflict(club_id,user_id)do update set role='player'",[row.id,target]);
 }else if(a.type==='member.suspend'||a.type==='member.remove'){
  if(current.status!=='active'&&current.status!=='banned')throw new DomainError('invalid_status','Kies een huidig verenigingslid.',409);
  await client.query('update dartflow_private.platform_members set status=$3 where entity_id=$1 and user_id=$2',[row.id,target,a.type==='member.suspend'?'banned':'left']);await client.query('delete from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[row.id,target]);
 }else throw new DomainError('invalid_action','Onbekende ledenactie.');
 await client.query('delete from dartflow_private.club_member_roles where club_id=$1 and user_id=$2',[row.id,target]);
}
export async function getClubhouseChannel(actor:string,clubId:string,channelId:string,after=0,before=0){return transaction(async client=>{await access(client,actor,clubId);return readClubChannel(client,actor,clubId,channelId,after,before);});}
export async function executeClubhouseCommand(actor:string,command:ClubhouseCommand):Promise<ClubhouseView|{ok:true;branding:Awaited<ReturnType<typeof readClubBranding>>}>{
 if(!command||!command.action||typeof command.action.type!=='string')throw new DomainError('invalid_action','Ongeldige Clubhouse-actie.');const request=uuid(command.requestId),a=command.action,clubId=uuid(a.clubId),type=a.type;
 return transaction(async client=>{
  const admin=type.startsWith('entitlement.')&&await platformBrandingAdministrator(client,actor);
  const row=admin?await entity(client,clubId,true):await access(client,actor,clubId,undefined,true);
  if(row.kind!=='club')throw new DomainError('not_found','Deze vereniging bestaat niet.',404);
  await actionPermission(client,actor,row,type);
  if(type.startsWith('channel.')&&a.channelId)await channelAccess(client,actor,clubId,uuid(a.channelId));
  const digest=hash(canonical(command)),receipt=(await client.query('select club_id,payload_hash from dartflow_private.clubhouse_receipts where user_id=$1 and request_id=$2',[actor,request])).rows[0];
  if(receipt&&(receipt.club_id!==clubId||receipt.payload_hash!==digest))throw new DomainError('request_conflict','Dit aanvraagnummer is al voor een andere actie gebruikt.',409);
  if(!receipt){
   if(type==='report.resolve'){if(!(await client.query("select 1 from dartflow_private.platform_reports where id=$1 and scope_kind='club' and scope_id=$2",[uuid(a.reportId),clubId])).rowCount)throw new DomainError('not_found','Deze melding hoort niet bij deze vereniging.',404);await socialAction(client as PoolClient,actor,{requestId:request,action:{type:'report.resolve',reportId:uuid(a.reportId),reason:a.reason,operation:a.operation}});}
   else if(type.startsWith('channel.'))await clubChannelAction(client,actor,clubId,a,command.expectedRevision);
   else if(type.startsWith('member.'))await memberAction(client,actor,row,a);
   else if(type.startsWith('team.'))await teamAction(client,actor,clubId,a,command.expectedRevision);
   else if(type.startsWith('activity.'))await activityAction(client,actor,clubId,a,command.expectedRevision);
   else if(type.startsWith('task.'))await taskAction(client,actor,clubId,a,command.expectedRevision);
   else if(type.startsWith('ownership.'))await ownershipAction(client,actor,row,a);
   else if(type.startsWith('branding.')||type.startsWith('entitlement.'))await brandingAction(client,actor,clubId,a,command.expectedRevision);
   else throw new DomainError('invalid_action','Deze Clubhouse-actie bestaat niet.');
   if(type==='ownership.offer'){const offer=(await client.query("select id,recipient_id from dartflow_private.club_ownership_transfers where club_id=$1 and owner_id=$2 and status='pending' order by expires_at desc,id limit 1",[clubId,actor])).rows[0];if(offer)await enqueueAuditedNotification(client,{eventId:`ownership-offer:${offer.id}`,templateId:'club-ownership-offer',actorId:actor,recipientIds:[offer.recipient_id],source:{kind:'ownership-offer',transferId:offer.id},href:`/app/clubs/${clubId}`,status:'Je moet de aangeboden overdracht zelf aanvaarden voordat het eigenaarschap verandert.'});}
   if(type==='ownership.accept'){const offer=(await client.query('select owner_id from dartflow_private.club_ownership_transfers where id=$1',[uuid(a.transferId)])).rows[0];if(offer)await enqueueAuditedNotification(client,{eventId:`ownership-accepted:${request}`,templateId:'club-role',actorId:actor,recipientIds:[offer.owner_id],source:{kind:'club-member',clubId,playerId:offer.owner_id},href:`/app/clubs/${clubId}`,variables:{clubName:row.state.name,role:'Lid; eigendom overgedragen'},status:'De aangeboden eigendomsoverdracht is door de ontvanger aanvaard.'});}
   if(type.startsWith('member.')){const target=uuid(a.userId),status=(await client.query('select status from dartflow_private.platform_members where entity_id=$1 and user_id=$2',[clubId,target])).rows[0]?.status;if(status)await enqueueAuditedNotification(client,{eventId:`club-membership:${request}`,templateId:'club-membership-changed',actorId:actor,recipientIds:[target],source:{kind:'club-membership-status',clubId,playerId:target,status},href:'/app/clubs',status:status==='active'?'Je verenigingstoegang is hersteld.':status==='banned'?'Je verenigingstoegang is geschorst.':'Je verenigingslidmaatschap is beëindigd.'});}
   await client.query('insert into dartflow_private.clubhouse_receipts(user_id,request_id,club_id,payload_hash)values($1,$2,$3,$4)',[actor,request,clubId,digest]);
   await client.query('insert into dartflow_private.clubhouse_audit(id,club_id,actor_id,action,detail)values($1,$2,$3,$4,$5)',[randomUUID(),clubId,actor,type,JSON.stringify({requestId:request,resourceId:a.id??a.reportId??null,revision:command.expectedRevision??null,...(type.startsWith('branding.')||type.startsWith('entitlement.')?{branding:await readClubBranding(client,actor,clubId).then(b=>({revision:b.revision,publishedRevision:b.publishedRevision,entitlement:b.entitlement}))}:{})})]);
  }
  return admin?{ok:true,branding:await readClubBranding(client,actor,clubId)}:readView(client,actor,clubId,'overview');
 });
}
