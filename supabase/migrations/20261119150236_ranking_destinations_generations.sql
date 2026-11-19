begin;
create table if not exists dartflow_private.ranking_lists(
 id uuid primary key,scope text not null check(scope in('national','club')),kind text not null check(kind in('rating','circuit')),
 club_id uuid references dartflow_private.clubs(id) on delete cascade,name text not null,
 policy_version integer not null default 1,next_sequence bigint not null default 0,active_generation uuid,
 closes_at timestamptz,created_by uuid,created_at timestamptz not null default clock_timestamp(),
 check((scope='club')=(club_id is not null))
);
create index if not exists ranking_lists_club on dartflow_private.ranking_lists(club_id,kind);
create table if not exists dartflow_private.ranking_list_policies(
 list_id uuid not null references dartflow_private.ranking_lists(id) on delete cascade,version integer not null check(version>0),
 policy jsonb not null,published_by uuid,published_at timestamptz not null default clock_timestamp(),primary key(list_id,version)
);
create table if not exists dartflow_private.ranking_event_declarations(
 id uuid primary key,entity_id uuid not null references dartflow_private.platform_entities(id) on delete cascade,
 list_id uuid not null references dartflow_private.ranking_lists(id) on delete cascade,policy_version integer not null,
 rules jsonb not null,requested_by uuid not null,status text not null default 'pending' check(status in('pending','approved','rejected')),
 decided_by uuid,reason text,requested_at timestamptz not null default clock_timestamp(),decided_at timestamptz,
 unique(entity_id,list_id),foreign key(list_id,policy_version)references dartflow_private.ranking_list_policies(list_id,version)
);
create index if not exists ranking_declarations_list_status on dartflow_private.ranking_event_declarations(list_id,status,entity_id);
create table if not exists dartflow_private.ranking_event_confirmations(
 declaration_id uuid not null references dartflow_private.ranking_event_declarations(id)on delete cascade,
 player_id uuid not null,confirmed_at timestamptz not null default clock_timestamp(),primary key(declaration_id,player_id)
);
create table if not exists dartflow_private.ranking_match_admissions(
 match_id uuid not null references dartflow_private.matches(id) on delete cascade,
 declaration_id uuid not null references dartflow_private.ranking_event_declarations(id) on delete cascade,
 eligible boolean not null,reason text,source_revision integer not null,admitted_at timestamptz not null default clock_timestamp(),
 primary key(match_id,declaration_id)
);
create index if not exists ranking_admissions_declaration on dartflow_private.ranking_match_admissions(declaration_id,match_id);
create table if not exists dartflow_private.ranking_participant_admissions(
 declaration_id uuid not null references dartflow_private.ranking_event_declarations(id) on delete cascade,
 player_id uuid not null,eligible boolean not null,checked_in boolean not null default false,reason text,admitted_at timestamptz not null default clock_timestamp(),
 primary key(declaration_id,player_id)
);
alter table dartflow_private.ranking_participant_admissions add column if not exists checked_in boolean not null default false;
create table if not exists dartflow_private.ranking_sources(
 id uuid primary key,list_id uuid not null references dartflow_private.ranking_lists(id) on delete cascade,
 source_kind text not null check(source_kind in('match','event')),source_key text not null,
 match_id uuid references dartflow_private.matches(id) on delete cascade,
 entity_id uuid references dartflow_private.platform_entities(id) on delete cascade,
 declaration_id uuid references dartflow_private.ranking_event_declarations(id) on delete cascade,
 policy_version integer not null,sequence bigint not null,created_at timestamptz not null default clock_timestamp(),
 unique(list_id,source_kind,source_key),unique(list_id,sequence),
 foreign key(list_id,policy_version)references dartflow_private.ranking_list_policies(list_id,version),
 check((source_kind='match')=(match_id is not null)),check((source_kind='event')=(entity_id is not null))
);
create index if not exists ranking_sources_match on dartflow_private.ranking_sources(match_id,list_id);
create index if not exists ranking_sources_entity on dartflow_private.ranking_sources(entity_id,list_id);
create index if not exists ranking_sources_declaration on dartflow_private.ranking_sources(declaration_id);
create table if not exists dartflow_private.ranking_source_revisions(
 source_id uuid not null references dartflow_private.ranking_sources(id) on delete cascade,
 revision integer not null check(revision>0),verdict text not null check(verdict in('valid','void')),
 data jsonb not null,actor_id uuid,reason text not null,created_at timestamptz not null default clock_timestamp(),primary key(source_id,revision)
);
create table if not exists dartflow_private.ranking_generations(
 id uuid primary key,list_id uuid not null references dartflow_private.ranking_lists(id) on delete cascade,
 previous_generation uuid,source_count integer not null,source_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists ranking_generations_list on dartflow_private.ranking_generations(list_id,created_at desc,id);
create table if not exists dartflow_private.ranking_generation_accounts(
 generation_id uuid not null references dartflow_private.ranking_generations(id) on delete cascade,
 player_id uuid not null,rating double precision not null,played integer not null,unique_opponents integer not null,
 last_played_at timestamptz,points integer not null default 0,results jsonb not null default '[]',
 primary key(generation_id,player_id)
);
create table if not exists dartflow_private.ranking_generation_bookings(
 generation_id uuid not null references dartflow_private.ranking_generations(id) on delete cascade,
 source_id uuid not null references dartflow_private.ranking_sources(id) on delete cascade,source_revision integer not null,
 player_id uuid not null,before_rating double precision not null,after_rating double precision not null,delta double precision not null,
 points integer not null default 0,place integer,recorded_at timestamptz not null,
 primary key(generation_id,source_id,player_id),
 foreign key(source_id,source_revision)references dartflow_private.ranking_source_revisions(source_id,revision)on delete cascade
);
create index if not exists ranking_generation_booking_player on dartflow_private.ranking_generation_bookings(generation_id,player_id,recorded_at desc);
create table if not exists dartflow_private.ranking_service_receipts(
 actor_id uuid not null,request_id uuid not null,payload_hash text not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create table if not exists dartflow_private.ranking_service_audit(
 id bigint generated always as identity primary key,actor_id uuid not null,request_id uuid not null,action text not null,detail jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(actor_id,request_id)
);

insert into dartflow_private.ranking_lists(id,scope,kind,name)values
 ('10000000-0000-4000-8000-000000000001','national','rating','Landelijke spelersrating'),
 ('10000000-0000-4000-8000-000000000002','national','circuit','Landelijk circuit 2026–2027')on conflict(id)do nothing;
insert into dartflow_private.ranking_list_policies(list_id,version,policy)
 select id,1,jsonb_build_object('version','national-x01-2026-11-v1','discipline','x01','startScore',501,'bestOfLegs',jsonb_build_array(5,7,9,11,13,15,17,19),'initialRating',1500,'k',32,'placementMatches',10,'placementOpponents',5,'activeDays',90,'season','2026-2027','eventCount',8,'bestResults',5,'minimumStarters',16,'allowGuests',false)
 from dartflow_private.ranking_lists where scope='national'on conflict(list_id,version)do nothing;

-- Only previously declared, durable official free books are carried forward.
-- Legacy/personal results without a prior booking remain outside every ranking.
insert into dartflow_private.ranking_sources(id,list_id,source_kind,source_key,match_id,policy_version,sequence)
 select gen_random_uuid(),'10000000-0000-4000-8000-000000000001','match',b.match_id::text,b.match_id,1,b.sequence
 from dartflow_private.ranking_bookings b on conflict(list_id,source_kind,source_key)do nothing;
insert into dartflow_private.ranking_source_revisions(source_id,revision,verdict,data,reason)
 select s.id,1,'valid',jsonb_build_object('players',b.players,'winnerId',b.winner_id,'resultRevision',b.result_revision,'playedAt',b.played_at),'Compatibele overdracht van bestaande officiële boeking'
 from dartflow_private.ranking_sources s join dartflow_private.ranking_bookings b on b.match_id=s.match_id
 where s.list_id='10000000-0000-4000-8000-000000000001' on conflict(source_id,revision)do nothing;
update dartflow_private.ranking_lists set next_sequence=greatest(next_sequence,coalesce((select max(s.sequence)from dartflow_private.ranking_sources s where s.list_id=ranking_lists.id),0));

-- Migration creates readable initial generations before the new application activates.
do $$ declare l record;g uuid;begin
 for l in select *from dartflow_private.ranking_lists where active_generation is null loop
  g:=gen_random_uuid();
  insert into dartflow_private.ranking_generations(id,list_id,source_count,source_hash)values(g,l.id,0,'initial');
  if l.id='10000000-0000-4000-8000-000000000001'then
   insert into dartflow_private.ranking_generation_accounts(generation_id,player_id,rating,played,unique_opponents,last_played_at)
    select g,player_id,rating,played,unique_opponents,last_played_at from dartflow_private.ranking_accounts;
   insert into dartflow_private.ranking_generation_bookings(generation_id,source_id,source_revision,player_id,before_rating,after_rating,delta,recorded_at)
    select g,s.id,1,b.players[i],b.before_ratings[i],b.after_ratings[i],b.deltas[i],b.played_at from dartflow_private.ranking_bookings b join dartflow_private.ranking_sources s on s.match_id=b.match_id and s.list_id=l.id cross join generate_series(1,2)i;
  end if;
  update dartflow_private.ranking_lists set active_generation=g where id=l.id;
 end loop;
end $$;

do $$ declare t text;r text;begin
 foreach t in array array['ranking_lists','ranking_list_policies','ranking_event_declarations','ranking_event_confirmations','ranking_match_admissions','ranking_participant_admissions','ranking_sources','ranking_source_revisions','ranking_generations','ranking_generation_accounts','ranking_generation_bookings','ranking_service_receipts','ranking_service_audit']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
  execute format('revoke update,delete on dartflow_private.%I from dartflow_app',t);
 end loop;
end $$;
grant usage,select on sequence dartflow_private.ranking_service_audit_id_seq to dartflow_app;
grant update(policy_version,next_sequence,active_generation,closes_at)on dartflow_private.ranking_lists to dartflow_app;
grant update(status,decided_by,reason,decided_at)on dartflow_private.ranking_event_declarations to dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('ranking_destinations_generations',1)on conflict(name)do update set version=excluded.version;
commit;
