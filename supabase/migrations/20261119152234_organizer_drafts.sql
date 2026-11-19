begin;
create table if not exists dartflow_private.organizer_drafts(
 id uuid primary key,owner_id uuid not null references dartflow_private.profiles(id)on delete cascade,
 kind text not null check(kind in('tournament','season')),ownership text not null check(ownership in('personal','club','platform')),
 club_id uuid references dartflow_private.clubs(id)on delete cascade,name text not null,step text not null,values jsonb not null,
 revision integer not null default 1 check(revision>0),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((ownership='club')=(club_id is not null)),check(kind='tournament'or ownership<>'personal'),check(octet_length(values::text)<=65536)
);
create index if not exists organizer_drafts_owner on dartflow_private.organizer_drafts(owner_id,updated_at desc,id);
create index if not exists organizer_drafts_club on dartflow_private.organizer_drafts(club_id,kind,updated_at desc,id);
create table if not exists dartflow_private.organizer_draft_receipts(
 actor_id uuid not null references dartflow_private.profiles(id)on delete cascade,request_id uuid not null,
 payload_hash text not null,response jsonb not null,owner_id uuid not null,kind text not null,ownership text not null,
 club_id uuid references dartflow_private.clubs(id)on delete cascade,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
do $$declare t text;r text;begin
 foreach t in array array['organizer_drafts','organizer_draft_receipts']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
 end loop;
end $$;
grant update(name,step,values,revision,updated_at),delete on dartflow_private.organizer_drafts to dartflow_app;
revoke update,delete on dartflow_private.organizer_draft_receipts from dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('organizer_drafts',1)on conflict(name)do update set version=excluded.version;
commit;
