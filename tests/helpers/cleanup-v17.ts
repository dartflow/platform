import type {Client} from 'pg';

/** Extend older UUID-scoped fixtures with v17 children; keep the owner invariant deferred until the parent is removed. */
export async function beginFixtureCleanup(client:Client,people:string[]){
 await client.query('rollback');await client.query('begin');
 const owned="select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])";
 await cleanupNotificationFixtures(client,people);
 await cleanupFeedFixtures(client,people);
 await client.query(`delete from dartflow_private.community_likes where user_id=any($1::uuid[]) or post_id in(select id from dartflow_private.community_posts where author_id=any($1::uuid[]) or scope_id in(${owned}))`,[people]);
 await client.query(`delete from dartflow_private.community_posts where parent_id is not null and (author_id=any($1::uuid[]) or scope_id in(${owned}))`,[people]);
 await client.query(`delete from dartflow_private.community_posts where author_id=any($1::uuid[]) or scope_id in(${owned})`,[people]);
 await client.query(`delete from dartflow_private.community_messages where author_id=any($1::uuid[]) or scope_id in(${owned})`,[people]);
 await client.query('delete from dartflow_private.community_moderation where user_id=any($1::uuid[]) or updated_by=any($1::uuid[])',[people]);
 await client.query(`delete from dartflow_private.club_join_requests where user_id=any($1::uuid[]) or reviewed_by=any($1::uuid[]) or club_id in(${owned})`,[people]);
 await client.query(`delete from dartflow_private.club_invites where user_id=any($1::uuid[]) or invited_by=any($1::uuid[]) or club_id in(${owned})`,[people]);
 await client.query('delete from dartflow_private.location_members where user_id=any($1::uuid[]) or granted_by=any($1::uuid[])',[people]);
 // Legacy club boards are mapped to independent locations by the migration/creation flow.
 await client.query('delete from dartflow_private.location_boards where location_id in(select id from dartflow_private.locations where owner_id=any($1::uuid[]))',[people]);
 await client.query('delete from dartflow_private.locations where owner_id=any($1::uuid[])',[people]);
 await client.query('delete from dartflow_private.location_accounts where user_id=any($1::uuid[])',[people]);
}

/** Remove only deliveries received by, or actually authored by, these fixture accounts. */
export async function cleanupNotificationFixtures(client:Client,people:string[]){
 const jobs=`select o.id from dartflow_private.mail_outbox o where o.recipient_id=any($1::uuid[]) or exists(select 1 from dartflow_private.mail_events e where e.actor_id=any($1::uuid[]) and (e.environment,e.scope_key,e.event_id,e.template_id,e.recipient_key)=(o.environment,o.scope_key,o.event_id,o.template_id,o.recipient_key))`;
 await client.query(`delete from dartflow_private.mail_provider_events where job_id in(${jobs})`,[people]);
 await client.query(`delete from dartflow_private.mail_outbox where id in(${jobs})`,[people]);
 await client.query('delete from dartflow_private.mail_events where actor_id=any($1::uuid[]) or recipient_key=any($2::text[])',[people,people.map(id=>`user:${id}`)]);
 await client.query("delete from dartflow_private.native_push_inbox where recipient_id=any($1::uuid[]) or reference->>'actorId'=any($2::text[])",[people,people]);
}

/** Extend independent older cleanups without altering their transaction or physical ownership order. */
export async function cleanupFeedFixtures(client:Client,people:string[]){
 // New feed pointers can be inserted by normal result publication in older
 // fixtures. Remove only these actors' conversations and owned channel scopes.
 const feedItems=`select id from dartflow_private.feed_items where author_id=any($1::uuid[]) or split_part(channel,':',2) in(select id::text from dartflow_private.platform_entities where owner_id=any($1::uuid[]))`;
 await client.query(`delete from dartflow_private.feed_likes where user_id=any($1::uuid[]) or item_id in(${feedItems})`,[people]);
 await client.query(`delete from dartflow_private.feed_replies where author_id=any($1::uuid[]) or item_id in(${feedItems})`,[people]);
 await client.query(`delete from dartflow_private.feed_items where id in(${feedItems})`,[people]);
 await client.query('delete from dartflow_private.feed_shares where created_by=any($1::uuid[])',[people]);
 await client.query('delete from dartflow_private.feed_preferences where user_id=any($1::uuid[])',[people]);
 await client.query('delete from dartflow_private.feed_receipts where actor_id=any($1::uuid[])',[people]);
 await client.query('delete from dartflow_private.feed_policies where updated_by=any($1::uuid[])',[people]);
}
