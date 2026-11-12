-- Server-owned physical assignment activity. No browser heartbeat renews this timeline.
begin;
create table if not exists dartflow_private.board_activity_sessions (
 id uuid primary key,
 source_kind text not null check(source_kind in ('training','lobby','match')),
 source_id uuid not null,
 event_id uuid not null references dartflow_private.events(id) on delete cascade,
 kind text not null check(kind in ('free','official')),
 status text not null default 'active' check(status in ('active','released','interrupted','completed')),
 board_ids uuid[] not null check(cardinality(board_ids)>0),
 actor_ids uuid[] not null,
 activity_at timestamptz not null default date_trunc('milliseconds',statement_timestamp()),
 deadline_at timestamptz not null default date_trunc('milliseconds',statement_timestamp())+interval '180 seconds',
 warning_epoch uuid not null,
 extensions_used smallint not null default 0 check(extensions_used between 0 and 2),
 last_score_revision integer,
 ended_at timestamptz,
 reason text,
 adopted boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists board_activity_one_source on dartflow_private.board_activity_sessions(source_kind,source_id) where status in ('active','completed');
create index if not exists board_activity_due on dartflow_private.board_activity_sessions(deadline_at,id) where status='active';
create index if not exists board_activity_source_history on dartflow_private.board_activity_sessions(source_id,created_at desc,id);
create table if not exists dartflow_private.board_activity_links (
 board_id uuid primary key references dartflow_private.boards(id) on delete cascade,
 session_id uuid not null references dartflow_private.board_activity_sessions(id) on delete cascade
);
create index if not exists board_activity_links_session on dartflow_private.board_activity_links(session_id);
create table if not exists dartflow_private.board_activity_receipts (
 session_id uuid not null references dartflow_private.board_activity_sessions(id) on delete cascade,
 request_id uuid not null,
 actor_key text not null,
 warning_epoch uuid not null,
 response jsonb not null,
 primary key(session_id,request_id),
 unique(session_id,warning_epoch)
);
alter table dartflow_private.location_boards add column if not exists closed_at timestamptz;
alter table dartflow_private.location_boards add column if not exists close_after_session boolean not null default false;
alter table dartflow_private.board_reservations add column if not exists preferred_board_id uuid references dartflow_private.boards(id);
grant update(closed_at,close_after_session) on dartflow_private.location_boards to dartflow_app;
-- Existing assignments get one explicit transition grace, never a deadline inferred from a refresh.
insert into dartflow_private.board_activity_sessions(id,source_kind,source_id,event_id,kind,board_ids,actor_ids,warning_epoch,adopted)
select gen_random_uuid(),'match',m.id,m.event_id,case when exists(select 1 from dartflow_private.platform_match_links ml join dartflow_private.platform_entities e on e.id=ml.entity_id where ml.match_id=m.id and e.kind='lobby') then 'free' else 'official' end,array[m.board_id],array(select p.user_id from dartflow_private.match_players p where p.match_id=m.id order by p.position),gen_random_uuid(),true
from dartflow_private.matches m where m.board_id is not null and m.state->>'status' in ('live','disputed') and not exists(select 1 from dartflow_private.board_activity_sessions s where s.source_id=m.id);
insert into dartflow_private.board_activity_sessions(id,source_kind,source_id,event_id,kind,board_ids,actor_ids,warning_epoch,adopted)
select gen_random_uuid(),'training',e.id,(e.state->>'eventId')::uuid,'free',array[(e.state->>'boardId')::uuid],array[e.owner_id],gen_random_uuid(),true
from dartflow_private.platform_entities e where e.kind='training' and e.state->>'boardHeld'='true' and coalesce(e.state->>'closed','false')<>'true' and (e.state->>'boardLeaseUntil')::bigint>floor(extract(epoch from clock_timestamp())*1000)
and not exists(select 1 from dartflow_private.board_activity_sessions s where s.source_id=e.id);
insert into dartflow_private.board_activity_links(board_id,session_id)
select unnest(s.board_ids),s.id from dartflow_private.board_activity_sessions s where s.status in ('active','completed') on conflict(board_id) do nothing;
do $$ declare t text; r text; begin
 foreach t in array array['board_activity_sessions','board_activity_links','board_activity_receipts'] loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role'] loop
   if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on dartflow_private.%I from %I',t,r); end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true) with check(true)',t);
 end loop;
end $$;
grant select,insert,update,delete on dartflow_private.board_activity_sessions,dartflow_private.board_activity_links,dartflow_private.board_activity_receipts to dartflow_app;
-- Runtime cannot rewrite ordinary audit or receipts. This narrow purge only accepts
-- an already detached, explicitly abandoned FREE physical session without a result.
create or replace function dartflow_private.purge_abandoned_board_payloads(target_session uuid) returns void
language plpgsql security definer set search_path=pg_catalog,dartflow_private as $$
declare session_record dartflow_private.board_activity_sessions%rowtype; match_record jsonb; entity_record record;
begin
 select * into session_record from dartflow_private.board_activity_sessions where id=target_session for update;
 if not found or session_record.kind<>'free' or session_record.status<>'released' or session_record.reason is null or session_record.reason not in ('timeout','forced')
 or exists(select 1 from dartflow_private.board_activity_links where session_id=target_session) then
  raise exception 'Only detached abandoned free sessions can be purged' using errcode='42501';
 end if;
 if session_record.source_kind='match' then
  select state into match_record from dartflow_private.matches where id=session_record.source_id for update;
  if not found or match_record->>'status' is distinct from 'abandoned' or coalesce((match_record->>'resultPublished')::boolean,false)
  or exists(select 1 from dartflow_private.match_results where match_id=session_record.source_id) then
   raise exception 'Published or non-abandoned matches cannot be purged' using errcode='42501';
  end if;
  update dartflow_private.action_receipts set response=jsonb_build_object('id',session_record.source_id,'status','abandoned','revision',match_record->'revision','boardId',null) where match_id=session_record.source_id;
  update dartflow_private.audit_events set detail=jsonb_build_object('removed',true) where match_id=session_record.source_id;
 end if;
 if session_record.source_kind<>'match' and not exists(select 1 from dartflow_private.platform_entities where id=session_record.source_id and state->>'discarded'='true') then raise exception 'Source must be discarded first' using errcode='42501'; end if;
 for entity_record in select id,state from dartflow_private.platform_entities where id=session_record.source_id or(kind='lobby' and state->>'matchId'=session_record.source_id::text) for update loop
  if entity_record.state->>'discarded' is distinct from 'true' then raise exception 'Source must be discarded first' using errcode='42501'; end if;
  update dartflow_private.platform_receipts set response=jsonb_build_object('ok',true,'id',entity_record.id,'expired',true) where response->>'id'=entity_record.id::text or response->'entity'->>'id'=entity_record.id::text;
 end loop;
 delete from dartflow_private.board_score_events where source_id=session_record.source_id;
end $$;
revoke all on function dartflow_private.purge_abandoned_board_payloads(uuid) from public;
do $$ declare r text; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function dartflow_private.purge_abandoned_board_payloads(uuid) from %I',r); end if;
 end loop;
end $$;
grant execute on function dartflow_private.purge_abandoned_board_payloads(uuid) to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('board_activity',1) on conflict(name) do update set version=excluded.version;
commit;
