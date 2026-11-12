import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError } from './domain';
import {saveScoreboardName} from './profile-name';
import { enqueueDomainMail } from './integrations-mail';
import {clubAction} from './club-domain';
import { acceptsCode, addMember, available, blocked, createEntity, entity, isClubMember, member, number, requireAccess, save, text, uuid, view } from './platform-store';
import type { PlatformCommand, PlatformResponse } from './platform-types';

type Action = PlatformCommand['action'];
async function notify(client: PoolClient, requestId: string, templateId: string, recipientId: string, variables: Record<string, string>, clubId?: string | null, entityId?: string) {
  await enqueueDomainMail(client, { id: `platform:${requestId}:${templateId}:${recipientId}`, templateId, scope: clubId ? `club:${clubId}` : 'platform', recipientId, variables, entityId });
}
export async function socialAction(client: PoolClient, actor: string, command: PlatformCommand): Promise<PlatformResponse | null> {
  const a = command.action, type = a.type;
  if(type==='profile.update'){
    if(a.showPublicStatistics!==undefined&&typeof a.showPublicStatistics!=='boolean')throw new DomainError('invalid_preferences','Gebruik een geldige keuze voor openbare statistieken.');
    await saveScoreboardName(client,actor,a.username??a.name,a.displayName);
    if(typeof a.showPublicStatistics==='boolean')await client.query('update dartflow_private.profiles set show_public_statistics=$2 where id=$1',[actor,a.showPublicStatistics]);
    return {ok:true};
  }
  if (type === 'preferences.update') {
    if ((a.discoverable !== undefined && typeof a.discoverable !== 'boolean') || (a.allowRequests !== undefined && typeof a.allowRequests !== 'boolean')) throw new DomainError('invalid_preferences', 'Gebruik geldige privacyinstellingen.');
    await client.query('insert into dartflow_private.platform_preferences(user_id,discoverable,allow_requests) values($1,coalesce($2,true),coalesce($3,true)) on conflict(user_id) do update set discoverable=coalesce($2,dartflow_private.platform_preferences.discoverable),allow_requests=coalesce($3,dartflow_private.platform_preferences.allow_requests)', [actor, a.discoverable, a.allowRequests]);
    return { ok: true };
  }
  if (type.startsWith('friend.')) return friendAction(client, actor, command);
  if(type==='registration.request') {
    const existing=await client.query('select status from dartflow_private.platform_registrations where user_id=$1 for update',[actor]);
    if(existing.rows[0]?.status==='approved')return {ok:true};
    await client.query("insert into dartflow_private.platform_registrations(user_id,status) values($1,'pending') on conflict(user_id) do update set status='pending',reason=null,reviewed_by=null,updated_at=now()",[actor]);
    await notify(client,command.requestId,'registration-received',actor,{status:'In behandeling'});
    return {ok:true};
  }
  if(type==='registration.review') {
    if(!(await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')",[actor])).rowCount)throw new DomainError('forbidden','Alleen platformbeheer kan spelersaanvragen beoordelen.',403);
    if(typeof a.approved!=='boolean')throw new DomainError('invalid_decision','Kies goedkeuren of afwijzen.');
    const user=uuid(a.userId),status=a.approved===true?'approved':'rejected',reason=text(a.reason,1000);
    const result=await client.query("update dartflow_private.platform_registrations set status=$2,reason=$3,reviewed_by=$4,updated_at=now() where user_id=$1 and status='pending' returning user_id",[user,status,reason,actor]);
    if(!result.rowCount)throw new DomainError('request_missing','Deze spelersaanvraag staat niet meer open.',409);
    await notify(client,command.requestId,'registration-decision',user,{status:status==='approved'?'Goedgekeurd':'Afgewezen',reason});return {ok:true};
  }
  if(type==='report.resolve') {
    const report=await client.query('select * from dartflow_private.platform_reports where id=$1 for update',[uuid(a.reportId)]);
    if(!report.rows.length)throw new DomainError('not_found','Deze melding bestaat niet.',404);
    const item=report.rows[0],platform=(await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')",[actor])).rowCount;
    if(!platform) {if(!item.room_id)throw new DomainError('forbidden','Alleen bevoegd platformbeheer kan deze melding behandelen.',403);await requireAccess(client,await entity(client,item.room_id),actor,true);}
    if(item.status==='resolved')throw new DomainError('report_resolved','Deze melding is al behandeld.',409);
    const reason=text(a.reason,2000);await client.query("update dartflow_private.platform_reports set status='resolved',decision=$2,reviewed_by=$3 where id=$1",[item.id,reason,actor]);
    if(item.target_id)await notify(client,command.requestId,'moderation-notice',item.target_id,{roomName:item.room_id?(await entity(client,item.room_id)).state.name:'DartFlow',reason,status:'Beoordeeld'});return {ok:true};
  }
  if (type === 'report.create') {
    const target = a.userId ? uuid(a.userId) : null;
    if (a.roomId) await requireAccess(client, await entity(client, a.roomId), actor);
    const id = randomUUID();
    await client.query('insert into dartflow_private.platform_reports(id,reporter_id,target_id,room_id,reason) values($1,$2,$3,$4,$5)', [id, actor, target, a.roomId ? uuid(a.roomId) : null, text(a.reason, 2000)]);
    const reviewers=a.roomId?await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active' and role in ('owner','admin','moderator')",[a.roomId]):await client.query("select user_id from dartflow_private.platform_roles where role in ('owner','admin')");
    const reporter=(await client.query('select name from dartflow_private.profile_labels where id=$1',[actor])).rows[0]?.name||'Speler';
    for(const reviewer of reviewers.rows)if(reviewer.user_id!==actor&&reviewer.user_id!==target)await notify(client,command.requestId,'moderation-report',reviewer.user_id,{roomName:a.roomId?(await entity(client,a.roomId)).state.name:'DartFlow',actorName:reporter,reason:text(a.reason,2000)});
    return { ok: true, id };
  }
  if(type.startsWith('club.'))return clubAction(client,actor,command);
  if(!type.startsWith('room.'))return null;
  if (type === 'room.create') {
    const visibility = a.visibility ?? 'public';
    if (!['public', 'private', 'club'].includes(String(visibility))) throw new DomainError('invalid_visibility', 'Kies openbaar, besloten of club.');
    const clubId = a.clubId ? uuid(a.clubId) : null;
    if (visibility === 'club' && !clubId) throw new DomainError('club_required', 'Kies een club.');
    if (clubId && !(await isClubMember(client, clubId, actor, true))) throw new DomainError('forbidden', 'Alleen de clubbeheerder kan een clubkamer maken.', 403);
    const { row, code } = await createEntity(client, actor, 'room', { name: text(a.name), description: a.description ? text(a.description, 2000) : '', capacity: number(a.capacity, 16, 2, 64), slowMode: number(a.slowMode, 0, 0, 3600) }, String(visibility), clubId);
    return { ok: true, id: row.id, code, entity: await view(client, row, actor) };
  }
  const row = await entity(client, a.id, true);
  if (row.kind !== 'room') throw new DomainError('invalid_kind', 'Deze actie hoort bij een ander onderdeel.');
  if (command.expectedRevision !== undefined && command.expectedRevision !== row.revision) throw new DomainError('revision_conflict', 'Dit onderdeel is gewijzigd. Vernieuw en probeer opnieuw.', 409);
  const self = await member(client, row.id, actor);
  if(type==='room.settings'){
    await requireAccess(client,row,actor,true);
    if(a.name!==undefined)row.state.name=text(a.name,80);
    if(a.description!==undefined)row.state.description=text(a.description,2000,false);
    if(a.capacity!==undefined){const capacity=number(a.capacity,64,2,64),active=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active'",[row.id]);if(capacity<active.rows[0].n)throw new DomainError('capacity_below_members','De capaciteit kan niet lager zijn dan het aantal actieve leden.',409);row.state.capacity=capacity;}
    if(row.kind==='room'&&a.slowMode!==undefined)row.state.slowMode=number(a.slowMode,0,0,3600);
  } else if (type === 'room.join') {
    if(typeof row.state.competitionId==='string'){const competition=await entity(client,row.state.competitionId),entry=await member(client,competition.id,actor);await requireAccess(client,competition,actor,entry?.attributes.registered!==true);}
    if (row.state.closed || self?.status === 'banned') throw new DomainError('room_unavailable', 'Deze kamer is gesloten of je bent verbannen.', 403);
    if (row.club_id && !(await isClubMember(client, row.club_id, actor))) throw new DomainError('forbidden', 'Word eerst lid van deze club.', 403);
    if (await blocked(client, actor, row.owner_id)) throw new DomainError('blocked', 'Deze kamer is niet beschikbaar.', 403);
    if (row.visibility === 'private' && self?.status !== 'invited' && self?.status !== 'active' && !acceptsCode(row, a.code)) throw new DomainError('invite_required', 'Gebruik een geldige uitnodiging.', 403);
    if (self?.status !== 'active') { await available(client, row); await addMember(client, row.id, actor); }
  } else if (type === 'room.invite') {
    await requireAccess(client, row, actor);
    const user = uuid(a.userId);
    if (await blocked(client, actor, user) || await blocked(client, row.owner_id, user)) throw new DomainError('blocked', 'Deze uitnodiging is niet toegestaan.', 403);
    if (row.club_id && !(await isClubMember(client, row.club_id, user))) throw new DomainError('forbidden', 'Deze speler is geen clublid.', 403);
    if(typeof row.state.competitionId==='string'){const competition=await entity(client,row.state.competitionId),entry=await member(client,competition.id,user);await requireAccess(client,competition,user,entry?.attributes.registered!==true);}
    const target = await member(client, row.id, user);
    if (target?.status === 'banned') throw new DomainError('room_banned', 'Deze speler is verbannen.', 403);
    if (target?.status !== 'active') await addMember(client, row.id, user, 'member', 'invited');
    await notify(client, command.requestId, 'room-invite', user, { roomName: row.state.name, actionUrl: `/app#community/${row.id}` }, row.club_id??(typeof row.state.organizerClubId==='string'?row.state.organizerClubId:null), row.id);
  } else if (type === 'room.leave') {
    await requireAccess(client, row, actor);
    await client.query("update dartflow_private.platform_members set status='left' where entity_id=$1 and user_id=$2", [row.id, actor]);
    if (row.owner_id === actor) {
      const next = await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active' and user_id<>$2 order by case when role='moderator' then 0 else 1 end,created_at,user_id limit 1", [row.id, actor]);
      if (next.rows.length) { row.owner_id = next.rows[0].user_id; await client.query("update dartflow_private.platform_members set role='owner' where entity_id=$1 and user_id=$2", [row.id, row.owner_id]); }
      else row.state.closed = true;
    }
  } else if (type === 'room.moderate') {
    await requireAccess(client, row, actor, true);
    const op = String(a.operation), user = a.userId ? uuid(a.userId) : null;
    if (op === 'slow-mode') row.state.slowMode = number(a.seconds, 0, 0, 3600);
    else if (op === 'delete-message') {
      const result = await client.query('update dartflow_private.platform_messages set deleted=true where id=$1 and room_id=$2 returning id', [uuid(a.messageId), row.id]);
      if (!result.rowCount) throw new DomainError('not_found', 'Dit bericht staat niet in deze kamer.', 404);
    } else {
      if (!user || user === row.owner_id || user === actor) throw new DomainError('invalid_member', 'Kies een ander kamerlid.');
      const target = await member(client, row.id, user);
      if (!target) throw new DomainError('not_found', 'Dit kamerlid bestaat niet.', 404);
      if (self?.role === 'moderator' && target.role !== 'member') throw new DomainError('forbidden', 'Een moderator kan alleen gewone leden modereren.', 403);
      if (op === 'role') {
        if (row.owner_id !== actor || !['member', 'moderator'].includes(String(a.role))) throw new DomainError('forbidden', 'Alleen de host kan moderatorrechten wijzigen.', 403);
        await client.query('update dartflow_private.platform_members set role=$3 where entity_id=$1 and user_id=$2', [row.id, user, a.role]);
      } else if (['ban', 'unban', 'remove'].includes(op)) await client.query('update dartflow_private.platform_members set status=$3 where entity_id=$1 and user_id=$2', [row.id, user, op === 'ban' ? 'banned' : 'left']);
      else if (op === 'mute' || op === 'unmute') await client.query("update dartflow_private.platform_members set attributes=jsonb_set(attributes,'{mutedUntil}',to_jsonb($3::text)) where entity_id=$1 and user_id=$2", [row.id, user, op === 'mute' ? new Date(Date.now() + number(a.seconds, 600, 1, 86400) * 1000).toISOString() : '1970-01-01T00:00:00Z']);
      else throw new DomainError('invalid_operation', 'Onbekende moderatieactie.');
      if(['ban','mute','remove','unban','unmute'].includes(op))await notify(client,command.requestId,'moderation-notice',user,{roomName:row.state.name,reason:typeof a.reason==='string'?text(a.reason,1000):op,status:op},row.club_id,row.id);
    }
  } else if (type === 'room.message') {
    const self = await requireAccess(client, row, actor);
    if (row.state.closed || new Date(String(self?.attributes.mutedUntil ?? '')).getTime() > Date.now()) throw new DomainError('muted', 'Je kunt nu geen bericht plaatsen.', 403);
    const slow = Number(row.state.slowMode ?? 0);
    if (slow > 0) {
      const recent = await client.query("select 1 from dartflow_private.platform_messages where room_id=$1 and author_id=$2 and created_at>now()-$3*interval '1 second' limit 1", [row.id, actor, slow]);
      if (recent.rowCount) throw new DomainError('slow_mode', `Wacht ${slow} seconden tussen berichten.`, 429);
    }
    await client.query('insert into dartflow_private.platform_messages(id,room_id,author_id,body) values($1,$2,$3,$4)', [randomUUID(), row.id, actor, text(a.body, 2000)]);
  } else throw new DomainError('invalid_action', 'Onbekende club- of kameractie.');
  await save(client, row);
  return { ok: true, id: row.id, entity: await view(client, row, actor) };
}
async function friendAction(client: PoolClient, actor: string, command: PlatformCommand): Promise<PlatformResponse> {
  const a: Action = command.action, user = uuid(a.userId);
  if (user === actor) throw new DomainError('invalid_player', 'Kies een andere speler.');
  const [first, second] = [actor, user].sort();
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`friend:${first}:${second}`]);
  if (!(await client.query('select 1 from dartflow_private.profiles where id=$1', [user])).rowCount) throw new DomainError('not_found', 'Deze speler bestaat niet.', 404);
  if (a.type === 'friend.block') {
    await client.query("delete from dartflow_private.platform_relationships where ((source_id=$1 and target_id=$2) or (source_id=$2 and target_id=$1)) and kind<>'block'", [actor, user]);
    await client.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind) values($1,$2,'block') on conflict do nothing", [actor, user]);
    return { ok: true };
  }
  if (a.type === 'friend.unblock') { await client.query("delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='block'", [actor, user]); return { ok: true }; }
  if (await blocked(client, actor, user)) throw new DomainError('blocked', 'Deze actie is niet toegestaan.', 403);
  if (a.type === 'friend.request') {
    const privacy = await client.query('select allow_requests from dartflow_private.platform_preferences where user_id=$1', [user]);
    if (privacy.rows[0]?.allow_requests === false) throw new DomainError('privacy_restricted', 'Deze speler ontvangt geen vriendschapsverzoeken.', 403);
    const friend = await client.query("select 1 from dartflow_private.platform_relationships where kind='friend' and source_id=$1 and target_id=$2", [actor, user]);
    if (friend.rowCount) return { ok: true };
    await client.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind) values($1,$2,'request') on conflict do nothing", [actor, user]);
    await notify(client, command.requestId, 'friend-request', user, { actionUrl: '/app#friends' });
  } else if (a.type === 'friend.accept') {
    const result = await client.query("delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='request' returning source_id", [user, actor]);
    if (!result.rowCount) throw new DomainError('request_missing', 'Dit verzoek bestaat niet meer.', 409);
    await client.query("delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='request'", [actor, user]);
    for (const [source, target] of [[actor, user], [user, actor]]) await client.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind) values($1,$2,'friend') on conflict do nothing", [source, target]);
    await notify(client, command.requestId, 'friend-accepted', user, { actionUrl: '/app#friends' });
  } else if (a.type === 'friend.reject') await client.query("delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='request'", [user, actor]);
  else if (a.type === 'friend.remove') await client.query("delete from dartflow_private.platform_relationships where ((source_id=$1 and target_id=$2) or (source_id=$2 and target_id=$1)) and kind in ('friend','request','favorite')", [actor, user]);
  else if (a.type === 'friend.favorite') {
    if (!(await client.query("select 1 from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='friend'", [actor, user])).rowCount) throw new DomainError('friend_required', 'Voeg deze speler eerst toe als vriend.');
    if (a.favorite === false) await client.query("delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='favorite'", [actor, user]);
    else await client.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind) values($1,$2,'favorite') on conflict do nothing", [actor, user]);
  } else throw new DomainError('invalid_action', 'Onbekende vriendenactie.');
  return { ok: true };
}
