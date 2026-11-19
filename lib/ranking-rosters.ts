import type{PoolClient}from'pg';
import{DomainError}from'./domain';
import{uuid,text}from'./platform-store';
import type{MatchState}from'./types';
type Client=Pick<PoolClient,'query'>;
export type RankingRosterReconfirmation={matchId:string;version:number;players:{id:string;name:string}[];reason:string;accepted:boolean};

export async function revokeUnthrownSeasonAdmission(client:PoolClient,state:MatchState,actor:string,reason:string,newPlayers:string[]):Promise<void>{
 const thrown=(await client.query("select 1 from dartflow_private.audit_events where match_id=$1 and action='score'limit 1",[state.id])).rowCount;
 if(thrown||state.game.visits.length||state.previousSets.length)throw new DomainError('ranking_roster_after_throw','Een reservewissel is alleen mogelijk vóór de eerste werkelijk gegooide pijl, ook als die later is teruggedraaid.',409);
 try{await client.query('select dartflow_private.revoke_unthrown_season_ranking($1,$2,$3::uuid[],$4,$5)',[state.id,state.revision,newPlayers.map(uuid),uuid(actor),text(reason,1000)]);}
 catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='42501')throw new DomainError('ranking_admission_locked','De oude toelating kan niet veilig vóór de eerste worp worden vervangen. Vernieuw de ontmoeting.',409);throw error;}
}

export async function rosterReconfirmations(client:Client,entityId:string,actor:string,manager=false):Promise<RankingRosterReconfirmation[]>{
 const rows=(await client.query<{match_id:string;version:number;new_players:string[];reason:string;accepted:boolean}>(`select v.match_id,v.version,v.new_players,v.reason,exists(select 1 from dartflow_private.ranking_match_roster_confirmations c where c.match_id=v.match_id and c.version=v.version and c.player_id=$2)accepted
  from dartflow_private.platform_match_links l join dartflow_private.ranking_match_roster_versions v on v.match_id=l.match_id where l.entity_id=$1 and v.requires_consent and($3::boolean or $2=any(v.new_players))and not exists(select 1 from dartflow_private.ranking_match_roster_versions n where n.match_id=v.match_id and n.version>v.version)order by v.match_id`,[entityId,actor,manager])).rows;
 const result:RankingRosterReconfirmation[]=[];for(const row of rows){const labels=(await client.query<{id:string;name:string}>("select id,coalesce(nullif(display_name,''),name)name from dartflow_private.profiles where id=any($1::uuid[])order by array_position($1::uuid[],id)",[row.new_players])).rows;result.push({matchId:row.match_id,version:row.version,players:labels,reason:row.reason,accepted:row.accepted});}return result;
}

export async function acceptChangedRosters(client:PoolClient,entityId:string,actor:string,input:unknown):Promise<void>{
 const pending=(await rosterReconfirmations(client,entityId,actor)).filter(row=>!row.accepted);
 if(input!==undefined&&(!Array.isArray(input)||input.length>64))throw new DomainError('invalid_roster_confirmation','Ververs de gewijzigde partijopstellingen.');
 const supplied=(input??[])as unknown[];for(const item of supplied){if(!item||typeof item!=='object'||!('matchId'in item)||!('version'in item)||!Number.isSafeInteger(item.version))throw new DomainError('invalid_roster_confirmation','Ververs de gewijzigde partijopstellingen.');uuid(item.matchId);}
 for(const row of pending)if(!supplied.some(item=>(item as{matchId:string;version:number}).matchId===row.matchId&&(item as{version:number}).version===row.version))throw new DomainError('ranking_roster_confirmation_required','Bekijk de actuele gewijzigde tegenstanders en aanvaard hun opstellingsversie expliciet.',409);
 for(const item of supplied){const supplied=item as{matchId:string;version:number},current=(await rosterReconfirmations(client,entityId,actor)).find(row=>row.matchId===supplied.matchId);if(!current||current.version!==supplied.version)throw new DomainError('ranking_roster_revision_changed','De opstelling is opnieuw gewijzigd. Bekijk de actuele tegenstanders voordat je instemt.',409);
  await client.query('insert into dartflow_private.ranking_match_roster_confirmations(match_id,version,player_id)values($1,$2,$3)on conflict do nothing',[current.matchId,current.version,actor]);}
}

export async function assertRankingRosterConfirmed(client:Client,state:MatchState):Promise<void>{
 const row=(await client.query<{version:number;new_players:string[];requires_consent:boolean}>('select version,new_players,requires_consent from dartflow_private.ranking_match_roster_versions where match_id=$1 order by version desc limit 1',[state.id])).rows[0];if(!row?.requires_consent)return;
 if(row.new_players.some((player,index)=>player!==state.players[index]?.id))throw new DomainError('ranking_roster_revision_changed','De actuele opstelling wijkt af van de gepubliceerde nieuwe rankingtoelating.',409);
 const count=(await client.query('select 1 from dartflow_private.ranking_match_roster_confirmations where match_id=$1 and version=$2 and player_id=any($3::uuid[])',[state.id,row.version,row.new_players])).rowCount;
 if(count!==2)throw new DomainError('ranking_roster_confirmation_required','Beide spelers moeten de gewijzigde partijopstelling en rankinggevolgen opnieuw aanvaarden in het seizoensdossier.',409);
}
