import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import {normalizeDisplayName, requiresDisplayName, validDisplayName} from './display-name';
import type {MatchState} from './types';

export async function requireScoreboardName(client: Pick<PoolClient,'query'>, actor: string): Promise<void> {
  const {rows} = await client.query('select name,display_name_confirmed as "displayNameConfirmed" from dartflow_private.profiles where id=$1',[actor]);
  if (!rows[0] || requiresDisplayName(rows[0])) throw new DomainError('display_name_required','Bevestig eerst je unieke gebruikersnaam om te spelen.',409);
}

/** Called inside the existing command transaction. Keep completed result snapshots intact. */
export async function saveScoreboardName(client: PoolClient, actor: string, value: unknown): Promise<void> {
  const name=normalizeDisplayName(value);
  if (!validDisplayName(name)) throw new DomainError('display_name','Vul een gebruikersnaam in van maximaal 80 tekens, met minstens één letter of cijfer. Kies een eigen naam in plaats van Nieuwe speler.');
  // Match commands take event locks before match locks; use the same order here.
  const scope=await client.query("select distinct m.event_id from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id where p.user_id=$1 and m.state->>'status'<>'confirmed' order by m.event_id",[actor]);
  for(const row of scope.rows)await client.query('select id from dartflow_private.events where id=$1 for update',[row.event_id]);
  try{await client.query('update dartflow_private.profiles set name=$2,display_name_confirmed=true where id=$1',[actor,name]);}
  catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505'&&'constraint' in error&&error.constraint==='profiles_unique_confirmed_username')throw new DomainError('username_taken','Deze gebruikersnaam is al in gebruik. Kies een andere naam.',409);throw error;}
  const {rows}=await client.query<{state:MatchState}>("select m.state from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id where p.user_id=$1 and m.state->>'status'<>'confirmed' order by m.id for update of m",[actor]);
  for(const {state} of rows){
    const player=state.players.find(p=>p.id===actor);
    if(player && player.name!==name){player.name=name;state.revision++;await client.query('update dartflow_private.matches set state=$2,revision=$3,updated_at=now() where id=$1',[state.id,JSON.stringify(state),state.revision]);}
  }
}
