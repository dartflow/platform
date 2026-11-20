import {DomainError} from './domain';
import {getMatch} from './db';
import {getSeason} from './seasons';
import {clubIsActiveMember,clubPermission} from './club-access';
import {entity,requireAccess} from './platform-store';
import {canManageNotifications} from './notification-core';
import type {NotificationClient} from './notification-core';
import {safeNext} from './config';

/** Destination access is checked again just before delivery and on every tap. */
export async function notificationDestinationApplicable(client:NotificationClient,actor:string,href:string):Promise<boolean>{
 if(safeNext(href)!==href)return false;
 try{
  const admin=href.startsWith('/app/admin/')||href==='/app/premium';if(admin&&!await canManageNotifications(client,actor))return false;
  let m=/^\/app\/(?:admin\/)?support\/([0-9a-f-]{36})$/.exec(href);if(m)return Boolean((await client.query(`select 1 from dartflow_private.support_tickets where id=$1${admin?'':' and owner_id=$2'}`,admin?[m[1]]:[m[1],actor])).rowCount);
  m=/^\/app\/whats-new\/([0-9a-f-]{36})$/.exec(href);if(m)return Boolean((await client.query("select 1 from dartflow_private.product_releases where id=$1 and status='published'",[m[1]])).rowCount);
  m=/^\/wedstrijd\/([0-9a-f-]{36})$/.exec(href);if(m){await getMatch(actor,m[1]);return true;}
  m=/^\/app\/competities\/([0-9a-f-]{36})$/.exec(href);if(m){await getSeason(actor,m[1]);return true;}
  m=/^\/app\/clubs\/([0-9a-f-]{36})(?:\/([^/]+))?$/.exec(href);if(m){if(['beheer','manage','huisstijl'].includes(m[2]))return clubPermission(client,m[1],actor,'settings.edit');const e=await entity(client,m[1]);await requireAccess(client,e,actor);return !m[2]||await clubIsActiveMember(client,m[1],actor);}
  m=/^\/app\/(?:leagues|tournaments|lobby|hall|community)\/([0-9a-f-]{36})$/.exec(href);if(m){const e=await entity(client,m[1]);await requireAccess(client,e,actor);return true;}
  // Static pages show the authenticated account's own filtered projection.
  if(/^\/app\/[a-zA-Z-]+(?:\/[a-zA-Z-]+)?$/.test(href)||href==='/app')return true;
  return false;
 }catch(e){if(e instanceof DomainError&&[403,404,409].includes(e.status))return false;throw e;}
}
