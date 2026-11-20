import {NextRequest,NextResponse} from 'next/server';
import {DomainError} from './domain';
import {consumeRateLimit} from './db';
import {getNotificationSettings,getNotificationInbox,getNotificationAdmin,executeNotificationCommand,executeNotificationAdminCommand} from './notifications';
import {getProductReleases,getProductRelease,getProductReleaseAdmin,executeProductReleaseCommand} from './product-releases';
import {getPlatformMessage} from './notification-campaigns';
import {getWebPushDelivery} from './web-push';
import {nativePlayerPrincipal} from './native-player-context';
import type {NotificationCommand,NotificationAdminCommand} from './notification-types';
import type {ProductReleaseCommand} from './product-release-types';
const json=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'private, no-store','Pragma':'no-cache'}});
export async function handleCommunicationApi(request:NextRequest,parts:string[],actor:string,readBody:(request:NextRequest,max?:number)=>Promise<Record<string,unknown>>){
 const path=parts.join('/'),native=Boolean(nativePlayerPrincipal(request)),channel=native?'android':'web';
 if(!['notifications','product-releases'].includes(parts[0]))return null;
 if(request.method==='GET'){
  if(path==='notifications')return json(await getNotificationInbox(actor,channel));
  if(path==='notifications/settings')return json(await getNotificationSettings(actor,channel));
  if(path==='notifications/admin')return json(await getNotificationAdmin(actor));
  if(parts[0]==='notifications'&&parts[1]==='messages'&&parts.length===3)return json({message:await getPlatformMessage(actor,parts[2])});
  if(parts[0]==='notifications'&&parts[1]==='delivery'&&parts.length===3&&!native)return json(await getWebPushDelivery(actor,parts[2],request.nextUrl.searchParams.get('subscriptionId'),request.nextUrl.searchParams.get('installationId')));
  if(path==='product-releases')return json(await getProductReleases(actor,request.nextUrl.searchParams.get('product')??'dartflow',request.nextUrl.searchParams.get('channel')??channel));
  if(path==='product-releases/admin')return json(await getProductReleaseAdmin(actor));
  if(parts[0]==='product-releases'&&parts.length===2)return json({release:await getProductRelease(actor,parts[1])});
 }
 if(request.method==='POST'){
  const rate=await consumeRateLimit(`communications:${actor}`,60,60);if(!rate.allowed)throw new DomainError('rate_limited','Wacht even voordat je opnieuw probeert.',429);
  if(path==='notifications/actions')return json(await executeNotificationCommand(actor,await readBody(request,16000) as NotificationCommand));
  if(path==='notifications/admin/actions')return json(await executeNotificationAdminCommand(actor,await readBody(request,100000) as NotificationAdminCommand));
  if(path==='product-releases/admin/actions')return json(await executeProductReleaseCommand(actor,await readBody(request,70000) as ProductReleaseCommand));
 }throw new DomainError('not_found','Deze route bestaat niet.',404);
}
