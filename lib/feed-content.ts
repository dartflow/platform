import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {safeClubLogo} from './club-branding';
import {text,uuid,type Client} from './platform-store';
import type {FeedAttachment,FeedExtras} from './feed-content-types';
export async function readFeedExtras(client:Client,actor:string,itemId:string,canEdit:boolean,canPin=false,channel?:string):Promise<FeedExtras>{
 const item=(await client.query('select content_revision,pin_until,channel from dartflow_private.feed_items where id=$1',[itemId])).rows[0];
 const key=channel??item?.channel,policy=key?(await client.query('select max_pin_days from dartflow_private.feed_policies where channel=$1',[key])).rows[0]:null,controls={canPin,maxPinDays:policy?.max_pin_days??7,pinUntil:item?.pin_until&&new Date(item.pin_until).getTime()>Date.now()?new Date(item.pin_until).toISOString():null};
 const attachments=(await client.query<FeedAttachment>('select id,name,mime,data from dartflow_private.feed_attachments where item_id=$1 order by id',[itemId])).rows;
 const poll=(await client.query('select * from dartflow_private.feed_polls where item_id=$1',[itemId])).rows[0];
 if(!poll)return {...controls,revision:item?.content_revision??1,canEdit,attachments,poll:null};
 const votes=(await client.query<{option_id:string;n:number}>('select option_id,count(*)::int as n from dartflow_private.feed_poll_votes where poll_id=$1 group by option_id',[poll.id])).rows;
 const my=(await client.query<{option_id:string}>('select option_id from dartflow_private.feed_poll_votes where poll_id=$1 and user_id=$2 order by option_id',[poll.id,actor])).rows;
 return {...controls,revision:item?.content_revision??1,canEdit,attachments,poll:{id:poll.id,endsAt:new Date(poll.ends_at).toISOString(),multiple:poll.multiple,allowChange:poll.allow_change,options:poll.options.map((o:{id:string;label:string})=>({...o,votes:votes.find(v=>v.option_id===o.id)?.n??0})),myOptionIds:my.map(v=>v.option_id),totalVoters:(await client.query('select count(distinct user_id)::int as n from dartflow_private.feed_poll_votes where poll_id=$1',[poll.id])).rows[0].n,closed:new Date(poll.ends_at).getTime()<=Date.now()}};
}
export async function saveFeedAttachments(client:Client,itemId:string,value:unknown){
 if(value===undefined)return;
 if(!Array.isArray(value)||value.length>1)throw new DomainError('invalid_attachments','Voeg maximaal één afbeelding toe.');
 const attachments:FeedAttachment[]=[];
 for(const a of value){if(!a||typeof a!=='object')throw new DomainError('invalid_attachments','Kies een geldige afbeelding.');const data=await safeClubLogo(a.data);if(!data)throw new DomainError('invalid_attachments','De afbeelding ontbreekt.');attachments.push({id:randomUUID(),name:text(a.name,120),mime:'image/webp',data});}
 await client.query('delete from dartflow_private.feed_attachments where item_id=$1',[itemId]);
 for(const a of attachments)await client.query('insert into dartflow_private.feed_attachments(id,item_id,name,mime,data)values($1,$2,$3,$4,$5)',[a.id,itemId,a.name,a.mime,a.data]);
}
export async function createFeedPoll(client:Client,itemId:string,value:unknown){
 if(value===undefined||value===null)return;
 const p=value as {options:unknown;endsAt:unknown;multiple:unknown;allowChange:unknown};
 if(!p||!Array.isArray(p.options)||p.options.length<2||p.options.length>8||typeof p.multiple!=='boolean'||typeof p.allowChange!=='boolean')throw new DomainError('invalid_poll','Kies twee tot acht opties en geldige steminstellingen.');
 const labels=p.options.map(v=>text(v,80)),keys=labels.map(l=>l.normalize('NFKC').toLocaleLowerCase('nl'));
 const ends=typeof p.endsAt==='string'?Date.parse(p.endsAt):NaN;if(new Set(keys).size!==keys.length||!Number.isFinite(ends)||ends<=Date.now()||ends>Date.now()+90*86400_000)throw new DomainError('invalid_poll','Opties moeten uniek zijn. Kies een eindtijd binnen negentig dagen.');
 await client.query('insert into dartflow_private.feed_polls(id,item_id,ends_at,multiple,allow_change,options)values($1,$2,$3,$4,$5,$6)',[randomUUID(),itemId,new Date(ends).toISOString(),p.multiple,p.allowChange,JSON.stringify(labels.map(label=>({id:randomUUID(),label})))]);
}
export async function voteFeedPoll(client:Client,actor:string,itemId:string,value:unknown){
 const poll=(await client.query('select * from dartflow_private.feed_polls where item_id=$1 for update',[itemId])).rows[0];
 if(!poll||new Date(poll.ends_at).getTime()<=Date.now())throw new DomainError('poll_closed','Deze peiling is gesloten.',409);
 if(!Array.isArray(value)||value.length<1||value.length>8)throw new DomainError('invalid_vote','Kies ten minste één geldige optie.');const chosen=value.map(uuid).sort();
 if(new Set(chosen).size!==chosen.length||!poll.multiple&&chosen.length!==1||chosen.some(id=>!poll.options.some((o:{id:string})=>o.id===id)))throw new DomainError('invalid_vote','Deze stem past niet bij de opties en stemregels.');
 const previous=(await client.query<{option_id:string}>('select option_id from dartflow_private.feed_poll_votes where poll_id=$1 and user_id=$2 order by option_id',[poll.id,actor])).rows.map(r=>r.option_id);
 if(!poll.allow_change&&previous.length&&JSON.stringify(previous)!==JSON.stringify(chosen))throw new DomainError('vote_locked','Je stem kan bij deze peiling niet worden gewijzigd.',409);
 await client.query('delete from dartflow_private.feed_poll_votes where poll_id=$1 and user_id=$2',[poll.id,actor]);
 for(const option of chosen)await client.query('insert into dartflow_private.feed_poll_votes(poll_id,user_id,option_id)values($1,$2,$3)',[poll.id,actor,option]);
}
export async function auditFeedContent(client:Client,actor:string,itemId:string,action:string,detail:unknown={}){await client.query('insert into dartflow_private.feed_content_audit(id,item_id,actor_id,action,detail)values($1,$2,$3,$4,$5)',[randomUUID(),itemId,actor,action,JSON.stringify(detail)]);}
