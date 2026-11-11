import {createHmac} from 'node:crypto';
import {DomainError} from './domain';
import {signalAccess} from './platform';
import {transaction} from './platform-store';

export function turnCredentials(actorId:string,matchId:string,secret:string,urls:string[],now=Date.now()) {
  const expiresAt=Math.floor(now/1000)+600;
  const username=`${expiresAt}:${actorId}:${matchId}`;
  return {urls,username,credential:createHmac('sha1',secret).update(username).digest('base64'),expiresAt};
}

export async function mediaConfiguration(actorId:string,matchId:string) {
  return transaction(async client=>{
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`media:${actorId}`]);
    const players=await signalAccess(client,actorId,matchId);
    const {rows:states}=await client.query<{status:string;first_player:string}>("select state->>'status' as status,state#>>'{players,0,id}' as first_player from dartflow_private.matches where id=$1",[matchId]);
    if(!['called','ready','live','result','disputed'].includes(states[0]?.status))throw new DomainError('media_closed','Beeld delen is beschikbaar tijdens een actieve wedstrijd.',409);
    const {rows:counts}=await client.query<{count:number}>(`select count(*)::int as count from dartflow_private.platform_signals where sender_id=$1 and kind='preflight' and payload->>'purpose'='turn-credential' and created_at>now()-interval '1 minute'`,[actorId]);
    if(counts[0].count>=6)throw new DomainError('media_rate_limit','Wacht even voordat je opnieuw verbinding maakt.',429);
    await client.query(`insert into dartflow_private.platform_signals(match_id,sender_id,kind,payload) values($1,$2,'preflight','{"purpose":"turn-credential"}')`,[matchId,actorId]);
    const secret=process.env.DARTFLOW_TURN_SECRET;
    const urls=(process.env.DARTFLOW_TURN_URLS || '').split(',').filter(Boolean);
    const iceServers=secret && urls.length ? [turnCredentials(actorId,matchId,secret,urls)] : [];
    return {actorId,peerId:players.find(id=>id!==actorId)!,isInitiator:states[0].first_player===actorId,relayConfigured:iceServers.length>0,iceServers};
  });
}
