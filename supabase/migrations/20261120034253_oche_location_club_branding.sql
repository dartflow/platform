begin;
alter table dartflow_private.oche_devices add column if not exists branding_club_id uuid references dartflow_private.clubs(id)on delete set null;
alter table dartflow_private.oche_devices drop constraint if exists oche_devices_theme_check;
alter table dartflow_private.oche_devices add constraint oche_devices_theme_check check(theme in('dartflow','onzetrots','club'));
alter table dartflow_private.oche_devices drop constraint if exists oche_device_club_theme_scope;
alter table dartflow_private.oche_devices add constraint oche_device_club_theme_scope check((theme='club' or branding_club_id is null)and(theme<>'club' or scope='location'));
grant update(branding_club_id)on dartflow_private.oche_devices to dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('oche_location_club_branding',1)on conflict(name)do update set version=excluded.version;
commit;
