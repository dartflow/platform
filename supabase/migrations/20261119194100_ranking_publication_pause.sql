begin;
alter table dartflow_private.ranking_lists add column if not exists publication_paused boolean not null default false;
alter table dartflow_private.ranking_lists add column if not exists publication_revision integer not null default 0;
alter table dartflow_private.ranking_lists add column if not exists publication_reason text;
alter table dartflow_private.ranking_lists add column if not exists publication_paused_at timestamptz;
alter table dartflow_private.ranking_lists add column if not exists pending_generation uuid references dartflow_private.ranking_generations(id);
grant update(publication_paused,publication_revision,publication_reason,publication_paused_at,pending_generation)on dartflow_private.ranking_lists to dartflow_app;
-- Keep the public pointer stable even if another writer tries to publish directly.
create or replace function dartflow_private.hold_ranking_publication() returns trigger language plpgsql set search_path=pg_catalog,dartflow_private,pg_temp as $$
begin
 if new.publication_paused and new.active_generation is distinct from old.active_generation then
  new.pending_generation:=new.active_generation;new.active_generation:=old.active_generation;
 end if;
 return new;
end $$;
revoke all on function dartflow_private.hold_ranking_publication() from public;
drop trigger if exists hold_ranking_publication on dartflow_private.ranking_lists;
create trigger hold_ranking_publication before update on dartflow_private.ranking_lists for each row execute function dartflow_private.hold_ranking_publication();
insert into dartflow_private.feature_versions(name,version)values('ranking_publication_pause',1)on conflict(name)do update set version=excluded.version;
commit;
