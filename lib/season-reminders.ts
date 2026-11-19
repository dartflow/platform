import type {PoolClient} from 'pg';
import type {SeasonState,SeasonFixture,SeasonTeam} from './seasons-types';
import {clubIsActiveMember} from './club-access';
import {seasonManager} from './season-authority';
import {enqueueDomainMail,mailAudit} from './integrations-mail';
import {integrationRuntime} from './integrations-core';
export type SeasonMailReference={fixtureId?:string;teamId?:string;at:string;kind?:'season-reminder'|'season-overdue'|'season-scheduled'|'season-proposed'|'season-role'|'season-reserve'|'season-status'|'season-play-mode'};
const final=new Set(['confirmed','administrative','canceled']);
const active=(s:SeasonState)=>['planned','active'].includes(s.status);
const scope=(s:SeasonState)=>s.clubId?`club:${s.clubId}`:'platform';
function entryName(s:SeasonState,id:string){return [...s.teams,...s.participants].find(p=>p.id===id)?.name??'Tegenstander';}
function opponentName(s:SeasonState,f:SeasonFixture,actor:string){const side=[f.homeId,f.awayId].find(id=>id===actor||s.teams.find(t=>t.id===id)?.playerIds.includes(actor));return side?entryName(s,side===f.homeId?f.awayId:f.homeId):`${entryName(s,f.homeId)} – ${entryName(s,f.awayId)}`;}
export async function seasonMailRecipients(client:Pick<PoolClient,'query'>,s:SeasonState,f:SeasonFixture,includeManagers=false):Promise<string[]>{
 const teams=s.teams.filter(t=>[f.homeId,f.awayId].includes(t.id)&&t.status==='active');const candidates=s.format==='teams'||s.format==='doubles'?teams.flatMap(t=>t.playerIds):s.participants.filter(p=>[f.homeId,f.awayId].includes(p.id)&&p.status==='active').map(p=>p.id);const allowed:string[]=[];
 for(const id of [...new Set(candidates)]){const clubId=teams.find(t=>t.playerIds.includes(id))?.clubId??s.clubId;if(!clubId||await clubIsActiveMember(client,clubId,id))allowed.push(id);}
 if(includeManagers){const managers=(await client.query<{user_id:string}>(s.scope==='national'?"select user_id from dartflow_private.platform_roles where role in('owner','admin')":"select user_id from dartflow_private.club_memberships where club_id=$1",s.scope==='national'?[]:[s.clubId])).rows;
  for(const id of [...new Set([...managers.map(row=>row.user_id),...s.managerIds])])if(await seasonManager(client,s,id))allowed.push(id);
 }return [...new Set(allowed)];
}
export async function seasonMailApplicable(client:Pick<PoolClient,'query'>,seasonId:string,reference:SeasonMailReference,recipient:string|null):Promise<boolean>{
 if(!recipient)return false;const s=(await client.query<{state:SeasonState}>('select state from dartflow_private.competition_seasons where id=$1',[seasonId])).rows[0]?.state,f=s?.fixtures.find(f=>f.id===reference.fixtureId);if(!s)return false;
 if(reference.kind==='season-role'){const team=s.teams.find(t=>t.id===reference.teamId);return Boolean(team&&team.status==='active'&&roleProof(team)===reference.at&&team.playerIds.includes(recipient)&&await clubIsActiveMember(client,team.clubId,recipient));}
 if(reference.kind==='season-status')return ['completed','archived'].includes(s.status)&&s.decisions.findLast(d=>d.action==='season.status')?.id===reference.at&&(await seasonRecipients(client,s)).includes(recipient);
 if(reference.kind==='season-reserve'||reference.kind==='season-play-mode'){const action=reference.kind==='season-reserve'?'season.reserve':null;return Boolean(f&&s.decisions.findLast(d=>d.fixtureId===f.id&&(action?d.action===action:['season.play-mode','season.accept-play-mode'].includes(d.action)))?.id===reference.at&&(await seasonMailRecipients(client,s,f)).includes(recipient));}
 if(!f||!active(s)||final.has(f.status)||!(await seasonMailRecipients(client,s,f,reference.kind==='season-overdue')).includes(recipient))return false;
 if(reference.kind==='season-overdue')return f.windowEnd===reference.at&&Date.parse(f.windowEnd)<=Date.now()&&f.overdue?.since===reference.at;
 if(reference.kind==='season-proposed')return f.status==='proposed'&&f.proposal?.startsAt===reference.at;
 return f.status==='scheduled'&&f.startsAt===reference.at&&Date.parse(reference.at)>Date.now()&&!f.proposal;
}
export async function notifySeasonSchedule(client:PoolClient,s:SeasonState,f:SeasonFixture,actor:string,proposal:boolean,previousStartsAt?:string):Promise<void>{
 const at=proposal?f.proposal?.startsAt:f.startsAt;if(!at)return;const date=new Date(at),kind=proposal?'season-proposed':'season-scheduled';
 const actorName=(await client.query<{name:string}>('select name from dartflow_private.profile_labels where id=$1',[actor])).rows[0]?.name??'Competitieleiding';
 const previousTime=previousStartsAt?new Date(previousStartsAt).toLocaleString('nl-NL',{timeZone:s.settings.timezone,dateStyle:'long',timeStyle:'short'}):'Nog geen bevestigde afspraak';
 for(const recipientId of await seasonMailRecipients(client,s,f)){if(proposal&&recipientId===actor)continue;await enqueueDomainMail(client,{id:`${kind}:${s.id}:${f.id}:${s.revision+1}`,templateId:proposal?'fixture-changed':'fixture-scheduled',scope:scope(s),recipientId,entityId:s.id,expiresAt:at,reminder:{kind,fixtureId:f.id,at},variables:{eventName:s.name,opponentName:opponentName(s,f,recipientId),actorName,previousTime,date:date.toLocaleDateString('nl-NL',{timeZone:s.settings.timezone,dateStyle:'long'}),time:date.toLocaleTimeString('nl-NL',{timeZone:s.settings.timezone,hour:'2-digit',minute:'2-digit'}),actionUrl:`/app/competities/${s.id}`}});}
}
const roleProof=(team:SeasonTeam)=>JSON.stringify({players:[...team.playerIds].sort(),captain:team.captainId,deputy:team.deputyId,status:team.status});
async function seasonRecipients(client:Pick<PoolClient,'query'>,s:SeasonState):Promise<string[]>{const result:string[]=[];for(const p of s.participants.filter(p=>p.status==='active'))if(!s.clubId||await clubIsActiveMember(client,s.clubId,p.id))result.push(p.id);for(const team of s.teams.filter(t=>t.status==='active'))for(const id of team.playerIds)if(await clubIsActiveMember(client,team.clubId,id))result.push(id);return [...new Set(result)];}
/** Durable inbox/mail events contain no hidden lineup or disciplinary reason. */
export async function notifySeasonTeam(client:PoolClient,s:SeasonState,team:SeasonTeam):Promise<void>{
 for(const recipientId of team.playerIds)if(await clubIsActiveMember(client,team.clubId,recipientId))await enqueueDomainMail(client,{id:`season-role:${s.id}:${team.id}:${s.revision+1}`,templateId:'season-team-role',scope:scope(s),recipientId,entityId:s.id,reminder:{kind:'season-role',teamId:team.id,at:roleProof(team)},variables:{eventName:s.name,teamName:team.name,role:recipientId===team.captainId?'Captain':recipientId===team.deputyId?'Plaatsvervangend captain':'Speler',actionUrl:`/app/competities/${s.id}`}});
}
export async function notifySeasonChange(client:PoolClient,s:SeasonState,kind:'season-status'|'season-reserve'|'season-play-mode',f?:SeasonFixture):Promise<void>{
 const proof=s.decisions.findLast(d=>kind==='season-status'?d.action==='season.status':d.fixtureId===f?.id&&(kind==='season-reserve'?d.action==='season.reserve':['season.play-mode','season.accept-play-mode'].includes(d.action)));if(!proof)return;
 for(const recipientId of f?await seasonMailRecipients(client,s,f):await seasonRecipients(client,s))await enqueueDomainMail(client,{id:`${kind}:${s.id}:${f?.id??'all'}:${s.revision+1}`,templateId:kind==='season-status'?'season-completed':kind==='season-reserve'?'season-reserve':'season-play-mode',scope:scope(s),recipientId,entityId:s.id,reminder:{kind,fixtureId:f?.id,at:proof.id},variables:{eventName:s.name,status:kind==='season-status'?(s.status==='archived'?'Gearchiveerd':'Afgesloten'):kind==='season-play-mode'?(f?.playModeProposal?'Nieuw voorstel':f?.playMode==='remote'?'Op afstand bevestigd':'Op locatie bevestigd'):'Reservewissel met leidingakkoord vastgelegd',opponentName:f?opponentName(s,f,recipientId):'',actionUrl:`/app/competities/${s.id}`}});
}
/** Executes in the existing mail planner transaction; no automatic sporting penalty. */
export async function planSeasonReminders(client:PoolClient):Promise<number>{
 const runtime=integrationRuntime();const rows=await client.query<{state:SeasonState;policy:Record<string,unknown>|null}>(`select s.state,p.settings policy from dartflow_private.competition_seasons s left join dartflow_private.mail_policies p on p.environment=$1 and p.scope_key=case when s.club_id is null then 'platform' else 'club:'||s.club_id::text end where s.status in('planned','active') and s.state->>'publishedAt' is not null and exists(select 1 from jsonb_array_elements(s.state->'fixtures')f where f->>'status' not in('confirmed','administrative','canceled') and ((f->>'windowEnd')::timestamptz<=now() and coalesce(f->'overdue'->>'since','')<>f->>'windowEnd' or f->>'status'='scheduled' and f->'proposal' is null and (f->>'startsAt')::timestamptz>now() and(f->>'startsAt')::timestamptz<=now()+make_interval(hours=>coalesce((p.settings->>'reminderHours')::integer,24)) and not exists(select 1 from dartflow_private.mail_events e where e.environment=$1 and e.event_id='season-reminder:'||s.id::text||':'||(f->>'id')||':'||(f->>'startsAt'))))order by s.updated_at,s.id limit 20 for update of s skip locked`,[runtime.environment]);let planned=0;
 for(const row of rows.rows){const s=row.state,now=Date.now();let changed=false;
  for(const f of s.fixtures){if(final.has(f.status))continue;const overdue=now>=Date.parse(f.windowEnd),at=overdue?f.windowEnd:f.startsAt;if(!at)continue;
   if(overdue){if(f.overdue?.since===at)continue;f.overdue={since:at,reason:'Speelvenster verstreken. Wedstrijdleiding moet een gemotiveerde vervolgstap kiezen.'};changed=true;await mailAudit(client,null,'season-window-elapsed',{seasonId:s.id,fixtureId:f.id,windowEnd:at});}
   else if(f.status!=='scheduled'||f.proposal||Date.parse(at)<=now||Date.parse(at)>now+Number(row.policy?.reminderHours??24)*3600000||row.policy?.paused===true)continue;
   const kind=overdue?'season-overdue':'season-reminder',date=new Date(at);for(const recipientId of await seasonMailRecipients(client,s,f,overdue)){const id=await enqueueDomainMail(client,{id:`${kind}:${s.id}:${f.id}:${at}`,templateId:overdue?'fixture-overdue':'fixture-reminder',scope:scope(s),recipientId,entityId:s.id,...(!overdue?{expiresAt:at}:{}),reminder:{kind,fixtureId:f.id,at},variables:{eventName:s.name,opponentName:opponentName(s,f,recipientId),date:date.toLocaleDateString('nl-NL',{timeZone:s.settings.timezone,dateStyle:'long'}),time:date.toLocaleTimeString('nl-NL',{timeZone:s.settings.timezone,hour:'2-digit',minute:'2-digit'}),actionUrl:`/app/competities/${s.id}`}});if(id)planned++;}
  }
  if(changed){s.revision++;await client.query('update dartflow_private.competition_seasons set state=$2,revision=$3,updated_at=now()where id=$1',[s.id,JSON.stringify(s),s.revision]);}
 }return planned;
}
