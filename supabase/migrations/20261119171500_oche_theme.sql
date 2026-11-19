begin;
alter table dartflow_private.oche_devices add column if not exists theme text not null default 'dartflow' check(theme in('dartflow','onzetrots'));
insert into dartflow_private.feature_versions(name,version)values('oche_theme',1)on conflict(name)do update set version=excluded.version;
commit;
