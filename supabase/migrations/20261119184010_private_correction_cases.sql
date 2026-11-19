begin;
create table if not exists dartflow_private.match_correction_case_entries(
 id uuid primary key,request_id uuid not null references dartflow_private.match_correction_requests(id)on delete cascade,
 actor_id uuid not null references dartflow_private.profiles(id),kind text not null check(kind in('opened','response','appeal','closed','access','purged')),
 data jsonb not null default '{}',retain_until timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists match_correction_case_entries_request on dartflow_private.match_correction_case_entries(request_id,created_at,id);
create index if not exists match_correction_case_expiring_evidence on dartflow_private.match_correction_case_entries(retain_until,id)where data?'evidenceText';
create unique index if not exists match_correction_case_opened on dartflow_private.match_correction_case_entries(request_id)where kind='opened';
create unique index if not exists match_correction_case_response on dartflow_private.match_correction_case_entries(request_id,actor_id)where kind='response';
create unique index if not exists match_correction_case_closed on dartflow_private.match_correction_case_entries(request_id)where kind='closed';
create unique index if not exists match_correction_case_appeal on dartflow_private.match_correction_case_entries(request_id)where kind='appeal';
alter table dartflow_private.match_correction_case_entries enable row level security;
revoke all on dartflow_private.match_correction_case_entries from public;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop
 if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.match_correction_case_entries from %I',r);end if;
end loop;end $$;
drop policy if exists app_access on dartflow_private.match_correction_case_entries;
create policy app_access on dartflow_private.match_correction_case_entries to dartflow_app using(true)with check(true);
grant select,insert on dartflow_private.match_correction_case_entries to dartflow_app;
revoke update,delete on dartflow_private.match_correction_case_entries from dartflow_app;
-- The runtime can erase only expired voluntary proof, never rewrite a decision.
alter table dartflow_private.match_correction_case_entries drop constraint if exists match_correction_case_entries_kind_check;
alter table dartflow_private.match_correction_case_entries add constraint match_correction_case_entries_kind_check check(kind in('opened','response','appeal','closed','access','purged'));
create or replace function dartflow_private.purge_expired_correction_evidence(batch_size integer default 50) returns integer language plpgsql security definer set search_path=pg_catalog,dartflow_private,pg_temp as $$
declare item record;purged_count integer:=0;
begin
 for item in select c.id,c.request_id,c.actor_id,c.retain_until from dartflow_private.match_correction_case_entries c where c.retain_until<=clock_timestamp() and c.data?'evidenceText' order by c.retain_until,c.id for update skip locked limit least(greatest(batch_size,1),100) loop
  update dartflow_private.match_correction_case_entries set data=data-'evidenceText' where id=item.id;
  insert into dartflow_private.match_correction_case_entries(id,request_id,actor_id,kind,data,retain_until)values(gen_random_uuid(),item.request_id,item.actor_id,'purged',jsonb_build_object('system',true,'operation','expired-voluntary-evidence-erased','entryId',item.id),item.retain_until);
  purged_count:=purged_count+1;
 end loop;return purged_count;
end $$;
revoke all on function dartflow_private.purge_expired_correction_evidence(integer) from public;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.purge_expired_correction_evidence(integer) from %I',r);end if;end loop;end $$;
grant execute on function dartflow_private.purge_expired_correction_evidence(integer) to dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('private_correction_cases',1)on conflict(name)do update set version=excluded.version;
commit;
