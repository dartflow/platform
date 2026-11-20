import {randomBytes,randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {clubIsActiveMember} from './club-access';
import {getClubhouse} from './clubhouse';
import {hash,transaction,uuid} from './platform-store';
const stamp=(value:string)=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const escaped=(value:string)=>value.replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
function fold(line:string){let row='';const rows:string[]=[];for(const char of line){if(Buffer.byteLength(row+char)>75){rows.push(row);row=' ';}row+=char;}rows.push(row);return rows.join('\r\n');}
export async function clubCalendar(actor:string,clubId:string,origin:string){
 const view=await getClubhouse(actor,clubId,'calendar'),events=view.activities.flatMap(a=>['BEGIN:VEVENT',`UID:${a.id}@dartflow.nl`,`SEQUENCE:${a.revision}`,`DTSTAMP:${stamp(a.startsAt)}`,`DTSTART:${stamp(a.startsAt)}`,`DTEND:${stamp(a.endsAt)}`,`SUMMARY:${escaped(a.title)}`,`DESCRIPTION:${escaped(a.description)}`,`LOCATION:${escaped(a.location)}`,`URL:${origin}/app/clubs/${clubId}/agenda?activity=${a.id}`,'END:VEVENT']);
 for(const season of view.competitions)for(const f of season.fixtures.filter(f=>f.startsAt&&f.endsAt&&f.status!=='canceled')){const label=(id:string)=>season.teams.find(t=>t.id===id)?.name??season.participants.find(p=>p.id===id)?.name??'Deelnemer';events.push('BEGIN:VEVENT',`UID:${f.id}@dartflow.nl`,`SEQUENCE:${season.revision}`,`DTSTAMP:${stamp(season.createdAt)}`,`DTSTART:${stamp(f.startsAt!)}`,`DTEND:${stamp(f.endsAt!)}`,`SUMMARY:${escaped(`${season.name} · ${label(f.homeId)} – ${label(f.awayId)}`)}`,`URL:${origin}/app/competities/${season.id}`,'END:VEVENT');}
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DartFlow//Clubhouse//NL','CALSCALE:GREGORIAN','METHOD:PUBLISH',...events,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
export async function updateClubCalendarFeed(actor:string,clubId:string,origin:string,revoke=false){
 return transaction(async client=>{
  await client.query('select id from dartflow_private.platform_entities where id=$1 for share',[uuid(clubId)]);if(!await clubIsActiveMember(client,clubId,uuid(actor)))throw new DomainError('forbidden','Je bent geen huidig verenigingslid.',403);
  if(revoke){await client.query('delete from dartflow_private.club_calendar_feeds where user_id=$1 and club_id=$2',[actor,clubId]);return {ok:true,revoked:true};}
  const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+90*86400_000).toISOString();await client.query('insert into dartflow_private.club_calendar_feeds(user_id,club_id,token_hash,expires_at)values($1,$2,$3,$4)on conflict(user_id,club_id)do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at',[actor,clubId,hash(token),expiresAt]);
  await client.query('insert into dartflow_private.clubhouse_audit(id,club_id,actor_id,action,detail)values($1,$2,$3,$4,$5)',[randomUUID(),clubId,actor,'calendar.feed.rotate',JSON.stringify({expiresAt})]);return {ok:true,url:`${origin}/api/clubhouse/calendar-feed/${token}`,expiresAt};
 });
}
export async function readClubCalendarFeed(token:string,origin:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new DomainError('not_found','Deze agendalink is niet meer beschikbaar.',404);
 const actor=await transaction(async client=>{const row=(await client.query('select user_id,club_id from dartflow_private.club_calendar_feeds where token_hash=$1 and expires_at>now()',[hash(token)])).rows[0];if(!row||!await clubIsActiveMember(client,row.club_id,row.user_id))throw new DomainError('not_found','Deze agendalink is niet meer beschikbaar.',404);return row;});
 return clubCalendar(actor.user_id,actor.club_id,origin);
}
