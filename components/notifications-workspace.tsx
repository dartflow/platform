"use client";

import {useEffect,useRef,useState} from 'react';
import {safeNext} from '@/lib/config';
import type {NotificationCommand,NotificationInbox,NotificationResult,NotificationSettings,NotificationCategory,NotificationChannel} from '@/lib/notification-types';
import {CommunicationFeedback,CommunicationLoading,displayTime,useCommunicationCommand,useCommunicationResource} from './communication-ui';
import './support-release.css';

const channels:Record<NotificationChannel,string>={inbox:'Inbox',email:'E-mail',push:'Push'};

export function NotificationInboxPanel({compact=false}:{compact?:boolean}){
 const resource=useCommunicationResource<NotificationInbox>('/api/notifications');
 return <section className={`communication-workspace notification-inbox ${compact?'is-compact':''}`} aria-label="Jouw meldingen">
  {!compact&&<header className="communication-heading"><div><p className="eyebrow">Jouw DartFlow</p><h1>Jouw meldingen</h1><p>Open een melding om verder te gaan waar jij aan zet bent.</p></div><a className="button ghost" href="/app/settings/notifications">Meldingsinstellingen</a></header>}
  <CommunicationLoading loading={resource.loading} error={resource.error} onRetry={resource.refresh}/>
  {resource.data&&<><p className="muted-copy">{resource.data.unread} ongelezen</p><div className="communication-list">{resource.data.items.map(item=><a key={item.id} data-notification-id={item.id} className={`notification-item ${item.opened?'is-read':'is-unread'}`} href={`/app/notifications/${item.id}`}>
   <span className="notification-indicator" aria-hidden="true"/><span><strong>{item.title}</strong><span className="notification-body">{item.body}</span><small>{item.category} · <time dateTime={item.createdAt}>{displayTime(item.createdAt)}</time> · {item.opened?'Gelezen':'Ongelezen'}</small></span><span aria-hidden="true">›</span>
  </a>)}</div>{!resource.data.items.length&&<div className="communication-empty"><h2>Je bent bij</h2><p>Je hebt nog geen meldingen. Nieuwe reacties, uitnodigingen en updates vind je hier.</p></div>}</>}
  {compact&&<div className="button-row"><a className="button ghost" href="/app/notifications">Alle meldingen</a><a className="button ghost" href="/app/settings/notifications">Instellingen</a></div>}
 </section>;
}

export function NotificationOpenWorkspace({id}:{id:string}){
 const [notice,setNotice]=useState('');
 const request=useRef<NotificationCommand|null>(null);
 const command=useCommunicationCommand<NotificationCommand,NotificationResult>('/api/notifications/actions',result=>{
  if(result.available&&result.href){window.location.assign(new URL(safeNext(result.href),window.location.origin).href);return;}
  setNotice(result.message??'Deze bestemming is niet meer beschikbaar.');
 });
 const send=command.send;
 useEffect(()=>{request.current??={requestId:crypto.randomUUID(),action:{type:'notification.open',id}};void send(request.current);},[id,send]);
 return <section className="communication-workspace"><header className="communication-heading"><h1>Melding openen</h1></header>{!notice&&!command.error&&<p role="status">De actuele bestemming wordt gecontroleerd…</p>}<CommunicationFeedback {...command} onRetry={()=>void command.send()}/>{notice&&<p className="notice" role="status">{notice}</p>}<a className="button" href="/app/notifications">Terug naar jouw meldingen</a></section>;
}

function installationId(){
 const key='dartflow-webpush-installation-v1',current=localStorage.getItem(key);
 if(current&&/^[a-f0-9-]{36}$/i.test(current))return current;
 const id=crypto.randomUUID();localStorage.setItem(key,id);return id;
}
function applicationKey(value:string){
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
 return Uint8Array.from(raw,character=>character.charCodeAt(0));
}

function BrowserPushSettings({settings,onChange}:{settings:NotificationSettings['webPush'];onChange:()=>void}){
 const [supported,setSupported]=useState(false),[permission,setPermission]=useState<NotificationPermission>('default'),[subscribed,setSubscribed]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const command=useCommunicationCommand<NotificationCommand,NotificationResult>('/api/notifications/actions',(_result,current)=>{onChange();setNotice('Toestelkeuze opgeslagen.');if(current.action.type==='webpush.revoke'){setSubscribed(false);void navigator.serviceWorker.getRegistration('/').then(async registration=>{await(await registration?.pushManager.getSubscription())?.unsubscribe();}).catch(()=>setError('De registratie is op de server ingetrokken. Controleer ook de site-instellingen van je browser.'));}else if(current.action.type==='webpush.register')setSubscribed(true);});
 useEffect(()=>{
  const available=window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
  setSupported(available);if(!available)return;setPermission(Notification.permission);
  let active=true;void navigator.serviceWorker.getRegistration('/').then(registration=>registration?.pushManager.getSubscription()).then(subscription=>{if(active)setSubscribed(Boolean(subscription));}).catch(()=>{});
  return()=>{active=false;};
 },[]);
 async function enable(){
  setBusy(true);setError('');setNotice('');try{
   if(!settings.publicKey)throw Error('Browserpush is nog niet ingericht. Je inbox blijft beschikbaar.');
   const permission=await Notification.requestPermission();setPermission(permission);if(permission!=='granted')throw Error('Je browser heeft geen toestemming gegeven. Pas dit aan bij de site-instellingen van je browser.');
   await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});const registration=await navigator.serviceWorker.ready;
   const subscription=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(settings.publicKey)});
   const raw=subscription.toJSON();if(!raw.endpoint||!raw.keys?.p256dh||!raw.keys.auth)throw Error('Het browserabonnement is niet volledig.');
   const result=await command.send({requestId:crypto.randomUUID(),action:{type:'webpush.register',installationId:installationId(),subscription:{endpoint:raw.endpoint,keys:{p256dh:raw.keys.p256dh,auth:raw.keys.auth}}}});
   if(result)setSubscribed(true);
  }catch(error){setError(error instanceof Error?error.message:'Browserpush inschakelen is niet gelukt.');}finally{setBusy(false);}
 }
 async function disable(){
  setBusy(true);setError('');setNotice('');try{
   const result=await command.send({requestId:crypto.randomUUID(),action:{type:'webpush.revoke',installationId:installationId()}});
   if(!result)return;
   const registration=await navigator.serviceWorker.getRegistration('/');await(await registration?.pushManager.getSubscription())?.unsubscribe();setSubscribed(false);
  }catch(error){setError(error instanceof Error?error.message:'Intrekken is niet gelukt.');}finally{setBusy(false);}
 }
 return <section className="panel notification-device"><h2>Meldingen op dit toestel</h2><p>{!supported?'Deze browser ondersteunt hier geen pushmeldingen.':permission==='denied'?'Toestemming geweigerd in de browser.':subscribed?'Deze browser is aangemeld voor push.':permission==='granted'?'Browsertoestemming gegeven; meld dit toestel aan om push te ontvangen.':'Browsertoestemming is nog niet gegeven.'}</p><p className="muted-copy">{settings.publicKey&&settings.supported?'De browserverzendkoppeling is ingericht.':'Browserpush is nog niet ingericht.'} Accountvoorkeuren blijven apart bewaard. Je inbox werkt ook zonder toestelpush.</p>
  <CommunicationFeedback error={error||command.error} retry={command.retry} busy={busy||command.busy} onRetry={()=>void command.send()}/>{notice&&<p role="status">{notice}</p>}
  <div className="button-row">{supported&&!subscribed&&<button className="button" disabled={busy||command.busy||!settings.publicKey||permission==='denied'} onClick={()=>void enable()}>Push inschakelen in deze browser</button>}{supported&&subscribed&&<button className="button ghost" disabled={busy||command.busy} onClick={()=>void disable()}>Dit toestel afmelden</button>}</div>
  {permission==='denied'&&<p>Open de site-instellingen via het pictogram naast het webadres en wijzig daar de toestemming voor meldingen.</p>}
 </section>;
}

export default function NotificationSettingsWorkspace(){
 const resource=useCommunicationResource<NotificationSettings>('/api/notifications/settings'),[notice,setNotice]=useState('');
 const command=useCommunicationCommand<NotificationCommand,NotificationResult>('/api/notifications/actions',()=>{resource.refresh();setNotice('Je meldingsvoorkeur is opgeslagen.');});
 function update(category:NotificationCategory,channel:NotificationChannel,enabled:boolean){setNotice('');void command.send({requestId:crypto.randomUUID(),action:{type:'preference.set',category,channel,enabled}});}
 return <div className="communication-workspace"><header className="communication-heading"><div><p className="eyebrow">Instellingen</p><h1>Meldingen</h1><p>Kies per categorie hoe DartFlow je bereikt. Inlogcodes en accountherstel volgen hun eigen systeemflow.</p></div><a className="button ghost" href="/app/settings">Terug naar instellingen</a></header>
  <CommunicationLoading loading={resource.loading} error={resource.error} onRetry={resource.refresh}/><CommunicationFeedback {...command} onRetry={()=>void command.send()}/>{notice&&<p className="notice" role="status">{notice}</p>}
  {resource.data&&<><section className="panel notification-preferences" aria-label="Kanaalvoorkeuren"><div className="notification-preference-header"><strong>Categorie</strong><span>Inbox</span><span>E-mail</span><span>Push</span></div>{resource.data.categories.map(item=><div className="notification-preference-row" key={item.category}><strong>{item.category}</strong>{(['inbox','email','push']as const).map(channel=>{const option=item.channels.find(value=>value.channel===channel);return <div key={channel}>{option?.applicable?<label><input type="checkbox" aria-label={`${item.category} ${channels[channel]}`} checked={option.personalEnabled} disabled={command.busy||command.retry||resource.loading||option.mode==='on'||option.mode==='off'} onChange={event=>update(item.category,channel,event.target.checked)}/><span className="sr-only">{channels[channel]}</span><small>{option.mode==='on'?'Beheer: aan':option.mode==='off'?'Beheer: uit':option.mode==='mixed'?'Deels door beheer':option.effectiveEnabled?'Aan':'Uit'}</small></label>:<span aria-label={`${channels[channel]} niet van toepassing`}>—</span>}</div>;})}</div>)}<p className="muted-copy">Bij een beheerregel blijft jouw persoonlijke keuze bewaard. Zodra beheer weer jouw voorkeur volgt, geldt die keuze opnieuw. Een beheerregel geeft je toestel geen toestemming.</p></section><section className="panel"><h2>Productupdates volgen</h2><p>Ontvang alleen de productupdates waarvoor je bent aangemeld. De kanaalvoorkeuren hierboven bepalen hoe die je bereiken.</p>{resource.data.subscriptions.map(subscription=><label key={`${subscription.product}:${subscription.channel}`} className="workspace-checkbox"><input type="checkbox" checked={subscription.enabled} disabled={command.busy||command.retry} onChange={event=>void command.send({requestId:crypto.randomUUID(),action:{type:'product.subscribe',product:subscription.product,channel:subscription.channel,enabled:event.target.checked}})}/>{subscription.product==='dartflow'?'DartFlow':'Oche Live'} · {subscription.channel==='web'?'Web/PWA':'Android'}</label>)}</section><BrowserPushSettings settings={resource.data.webPush} onChange={resource.refresh}/><p><a href="/app/notifications">Open jouw meldingen</a></p></>}
 </div>;
}
