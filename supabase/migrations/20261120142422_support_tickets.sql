begin;
create sequence if not exists dartflow_private.support_ticket_number_seq start with 1001;
create table if not exists dartflow_private.support_tickets (
 id uuid primary key,
 ticket_number bigint not null unique default nextval('dartflow_private.support_ticket_number_seq'),
 owner_id uuid references dartflow_private.profiles(id) on delete set null,
 category text not null check(category in('account','playing','competition','boards','notifications','other')),
 subject text not null check(length(subject) between 1 and 160),
 status text not null default 'new' check(status in('new','in_progress','waiting_for_user','resolved','closed')),
 priority text not null default 'normal' check(priority in('low','normal','high','urgent')),
 assignee_id uuid references dartflow_private.profiles(id) on delete set null,
 revision integer not null default 1 check(revision>0),
 public_revision integer not null default 1 check(public_revision>0),
 created_at timestamptz not null default clock_timestamp(),
 public_updated_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index if not exists support_tickets_owner_activity on dartflow_private.support_tickets(owner_id,public_updated_at desc,id);
create index if not exists support_tickets_queue on dartflow_private.support_tickets(status,updated_at desc,id);
create index if not exists support_tickets_assignment on dartflow_private.support_tickets(assignee_id,status,updated_at desc);
create table if not exists dartflow_private.support_ticket_events (
 id uuid primary key,
 sequence bigint generated always as identity unique,
 ticket_id uuid not null references dartflow_private.support_tickets(id) on delete cascade,
 actor_id uuid references dartflow_private.profiles(id) on delete set null,
 actor_role text not null check(actor_role in('user','support','system')),
 visibility text not null check(visibility in('public','internal')),
 kind text not null check(kind in('created','message','status','details','internal_note','assignment','priority')),
 body text check(body is null or length(body) between 1 and 8000),
 changes jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(),
 check((visibility='public' and kind in('created','message','status','details'))or(visibility='internal'and kind in('internal_note','assignment','priority')))
);
create index if not exists support_ticket_events_order on dartflow_private.support_ticket_events(ticket_id,sequence);
create index if not exists support_ticket_events_public on dartflow_private.support_ticket_events(ticket_id,sequence)where visibility='public';
create table if not exists dartflow_private.support_ticket_receipts (
 actor_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 request_id uuid not null,
 ticket_id uuid not null references dartflow_private.support_tickets(id) on delete cascade,
 payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'),
 audience text not null check(audience in('owner','support')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
create or replace function dartflow_private.guard_support_ticket_identity()returns trigger language plpgsql set search_path=''as $$
begin
 if new.id<>old.id or new.ticket_number<>old.ticket_number or new.created_at<>old.created_at then
  raise exception 'support ticket identity is immutable' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists support_ticket_identity_immutable on dartflow_private.support_tickets;
create trigger support_ticket_identity_immutable before update on dartflow_private.support_tickets for each row execute function dartflow_private.guard_support_ticket_identity();
revoke all on function dartflow_private.guard_support_ticket_identity()from public;
do $$declare t text;r text;begin
 foreach t in array array['support_tickets','support_ticket_events','support_ticket_receipts']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public,dartflow_app',t);
  if not exists(select 1 from pg_policy where polrelid=('dartflow_private.'||t)::regclass and polname='support_runtime')then
   execute format('create policy support_runtime on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  end if;
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
 end loop;
 foreach r in array array['anon','authenticated','service_role']loop
  if exists(select 1 from pg_roles where rolname=r)then
   execute format('revoke all on sequence dartflow_private.support_ticket_number_seq,dartflow_private.support_ticket_events_sequence_seq from %I',r);
   execute format('revoke all on function dartflow_private.guard_support_ticket_identity()from %I',r);
  end if;
 end loop;
end $$;
revoke all on sequence dartflow_private.support_ticket_number_seq,dartflow_private.support_ticket_events_sequence_seq from public,dartflow_app;
grant usage,select on sequence dartflow_private.support_ticket_number_seq,dartflow_private.support_ticket_events_sequence_seq to dartflow_app;
grant select on dartflow_private.support_tickets,dartflow_private.support_ticket_events,dartflow_private.support_ticket_receipts to dartflow_app;
grant insert(id,owner_id,category,subject)on dartflow_private.support_tickets to dartflow_app;
grant update(category,subject,status,priority,assignee_id,revision,public_revision,public_updated_at,updated_at)on dartflow_private.support_tickets to dartflow_app;
grant insert on dartflow_private.support_ticket_events,dartflow_private.support_ticket_receipts to dartflow_app;

-- Only the existing confirmed, lease-validated owner erasure entrypoint invokes
-- this private scrub. Receipt/audit mutation remains unavailable to the runtime.
create or replace function dartflow_private.scrub_support_account(actor uuid)returns void language plpgsql set search_path=pg_catalog,dartflow_private as $$
declare owned uuid[];
begin
 select coalesce(array_agg(id),'{}'::uuid[])into owned from dartflow_private.support_tickets where owner_id=actor;
 delete from dartflow_private.support_ticket_receipts where actor_id=actor or ticket_id=any(owned);
 update dartflow_private.support_ticket_events set body=null,changes='{}',actor_id=null where ticket_id=any(owned)or actor_id=actor;
 update dartflow_private.support_ticket_events set changes=changes-'previousAssigneeId'-'assigneeId'where changes->>'previousAssigneeId'=actor::text or changes->>'assigneeId'=actor::text;
 update dartflow_private.support_tickets set owner_id=null,subject='Verwijderd supportticket',category='other',status='closed',assignee_id=null where id=any(owned);
 update dartflow_private.support_tickets set assignee_id=null where assignee_id=actor;
end $$;
revoke all on function dartflow_private.scrub_support_account(uuid)from public,dartflow_app,dartflow_privacy_worker;
do $$declare r text;definition text;begin
 foreach r in array array['anon','authenticated','service_role']loop
  if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.scrub_support_account(uuid)from %I',r);end if;
 end loop;
 definition=pg_get_functiondef('dartflow_private.erase_account_job(uuid,uuid)'::regprocedure);
 if position('perform dartflow_private.scrub_support_account(a);'in definition)=0 then
  if position('perform dartflow_private.scrub_clubhouse_account(a);'in definition)=0 then raise exception 'expected confirmed erasure hook missing';end if;
  definition=replace(definition,'perform dartflow_private.scrub_clubhouse_account(a);','perform dartflow_private.scrub_clubhouse_account(a);'||chr(10)||' perform dartflow_private.scrub_support_account(a);');
  execute definition;
 end if;
end $$;
insert into dartflow_private.feature_versions(name,version)values('support_tickets',1)on conflict(name)do update set version=excluded.version;
commit;
