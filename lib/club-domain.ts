import {randomUUID} from 'node:crypto';
import type {PoolClient,Pool} from 'pg';
import {DomainError} from './domain';
import {invitationCodeAccepted} from './invitations';
import {enqueueDomainMail} from './integrations-mail';
import {BASE_CLUB_ROLES,CLUB_PERMISSIONS,type ClubEntity,type ClubDetails,type ClubPermission,type IntakeQuestion} from './club-types';
import {clubPermission,clubIsActiveMember} from './club-access';
import {clubColor,clubGrants,clubText,intakeAnswers,intakeQuestions} from './club-validation';
import {safeClubLogo} from './club-branding';
import {addMember,available,blocked,createEntity,entity,member,number,save,uuid,type Client,type EntityRow} from './platform-store';
import type {PlatformCommand,PlatformMember,PlatformResponse} from './platform-types';

const active=(row:EntityRow)=>!['inactive','deleted'].includes(String(row.state.lifecycle));
async function requireGrant(client:Client,row:EntityRow,actor:string,grant:ClubPermission){if(!await clubPermission(client,row.id,actor,grant))throw new DomainError('forbidden','Je hebt hiervoor geen actueel verenigingsrecht.',403);}
async function requireOwner(client:Client,row:EntityRow,actor:string,allowInactive=false){if(row.owner_id!==actor||(await member(client,row.id,actor))?.status!=='active'||(!allowInactive&&!active(row))||row.state.lifecycle==='deleted')throw new DomainError('owner_required','Alleen de huidige verenigingseigenaar kan dit wijzigen.',403);}
async function intake(client:Client,row:EntityRow){const {rows}=await client.query('select version,introduction,questions from dartflow_private.club_intake_versions where club_id=$1 order by version desc limit 1',[row.id]);return rows[0] as {version:number;introduction:string;questions:IntakeQuestion[]};}
async function mail(client:PoolClient,id:string,templateId:string,row:EntityRow,recipientId:string,variables:Record<string,string>={}){return enqueueDomainMail(client,{id,templateId,scope:`club:${row.id}`,recipientId,entityId:row.id,variables:{clubName:row.state.name,actionUrl:`/app/clubs/${row.id}`,...variables}});}
async function makeActive(client:Client,row:EntityRow,user:string){await available(client,row);await addMember(client,row.id,user,'member','active');await client.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'player') on conflict(club_id,user_id) do update set role='player'",[row.id,user]);}
async function submitted(client:PoolClient,row:EntityRow,user:string,version:number,kind:'open'|'invite'|'intake',answers:unknown,status:'pending'|'approved'){
 const id=randomUUID();await client.query('insert into dartflow_private.club_join_requests(id,club_id,user_id,version,kind,answers,status,reviewed_at) values($1,$2,$3,$4,$5,$6,$7,case when $7=\'approved\' then now() else null end)',[id,row.id,user,version,kind,JSON.stringify(answers),status]);
 if(status==='approved')await mail(client,`club-decision:${id}`,'club-decision',row,user,{status:'Lidmaatschap bevestigd',reason:''});
 else{
  await mail(client,`club-request:${id}:received`,'club-request-received',row,user);
  const name=(await client.query('select name from dartflow_private.profile_labels where id=$1',[user])).rows[0]?.name||'Een speler';
  const members=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active'",[row.id]);
  for(const reviewer of members.rows)if(await clubPermission(client,row.id,reviewer.user_id,'members.approve'))await mail(client,`club-request:${id}:reviewers`,'club-request',row,reviewer.user_id,{actorName:name});
 }
 return id;
}
export async function clubView(client:Client,row:EntityRow,actor:string,_cachedMembers?:PlatformMember[]):Promise<ClubEntity>{
 void _cachedMembers; // Compatibility parameter; authorization always re-reads canonical members.
 const pool=client as Client & Partial<Pick<Pool,'connect'>>;
 if(!('release' in client)&&typeof pool.connect==='function'){
  const connection=await pool.connect();try{await connection.query('begin');const result=await clubView(connection,row,actor);await connection.query('commit');return result;}catch(error){await connection.query('rollback');throw error;}finally{connection.release();}
 }
 const fresh=await client.query<EntityRow>("select e.*,(select i.code from dartflow_private.invitation_codes i where i.entity_id=e.id and i.expires_at>now() order by i.created_at desc,i.code limit 1) as invitation_code from dartflow_private.platform_entities e where e.id=$1 and e.kind='club' for share of e",[row.id]);if(!fresh.rows.length)throw new DomainError('not_found','Deze vereniging bestaat niet.',404);
 return clubViewLocked(client,fresh.rows[0],actor);
}
async function clubViewLocked(client:Client,row:EntityRow,actor:string):Promise<ClubEntity>{
 const members=(await client.query<PlatformMember>('select m.user_id as id,p.name,m.role,m.status,m.attributes from dartflow_private.platform_members m join dartflow_private.profile_labels p on p.id=m.user_id where m.entity_id=$1 order by m.created_at,m.user_id',[row.id])).rows;
 const self=members.find(m=>m.id===actor),isMember=await clubIsActiveMember(client,row.id,actor),isOwner=row.owner_id===actor&&self?.status==='active';
 if(self?.status==='banned'||await blocked(client,actor,row.owner_id)||(row.visibility!=='public'&&row.owner_id!==actor&&!['active','invited','pending','waitlisted'].includes(self?.status??''))||(!active(row)&&row.owner_id!==actor))throw new DomainError('forbidden','Je hebt geen actuele toegang tot deze vereniging.',403);
 if(row.state.lifecycle==='deleted')throw new DomainError('not_found','Deze vereniging is niet meer beschikbaar.',404);
 const permissions:ClubPermission[]=[];for(const grant of CLUB_PERMISSIONS)if(await clubPermission(client,row.id,actor,grant))permissions.push(grant);
 const canApprove=permissions.includes('members.approve'),canEditSettings=permissions.includes('settings.edit'),form=await intake(client,row);
 const roles=(await client.query('select id,name,permissions from dartflow_private.club_roles where club_id=$1 order by name,id',[row.id])).rows;
 const assignments=(await client.query('select user_id,role_id from dartflow_private.club_member_roles where club_id=$1',[row.id])).rows;
 const requests=(await client.query(`select r.id,r.user_id as "userId",p.name,r.status,r.version,r.answers,r.created_at as "createdAt",r.reviewed_at as "reviewedAt",r.reviewed_by as "reviewedBy",r.reason from dartflow_private.club_join_requests r join dartflow_private.profile_labels p on p.id=r.user_id where r.club_id=$1 and ($3::boolean or r.user_id=$2) order by r.created_at desc,r.id limit 100`,[row.id,actor,canApprove])).rows;
 const invites=(await client.query(`select i.id,i.user_id as "userId",p.name,case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end as status,i.expires_at as "expiresAt" from dartflow_private.club_invites i join dartflow_private.profile_labels p on p.id=i.user_id where i.club_id=$1 and ($3::boolean or i.user_id=$2) order by i.created_at desc,i.id limit 100`,[row.id,actor,permissions.includes('members.invite')])).rows;
 const state=structuredClone(row.state);delete state.intakeAnswers;delete state.requests;delete state.invites;delete state.roles;
 const details:ClubDetails={joinPolicy:['closed','invite','open','intake'].includes(String(state.joinPolicy))?state.joinPolicy as ClubDetails['joinPolicy']:'intake',intakeVersion:form?.version??1,intakeIntroduction:form?.introduction??'',intakeQuestions:form?.questions??[],roles:[...BASE_CLUB_ROLES,...roles],requests,invites,lifecycle:(state.lifecycle as ClubDetails['lifecycle'])||'active',canRestore:state.lifecycle==='inactive'&&Date.parse(String(state.deleteAfter))>Date.now(),inactiveAt:typeof state.inactiveAt==='string'?state.inactiveAt:null,deleteAfter:typeof state.deleteAfter==='string'?state.deleteAfter:null,primaryColor:typeof state.primaryColor==='string'?state.primaryColor:'#b7f62b',secondaryColor:typeof state.secondaryColor==='string'?state.secondaryColor:'#7392e8',logoData:typeof state.logoData==='string'?state.logoData:null};
 const visible=members.filter(m=>isMember?(canApprove||m.status==='active'||m.id===actor):m.id===actor).map(m=>({...m,attributes:{clubRoleIds:assignments.filter(a=>a.user_id===m.id).map(a=>a.role_id)}}));
 return {id:row.id,kind:'club',name:state.name,ownerId:row.owner_id,clubId:row.club_id,visibility:row.visibility,revision:row.revision,state,members:visible,canManage:canEditSettings,clubAccess:{isOwner:Boolean(isOwner),isMember,permissions,canApprove,canInvite:permissions.includes('members.invite'),canEditSettings,canManageRoles:Boolean(isOwner&&active(row))},clubDetails:details,...(isMember&&active(row)&&typeof row.invitation_code==='string'&&/^[A-Z0-9]{4}$/.test(row.invitation_code)&&invitationCodeAccepted(row,row.invitation_code)?{inviteCode:row.invitation_code}:{})};
}
export async function clubAction(client:PoolClient,actor:string,command:PlatformCommand):Promise<PlatformResponse>{
 const a=command.action,type=a.type;
 if(type==='club.create'){
  const id=randomUUID(),name=clubText(a.name,80,true);await client.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[id,name]);await client.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'organizer')",[id,actor]);
  const {row,code}=await createEntity(client,actor,'club',{name,description:a.description?clubText(a.description,2000):'',capacity:number(a.capacity,64,2,1000),joinPolicy:'intake',lifecycle:'active',news:[]},'public',null,id);await client.query('insert into dartflow_private.club_intake_versions(club_id,version) values($1,1)',[id]);return {ok:true,id,code,entity:await clubView(client,row,actor)};
 }
 const row=await entity(client,a.id,true);if(row.kind!=='club')throw new DomainError('invalid_kind','Deze actie hoort bij een vereniging.');
 const decision=['club.approve','club.reject'].includes(type);
 if(!decision&&command.expectedRevision!==undefined&&command.expectedRevision!==row.revision)throw new DomainError('revision_conflict','De vereniging is gewijzigd. Vernieuw de pagina.',409);
 if(!active(row)&&!['club.restore','club.remove'].includes(type))throw new DomainError('club_inactive','Deze vereniging is niet actief.',409);
 const self=await member(client,row.id,actor);
 if(type==='club.settings'){
  await requireGrant(client,row,actor,'settings.edit');
  if(a.name!==undefined){row.state.name=clubText(a.name,80,true);await client.query('update dartflow_private.clubs set name=$2 where id=$1',[row.id,row.state.name]);}
  if(a.description!==undefined)row.state.description=clubText(a.description,2000);
  if(a.capacity!==undefined){const capacity=number(a.capacity,64,2,1000),count=(await client.query("select count(*)::int n from dartflow_private.platform_members where entity_id=$1 and status='active'",[row.id])).rows[0].n;if(capacity<count)throw new DomainError('capacity_below_members','De capaciteit ligt onder het huidige ledental.',409);row.state.capacity=capacity;}
  if(a.joinPolicy!==undefined){if(!['open','invite','closed','intake'].includes(String(a.joinPolicy)))throw new DomainError('join_policy','Kies een geldig aanmeldbeleid.');row.state.joinPolicy=a.joinPolicy;}
  if(a.intakeQuestions!==undefined||a.intakeIntroduction!==undefined){const previous=await intake(client,row),questions=a.intakeQuestions===undefined?previous.questions:intakeQuestions(a.intakeQuestions),intro=a.intakeIntroduction===undefined?previous.introduction:clubText(a.intakeIntroduction,2000);if(JSON.stringify(questions)!==JSON.stringify(previous.questions)||intro!==previous.introduction)await client.query('insert into dartflow_private.club_intake_versions(club_id,version,introduction,questions) values($1,$2,$3,$4)',[row.id,previous.version+1,intro,JSON.stringify(questions)]);}
  if(a.primaryColor!==undefined)row.state.primaryColor=clubColor(a.primaryColor);if(a.secondaryColor!==undefined)row.state.secondaryColor=clubColor(a.secondaryColor);if(a.logoData!==undefined)row.state.logoData=await safeClubLogo(a.logoData);
 }else if(type==='club.request'){
  if(await clubIsActiveMember(client,row.id,actor))return {ok:true,id:row.id,entity:await clubView(client,row,actor)};
  if(self?.status==='banned')throw new DomainError('forbidden','Je kunt geen lidmaatschap aanvragen.',403);
  const pending=(await client.query("select id from dartflow_private.club_join_requests where club_id=$1 and user_id=$2 and status='pending'",[row.id,actor])).rows[0];if(pending)return {ok:true,id:row.id,requestId:pending.id,entity:await clubView(client,row,actor)};
  const policy=String(row.state.joinPolicy||'intake');if(policy==='closed')throw new DomainError('club_closed','Deze vereniging accepteert geen nieuwe leden.',403);if(policy==='invite')throw new DomainError('invite_required','Je hebt een persoonlijke uitnodiging nodig.',403);
  const form=await intake(client,row);if(policy==='intake'&&(a.intakeVersion!==undefined||form.questions.length)&&a.intakeVersion!==form.version)throw new DomainError('intake_changed','Het formulier is gewijzigd. Vernieuw de aanvraag.',409);
  const answers=policy==='intake'?intakeAnswers(form.questions,a.answers??{}):[];
  if(policy==='open')await makeActive(client,row,actor);else await addMember(client,row.id,actor,'member','pending');
  const requestId=await submitted(client,row,actor,form.version,policy==='open'?'open':'intake',answers,policy==='open'?'approved':'pending');await save(client,row);return {ok:true,id:row.id,requestId,entity:await clubView(client,row,actor)};
 }else if(decision){
  await requireGrant(client,row,actor,'members.approve');
  const requests=await client.query(`select * from dartflow_private.club_join_requests where club_id=$1 and ${a.requestId?'id=$2':"user_id=$2"} order by created_at desc,id limit 1 for update`,[row.id,a.requestId?uuid(a.requestId):uuid(a.userId)]),request=requests.rows[0];
  if(!request)throw new DomainError('request_missing','Deze aanvraag bestaat niet.',404);
  if(request.status!=='pending')return {ok:true,id:row.id,decision:request.status,alreadyProcessed:true,entity:await clubView(client,row,actor)};
  if((await member(client,row.id,request.user_id))?.status==='banned')throw new DomainError('forbidden','Deze speler kan niet worden toegelaten.',403);
  if(await clubIsActiveMember(client,row.id,request.user_id))throw new DomainError('already_member','Deze speler is al lid.',409);
  const approved=type==='club.approve',reason=a.reason===undefined?'':clubText(a.reason,1000);
  if(approved)await makeActive(client,row,request.user_id);else await addMember(client,row.id,request.user_id,'member','left');
  await client.query('update dartflow_private.club_join_requests set status=$2,reviewed_by=$3,reviewed_at=now(),reason=$4 where id=$1',[request.id,approved?'approved':'rejected',actor,reason||null]);await mail(client,`club-decision:${request.id}`,'club-decision',row,request.user_id,{status:approved?'Goedgekeurd':'Afgewezen',reason});
 }else if(type==='club.invite'){
  await requireGrant(client,row,actor,'members.invite');if(row.state.joinPolicy==='closed')throw new DomainError('club_closed','Deze vereniging accepteert geen nieuwe leden.',403);const target=uuid(a.userId);if(target===actor||await blocked(client,actor,target)||!(await client.query('select 1 from dartflow_private.profiles where id=$1',[target])).rowCount)throw new DomainError('invite_target','Kies een bestaande speler die je kunt uitnodigen.');
  if(await clubIsActiveMember(client,row.id,target))return {ok:true,id:row.id,entity:await clubView(client,row,actor)};
  if((await member(client,row.id,target))?.status==='banned')throw new DomainError('forbidden','Deze speler kan niet worden uitgenodigd.',403);
  await client.query("update dartflow_private.club_invites set status='expired',decided_at=now() where club_id=$1 and user_id=$2 and status='pending' and expires_at<=now()",[row.id,target]);
  const existing=(await client.query("select id from dartflow_private.club_invites where club_id=$1 and user_id=$2 and status='pending'",[row.id,target])).rows[0];
  if(!existing){const inviteId=randomUUID();await client.query('insert into dartflow_private.club_invites(id,club_id,user_id,invited_by) values($1,$2,$3,$4)',[inviteId,row.id,target,actor]);await addMember(client,row.id,target,'member','invited');const name=(await client.query('select name from dartflow_private.profile_labels where id=$1',[actor])).rows[0].name;await mail(client,`club-invite:${inviteId}`,'club-invite',row,target,{actorName:name});}
 }else if(type==='club.invite.accept'||type==='club.invite.reject'){
  const invite=(await client.query('select * from dartflow_private.club_invites where id=$1 and club_id=$2 and user_id=$3 for update',[uuid(a.inviteId),row.id,actor])).rows[0];if(!invite)throw new DomainError('not_found','Deze uitnodiging is niet voor jou.',404);
  if(invite.status!=='pending')return {ok:true,id:row.id,entity:await clubView(client,row,actor)};
  if(new Date(invite.expires_at).getTime()<=Date.now())throw new DomainError('invite_expired','Deze uitnodiging is verlopen.',409);
  if(self?.status==='banned')throw new DomainError('forbidden','Je kunt deze uitnodiging niet gebruiken.',403);
  const accept=type==='club.invite.accept';if(accept&&row.state.joinPolicy==='closed')throw new DomainError('club_closed','Deze vereniging accepteert geen nieuwe leden.',403);if(accept&&!await clubIsActiveMember(client,row.id,actor)){await makeActive(client,row,actor);const pending=(await client.query("select id from dartflow_private.club_join_requests where club_id=$1 and user_id=$2 and status='pending'",[row.id,actor])).rows[0];if(pending){await client.query("update dartflow_private.club_join_requests set status='approved',reviewed_at=now(),reviewed_by=$2 where id=$1",[pending.id,actor]);await mail(client,`club-decision:${pending.id}`,'club-decision',row,actor,{status:'Uitnodiging geaccepteerd',reason:''});}else await submitted(client,row,actor,(await intake(client,row)).version,'invite',[],'approved');}else if(!accept&&self?.status==='invited')await addMember(client,row.id,actor,'member','left');
  await client.query('update dartflow_private.club_invites set status=$2,decided_at=now() where id=$1',[invite.id,accept?'accepted':'declined']);
 }else if(type==='club.role.save'){
  await requireOwner(client,row,actor);const id=a.roleId?uuid(a.roleId):randomUUID(),name=clubText(a.name,64,true),permissions=clubGrants(a.permissions);if(a.roleId&&!(await client.query('select 1 from dartflow_private.club_roles where club_id=$1 and id=$2',[row.id,id])).rowCount)throw new DomainError('role_missing','Deze rol hoort niet bij deze vereniging.',404);
  await client.query('insert into dartflow_private.club_roles(club_id,id,name,permissions) values($1,$2,$3,$4) on conflict(club_id,id) do update set name=excluded.name,permissions=excluded.permissions',[row.id,id,name,permissions]);
 }else if(type==='club.role.delete'){
  await requireOwner(client,row,actor);if(!(await client.query('delete from dartflow_private.club_roles where club_id=$1 and id=$2 returning id',[row.id,uuid(a.roleId)])).rowCount)throw new DomainError('role_missing','Deze rol hoort niet bij deze vereniging.',404);
 }else if(type==='club.transfer'||type==='club.role'&&a.role==='owner'){
  await requireOwner(client,row,actor);const target=uuid(a.userId);if(target===actor||!await clubIsActiveMember(client,row.id,target))throw new DomainError('invalid_owner','Kies een ander actief verenigingslid.');
  await client.query("update dartflow_private.platform_members set role='member' where entity_id=$1 and user_id=$2",[row.id,actor]);await client.query('delete from dartflow_private.club_member_roles where club_id=$1 and user_id=$2',[row.id,actor]);await client.query("update dartflow_private.platform_members set role='owner' where entity_id=$1 and user_id=$2",[row.id,target]);await client.query("update dartflow_private.club_memberships set role=case when user_id=$2 then 'organizer' else 'player' end where club_id=$1 and user_id=any($3::uuid[])",[row.id,target,[actor,target]]);row.owner_id=target;
  await mail(client,`club-transfer:${command.requestId}`,'club-role',row,target,{role:'Eigenaar'});
 }else if(type==='club.role'||type==='club.member.roles'){
  await requireOwner(client,row,actor);const target=uuid(a.userId),role=String(a.role??'member');if(target===row.owner_id||!await clubIsActiveMember(client,row.id,target)||!['admin','captain','member'].includes(role))throw new DomainError('invalid_role','Kies een actief lid en een geldige rol.');
  const roleIds=a.roleIds??[];if(!Array.isArray(roleIds)||roleIds.length>20||new Set(roleIds).size!==roleIds.length)throw new DomainError('invalid_role','Kies geldige verenigingsrollen.');const ids=roleIds.map(uuid);if(ids.length&&(await client.query('select id from dartflow_private.club_roles where club_id=$1 and id=any($2::uuid[])',[row.id,ids])).rowCount!==ids.length)throw new DomainError('invalid_role','Deze rol hoort niet bij deze vereniging.');
  await client.query('delete from dartflow_private.club_member_roles where club_id=$1 and user_id=$2',[row.id,target]);for(const id of ids)await client.query('insert into dartflow_private.club_member_roles(club_id,user_id,role_id) values($1,$2,$3)',[row.id,target,id]);await client.query('update dartflow_private.platform_members set role=$3 where entity_id=$1 and user_id=$2',[row.id,target,role]);await client.query('update dartflow_private.club_memberships set role=$3 where club_id=$1 and user_id=$2',[row.id,target,role==='admin'?'organizer':'player']);await mail(client,`club-role:${command.requestId}`,'club-role',row,target,{role});
 }else if(type==='club.deactivate'||type==='club.restore'||type==='club.remove'){
  await requireOwner(client,row,actor,true);
  if(type==='club.deactivate'){if(!active(row))throw new DomainError('club_inactive','Deze vereniging is al inactief.',409);const now=new Date();row.state.lifecycle='inactive';row.state.inactiveAt=now.toISOString();row.state.deleteAfter=new Date(now.getTime()+30*86400000).toISOString();}
  else if(type==='club.restore'){if(row.state.lifecycle!=='inactive'||!Number.isFinite(Date.parse(String(row.state.deleteAfter)))||Date.parse(String(row.state.deleteAfter))<=Date.now())throw new DomainError('restore_expired','Herstel is alleen mogelijk binnen de bewaartermijn van dertig dagen.',409);row.state.lifecycle='active';row.state.inactiveAt=null;row.state.deleteAfter=null;}
  else{if(row.state.lifecycle!=='inactive'||!Number.isFinite(Date.parse(String(row.state.deleteAfter)))||Date.parse(String(row.state.deleteAfter))>Date.now())throw new DomainError('retention_period','Verwijderen kan na dertig dagen inactiviteit.',409);row.state.lifecycle='deleted';row.state.deletedAt=new Date().toISOString();row.state.description='';row.state.logoData=null;}
 }else if(type==='club.news'){
  await requireGrant(client,row,actor,'settings.edit');const news=Array.isArray(row.state.news)?row.state.news:[];row.state.news=[{id:randomUUID(),title:clubText(a.title,120,true),body:clubText(a.body,4000,true),authorId:actor,createdAt:new Date().toISOString()},...news].slice(0,100);
 }else if(type==='club.leave'){
  if(!await clubIsActiveMember(client,row.id,actor))throw new DomainError('forbidden','Je bent geen actief lid.',403);if(row.owner_id===actor)throw new DomainError('owner_transfer_required','Draag het eigendom eerst over.');
  if((await client.query("select 1 from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id where m.club_id=$1 and p.user_id=$2 and m.state->>'status' not in ('confirmed','planned')",[row.id,actor])).rowCount)throw new DomainError('active_match','Rond eerst je actieve wedstrijd af.',409);
  await client.query('delete from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[row.id,actor]);await client.query("update dartflow_private.platform_members set status='left' where user_id=$1 and entity_id in (select id from dartflow_private.platform_entities where club_id=$2 or id=$2)",[actor,row.id]);
 }else throw new DomainError('invalid_action','Onbekende verenigingsactie.');
 await save(client,row);if(row.state.lifecycle==='deleted')return {ok:true,id:row.id};return {ok:true,id:row.id,entity:await clubView(client,row,actor)};
}

/** Receipt replay must never restore permissions or return an old reviewer projection. */
export async function revalidateClubCommand(client:Client,actor:string,command:PlatformCommand,response:PlatformResponse):Promise<void>{
 const type=command.action.type;if(!type.startsWith('club.'))return;
 const id=response.entity?.id??response.id??command.action.id;if(typeof id!=='string')return;const row=await entity(client,id);
 if(type==='club.remove'&&row.state.lifecycle==='deleted'&&row.owner_id===actor){delete response.entity;return;}
 if(type.startsWith('club.role')||type==='club.member.roles'||type==='club.transfer')await requireOwner(client,row,actor);
 else if(['club.deactivate','club.restore','club.remove'].includes(type))await requireOwner(client,row,actor,true);
 else if(type==='club.settings'||type==='club.news')await requireGrant(client,row,actor,'settings.edit');
 else if(type==='club.approve'||type==='club.reject')await requireGrant(client,row,actor,'members.approve');
 else if(type==='club.invite')await requireGrant(client,row,actor,'members.invite');
 response.entity=await clubView(client,row,actor);
}
