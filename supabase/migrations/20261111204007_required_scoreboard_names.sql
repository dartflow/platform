-- Verified Auth creates an unconfirmed proposal; only a player command confirms it.
begin;
alter table dartflow_private.profiles add column if not exists display_name_confirmed boolean not null default true;
update dartflow_private.profiles set display_name_confirmed=false
where lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))='nieuwe speler'
   or length(btrim(name)) not between 1 and 80 or name !~ '[[:alnum:]]' or name ~ '[[:cntrl:]]';
grant insert(display_name_confirmed),update(display_name_confirmed) on dartflow_private.profiles to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('display_names',1) on conflict(name) do update set version=excluded.version;
commit;
