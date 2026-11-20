import type {PoolClient,Pool}from'pg';
import type{MatchState,Profile}from'./types';
import{matchParticipants}from'./match-sides';
type Client=Pick<PoolClient|Pool,'query'>;
/** Refresh public identities by fixed IDs; historical labels are never a fallback. */
export async function projectMatchPublicPlayers(client:Client,state:MatchState):Promise<MatchState>{
 const ids=matchParticipants(state).map(p=>p.id);
 const rows=(await client.query<{id:string;name:string;username:string|null;displayName:string|null}>('select id,name,username,display_name as "displayName" from dartflow_private.profile_labels where id=any($1::uuid[])',[ids])).rows;
 const project=(p:Profile):Profile=>rows.find(row=>row.id===p.id)??{id:p.id,name:'Speler'};
 return{...state,players:state.players.map(project),...(state.sideParticipants?{sideParticipants:state.sideParticipants.map(side=>side.map(project))as[Profile[],Profile[]]}:{})};
}
/** Re-label stored result/draw/standing profile objects without changing source data. */
export async function projectPublicIdentitySnapshots<T>(client:Client,value:T):Promise<T>{
 const ids=new Set<string>(),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const collect=(node:unknown):void=>{if(Array.isArray(node)){node.forEach(collect);return;}if(!node||typeof node!=='object')return;const row=node as Record<string,unknown>;for(const key of ['id','playerId'])if(typeof row[key]==='string'&&uuid.test(row[key]))ids.add(row[key]);Object.values(row).forEach(collect);};collect(value);
 if(!ids.size)return structuredClone(value);
 const labels=(await client.query<{id:string;name:string;username:string|null;displayName:string|null}>('select id,name,username,display_name as "displayName" from dartflow_private.profile_labels where id=any($1::uuid[])',[[...ids]])).rows;
 const project=(node:unknown,context=''):unknown=>{if(Array.isArray(node))return node.map(item=>project(item,context));if(!node||typeof node!=='object')return node;const row=node as Record<string,unknown>,id=typeof row.playerId==='string'?row.playerId:typeof row.id==='string'?row.id:null,label=labels.find(p=>p.id===id),identity=Boolean(id&&(label||typeof row.playerId==='string'&&'name'in row||['players','sideParticipants','opponent'].includes(context)));
  const result=Object.fromEntries(Object.entries(row).filter(([key])=>!identity||!['fullName','full_name','email','email_verified','pin','pinConfigured'].includes(key)).map(([key,item])=>[key,project(item,key)]));
  if(identity){result.name=label?.name??'Speler';if('username'in row)result.username=label?.username??null;if('displayName'in row)result.displayName=label?.displayName??null;}
  return result;
 };return project(value)as T;
}
