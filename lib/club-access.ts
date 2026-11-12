import type { PoolClient } from 'pg';
import {CLUB_PERMISSIONS,type ClubPermission} from './club-types';
type Client=Pick<PoolClient,'query'>;
export async function clubIsActiveMember(client:Client,clubId:string,actor:string):Promise<boolean>{
 const {rows}=await client.query(`select e.state,m.status,m.role,e.owner_id,c.user_id as core_member from dartflow_private.clubs c0 left join dartflow_private.platform_entities e on e.id=c0.id and e.kind='club' left join dartflow_private.platform_members m on m.entity_id=e.id and m.user_id=$2 left join dartflow_private.club_memberships c on c.club_id=c0.id and c.user_id=$2 where c0.id=$1`,[clubId,actor]);
 const row=rows[0];return Boolean(row?.core_member&&(!row.state||(row.status==='active'&&!['inactive','deleted'].includes(String(row.state.lifecycle)))));
}
export async function clubPermission(client:Client,clubId:string,actor:string,permission:ClubPermission):Promise<boolean>{
 if(!CLUB_PERMISSIONS.includes(permission))return false;
 const {rows}=await client.query(`select e.owner_id,e.state,m.status,m.role,c.role as core_role from dartflow_private.clubs c0 left join dartflow_private.platform_entities e on e.id=c0.id and e.kind='club' left join dartflow_private.platform_members m on m.entity_id=e.id and m.user_id=$2 left join dartflow_private.club_memberships c on c.club_id=c0.id and c.user_id=$2 where c0.id=$1`,[clubId,actor]);
 const row=rows[0];if(!row?.core_role)return false;if(!row.state)return row.core_role==='organizer';
 if(row.status!=='active'||['inactive','deleted'].includes(String(row.state.lifecycle)))return false;
 if(row.owner_id===actor||row.role==='admin')return true;
 return Boolean((await client.query(`select 1 from dartflow_private.club_member_roles m join dartflow_private.club_roles r on r.club_id=m.club_id and r.id=m.role_id where m.club_id=$1 and m.user_id=$2 and $3=any(r.permissions)`,[clubId,actor,permission])).rowCount);
}
export async function clubReviewerMailApplicable(client:Client,clubId:string,recipient:string,eventId:string):Promise<boolean>{
 if(!await clubPermission(client,clubId,recipient,'members.approve'))return false;
 const requestId=eventId.match(/^club-request:([0-9a-f-]{36}):reviewers$/i)?.[1];
 return !requestId||Boolean((await client.query("select 1 from dartflow_private.club_join_requests where id=$1 and club_id=$2 and status='pending'",[requestId,clubId])).rowCount);
}
export async function clubInvitationMailApplicable(client:Client,clubId:string,recipient:string,eventId:string):Promise<boolean>{
 const inviteId=eventId.match(/^club-invite:([0-9a-f-]{36})$/i)?.[1];if(!inviteId)return false;
 return Boolean((await client.query("select 1 from dartflow_private.club_invites i join dartflow_private.platform_entities e on e.id=i.club_id where i.id=$1 and i.club_id=$2 and i.user_id=$3 and i.status='pending' and i.expires_at>now() and coalesce(e.state->>'lifecycle','active')='active'",[inviteId,clubId,recipient])).rowCount);
}
