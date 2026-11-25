import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {clubPermission} from './club-access';
import {communityScope,getCommunityChat} from './community';
import {requireCommunityRules} from './player-safety';
import {text,uuid,number,type Client} from './platform-store';
import type {ClubChannel,ClubChannelPage} from './clubhouse-types';
type ChannelRow={id:string;club_id:string;name:string;kind:'team'|'board';team_id:string|null;write_policy:'members'|'managers';active:boolean;revision:number};
export async function channelAccess(client:Client,actor:string,clubId:string,channelId:string):Promise<{channel:ClubChannel;row:ChannelRow|null}>{
 const scope=await communityScope(client,actor,'club',clubId,true),manage=await clubPermission(client,clubId,actor,'channels.manage');
 if(channelId===clubId)return {channel:{id:clubId,name:'Algemeen',kind:'general',teamId:null,canWrite:scope.canWrite,unread:0,revision:0,canManage:manage,canModerate:scope.canModerate},row:null};
 const row=(await client.query<ChannelRow>('select * from dartflow_private.club_channels where id=$1 and club_id=$2 and active',[uuid(channelId),clubId])).rows[0];if(!row)throw new DomainError('not_found','Dit kanaal is niet beschikbaar.',404);
 if(row.kind==='team'){
  const team=(await client.query('select member_ids,reserve_ids,active from dartflow_private.club_teams where id=$1 and club_id=$2',[row.team_id,clubId])).rows[0];
  if(!team?.active||!manage&&![...team.member_ids,...team.reserve_ids].includes(actor))throw new DomainError('forbidden','Dit kanaal is uitsluitend voor de huidige teamleden.',403);
 }else if(!manage&&!await clubPermission(client,clubId,actor,'settings.edit'))throw new DomainError('forbidden','Dit is een besloten bestuurskanaal.',403);
 return {row,channel:{id:row.id,name:row.name,kind:row.kind,teamId:row.team_id,canWrite:scope.canWrite&&(row.write_policy==='members'||manage),unread:0,revision:row.revision,canManage:manage,canModerate:scope.canModerate}};
}
export async function readClubChannels(client:Client,actor:string,clubId:string):Promise<ClubChannel[]>{
 const ids=[clubId,...(await client.query('select id from dartflow_private.club_channels where club_id=$1 and active order by name,id',[clubId])).rows.map(r=>r.id)],channels:ClubChannel[]=[];
 for(const id of ids){try{
  const {channel}=await channelAccess(client,actor,clubId,id);
  const sql=id===clubId?`select count(*)::int as n from dartflow_private.community_messages m where m.scope_kind='club' and m.scope_id=$1 and m.author_id<>$2 and not m.deleted and m.sequence>coalesce((select cursor from dartflow_private.club_general_chat_reads r where r.club_id=$1 and r.user_id=$2),0)`:`select count(*)::int as n from dartflow_private.club_channel_messages m where m.channel_id=$1 and m.author_id<>$2 and not m.deleted and m.sequence>coalesce((select cursor from dartflow_private.club_channel_reads r where r.channel_id=$1 and r.user_id=$2),0)`;
  channel.unread=(await client.query(sql+` and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$2 and b.target_id=m.author_id) or(b.target_id=$2 and b.source_id=m.author_id)))`,[id,actor])).rows[0].n;channels.push(channel);
 }catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}}
 return channels;
}
export async function readClubChannel(client:Client,actor:string,clubId:string,channelId:string,after=0,before=0):Promise<ClubChannelPage>{
 if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(before)||before<0||after>0&&before>0)throw new DomainError('invalid_cursor','Ongeldig synchronisatiepunt.');
 const {channel}=await channelAccess(client,actor,clubId,channelId);
 if(channelId===clubId){const page=await getCommunityChat(actor,'club',clubId,after,before);return {channel,messages:page.messages,cursor:page.cursor,hasMoreBefore:page.hasMoreBefore??false,nextBefore:page.nextBefore??null};}
 const rows=(await client.query<ClubChannelPage['messages'][number]>(`select * from(select m.id,m.sequence::float8 as sequence,m.author_id as "authorId",p.name as "authorName",case when deleted then '' else body end as body,deleted,m.created_at as "createdAt" from dartflow_private.club_channel_messages m join dartflow_private.profile_labels p on p.id=m.author_id where m.channel_id=$1 and ($2=0 or m.sequence>$2) and ($4=0 or m.sequence<$4) and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$3 and b.target_id=m.author_id) or(b.target_id=$3 and b.source_id=m.author_id))) order by case when $2=0 then -m.sequence else m.sequence end limit 101) recent order by sequence`,[channelId,after,actor,before])).rows;
 const hasMoreBefore=after===0&&rows.length>100,messages=after===0?rows.slice(-100):rows.slice(0,100);return {channel,messages,cursor:messages.at(-1)?.sequence??after,hasMoreBefore,nextBefore:hasMoreBefore?messages[0].sequence:null};
}
export async function clubChannelAction(client:Client,actor:string,clubId:string,a:Record<string,unknown>,expected?:number){
 const type=String(a.type);
 if(type==='channel.save'||type==='channel.archive'){
  if(!await clubPermission(client,clubId,actor,'channels.manage'))throw new DomainError('forbidden','Je mag geen kanalen beheren.',403);
  const id=a.id?uuid(a.id):randomUUID(),old=(await client.query<ChannelRow>('select * from dartflow_private.club_channels where id=$1 and club_id=$2 for update',[id,clubId])).rows[0];
  if(a.id&&!old)throw new DomainError('not_found','Dit kanaal hoort niet bij deze vereniging.',404);if((expected??0)!==(old?.revision??0))throw new DomainError('revision_conflict','Dit kanaal is elders gewijzigd.',409);
  if(type==='channel.archive'){await client.query('update dartflow_private.club_channels set active=false,revision=revision+1 where id=$1',[id]);return;}
  const kind=String(a.kind),teamId=kind==='team'?uuid(a.teamId):null,policy=String(a.writePolicy??'members');if(!['team','board'].includes(kind)||!['members','managers'].includes(policy))throw new DomainError('invalid_channel','Kies een geldig kanaaltype en schrijfrecht.');
  if(teamId&&!(await client.query('select 1 from dartflow_private.club_teams where id=$1 and club_id=$2 and active',[teamId,clubId])).rowCount)throw new DomainError('invalid_team','Kies een huidig eigen team.');
  await client.query('insert into dartflow_private.club_channels(id,club_id,name,kind,team_id,write_policy)values($1,$2,$3,$4,$5,$6)on conflict(id)do update set name=excluded.name,kind=excluded.kind,team_id=excluded.team_id,write_policy=excluded.write_policy,revision=club_channels.revision+1',[id,clubId,text(a.name,80),kind,teamId,policy]);return;
 }
 const id=uuid(a.channelId),{channel}=await channelAccess(client,actor,clubId,id);
 if(type==='channel.read'){
  const cursor=number(a.cursor,0,0,Number.MAX_SAFE_INTEGER),maximum=(await client.query(id===clubId?"select coalesce(max(sequence),0)::float8 as n from dartflow_private.community_messages where scope_kind='club' and scope_id=$1":'select coalesce(max(sequence),0)::float8 as n from dartflow_private.club_channel_messages where channel_id=$1',[id])).rows[0].n;
  if(cursor>maximum)throw new DomainError('invalid_cursor','Dit synchronisatiepunt ligt na het laatste bericht.');
  if(id===clubId)await client.query('insert into dartflow_private.club_general_chat_reads(club_id,user_id,cursor)values($1,$2,$3)on conflict(club_id,user_id)do update set cursor=greatest(club_general_chat_reads.cursor,excluded.cursor)',[clubId,actor,cursor]);
  else await client.query('insert into dartflow_private.club_channel_reads(channel_id,user_id,cursor)values($1,$2,$3)on conflict(channel_id,user_id)do update set cursor=greatest(club_channel_reads.cursor,excluded.cursor)',[id,actor,cursor]);return;
 }
 if(type==='channel.message'){
  await requireCommunityRules(client,actor);if(!channel.canWrite)throw new DomainError('chat_muted','Je kunt hier geen bericht plaatsen.',403);
  if(id===clubId)await client.query("insert into dartflow_private.community_messages(id,scope_kind,scope_id,author_id,body)values($1,'club',$2,$3,$4)",[randomUUID(),id,actor,text(a.body,2000)]);else await client.query('insert into dartflow_private.club_channel_messages(id,channel_id,author_id,body)values($1,$2,$3,$4)',[randomUUID(),id,actor,text(a.body,2000)]);return;
 }
 if(type==='channel.message.delete'){
  const message=(await client.query(id===clubId?"select author_id from dartflow_private.community_messages where id=$1 and scope_kind='club' and scope_id=$2 for update":'select author_id from dartflow_private.club_channel_messages where id=$1 and channel_id=$2 for update',[uuid(a.messageId),id])).rows[0];if(!message)throw new DomainError('not_found','Dit bericht bestaat niet.',404);
  if(message.author_id!==actor&&!await clubPermission(client,clubId,actor,'chat.moderate'))throw new DomainError('forbidden','Je kunt dit bericht niet verwijderen.',403);
  await client.query(id===clubId?'update dartflow_private.community_messages set deleted=true,sequence=default where id=$1 and not deleted':'update dartflow_private.club_channel_messages set deleted=true,sequence=default where id=$1 and not deleted',[a.messageId]);return;
 }
 throw new DomainError('invalid_action','Onbekende kanaalactie.');
}
