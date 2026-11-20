import type{PoolClient}from'pg';
import{randomUUID}from'node:crypto';
import{DomainError}from'./domain';
import{requireCompetitionPlanningBoards,requireCompetitionPlanningWindow}from'./competition-planning-access';
import{wizardUuid}from'./competition-wizard-domain';
import type{SeasonState}from'./seasons-types';
import type{WizardSeasonState}from'./competition-wizard-types';
type Client=Pick<PoolClient,'query'>;
/** Called under the canonical season transaction, so a failed move changes neither schedule nor booking. */
export async function syncCompetitionWizardBookings(client:Client,source:SeasonState,actor=source.ownerId):Promise<void>{
 const s=source as WizardSeasonState,publication=s.competitionWizard;if(!publication)return;
 if(publication.planning.roundGating==='automatic')for(const round of s.rounds){const prerequisites=s.fixtures.filter(f=>f.round<round.number&&!f.classification);round.released=round.number===1||prerequisites.every(f=>['confirmed','administrative','canceled'].includes(f.status));}
 const booked=(await client.query<{fixture_id:string;revision:number;reservation_id:string;starts_at:Date;ends_at:Date;board_id:string;status:string}>(`select distinct on(w.fixture_id) w.fixture_id,w.revision,w.reservation_id,r.starts_at,r.ends_at,r.status,rb.board_id from dartflow_private.competition_wizard_bookings w join dartflow_private.board_reservations r on r.id=w.reservation_id join dartflow_private.reservation_boards rb on rb.reservation_id=r.id where w.season_id=$1 order by w.fixture_id,w.revision desc`,[s.id])).rows;
 for(const f of s.fixtures){const prior=booked.find(row=>row.fixture_id===f.id);if(!prior)continue;
  if(f.status==='canceled'&&!f.slots.some(slot=>slot.matchId)){if(prior.status==='accepted')await client.query("update dartflow_private.board_reservations set status='cancelled',revision=revision+1,reason='Afzonderlijk geannuleerde competitie-ontmoeting'where id=$1",[prior.reservation_id]);continue;}
  if(!f.startsAt||!f.endsAt||f.boardIds.length!==1)throw new DomainError('wizard_schedule_required','Deze gepubliceerde competitie gebruikt één expliciet geboekte baan en tijdvak per ontmoeting.',409);
  if(prior.starts_at.toISOString()===f.startsAt&&prior.ends_at.toISOString()===f.endsAt&&prior.board_id===f.boardIds[0])continue;
  if(f.slots.some(slot=>slot.matchId))throw new DomainError('match_exists','Een gespeelde of gestarte ontmoeting behoudt haar historische boeking. Gebruik de bestaande onderbreek- en hervatprocedure.',409);
  const locations=await requireCompetitionPlanningBoards(client,s.clubId!,f.boardIds,true),loc=locations.find(l=>l.boards.some(b=>b.id===f.boardIds[0]))!;requireCompetitionPlanningWindow(loc,f.startsAt,f.endsAt);
  if(Date.parse(f.startsAt)<Date.now())throw new DomainError('planning_past','Een nieuwe planning ligt in de toekomst.',409);
  if((await client.query(`select 1 from dartflow_private.reservation_boards rb join dartflow_private.board_reservations r on r.id=rb.reservation_id where rb.board_id=$1 and r.id<>$2 and r.status='accepted'and r.starts_at<$4::timestamptz and $3::timestamptz<r.ends_at limit 1`,[f.boardIds[0],prior.reservation_id,f.startsAt,f.endsAt])).rowCount)throw new DomainError('board_conflict','De nieuwe baan is in dit tijdvak al geboekt.',409);
  const revision=prior.revision+1,reservation=wizardUuid(`${publication.draftId}:reservation:${f.id}:${revision}`);await client.query("update dartflow_private.board_reservations set status='cancelled',revision=revision+1,reason='Vervangen via gemotiveerde competitieherplanning'where id=$1",[prior.reservation_id]);
  await client.query("insert into dartflow_private.board_reservations(id,location_id,requester_id,club_id,event_id,starts_at,ends_at,board_count,max_matches,status,reason,decided_by,decided_at)values($1,$2,$3,$4,$5,$6,$7,1,$8,'accepted','Gemotiveerde competitieherplanning binnen expliciete planningsscope',$3,clock_timestamp())",[reservation,loc.id,actor,s.clubId,s.eventId,f.startsAt,f.endsAt,Math.max(1,f.slots.length)]);await client.query('insert into dartflow_private.reservation_boards(reservation_id,board_id)values($1,$2)',[reservation,f.boardIds[0]]);await client.query('insert into dartflow_private.competition_wizard_bookings(fixture_id,revision,draft_id,season_id,reservation_id)values($1,$2,$3,$4,$5)',[f.id,revision,publication.draftId,s.id,reservation]);
  f.windowStart=f.startsAt;f.windowEnd=f.endsAt;
  const frozen=publication.fixtures.find(row=>row.id===f.id),previous=frozen?structuredClone(frozen):null;if(frozen)Object.assign(frozen,{startsAt:f.startsAt,endsAt:f.endsAt,boardId:f.boardIds[0],locationId:loc.id});publication.scheduleRevision++;
  s.decisions.push({id:randomUUID(),actorId:actor,at:new Date().toISOString(),action:'wizard.reschedule',reason:'Bestaande gemotiveerde seizoenwijziging: oude boeking behouden als vervallen versie, nieuwe boeking atomair gecontroleerd.',fixtureId:f.id,previous});
 }
}
