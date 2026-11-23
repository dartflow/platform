"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {ChatPage,CommunityKind,CommunityScope,FeedPage,FeedPost} from '@/lib/community-types';
import './community-space.css';
import {CommunityRulesGate,SafetyActions} from './player-safety';

async function readJson<T>(url:string,signal?:AbortSignal):Promise<T>{
 const response=await fetch(url,{cache:'no-store',signal:signal||AbortSignal.timeout(10000)}),data=await response.json();
 if(!response.ok)throw Object.assign(new Error(typeof data.error==='string'?data.error:'Dit onderdeel is niet beschikbaar.'),{status:response.status});
 return data;
}
type Action=Record<string,unknown>&{type:string};
async function writeAction(action:Action,requestId:string){
 const response=await fetch('/api/platform/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,action}),signal:AbortSignal.timeout(15000)}),data=await response.json();
 if(!response.ok)throw Object.assign(new Error(typeof data.error==='string'?data.error:'De actie is niet uitgevoerd.'),{status:response.status});return data;
}
const scopeKey=(scope:Pick<CommunityScope,'kind'|'id'>)=>`${scope.kind}:${scope.id}`;
const time=(value:string)=>new Date(value).toLocaleString('nl-NL',{dateStyle:'short',timeStyle:'short'});
const terminal=(error:unknown)=>error&&typeof error==='object'&&'status'in error&&[401,403,404].includes(Number(error.status));
type FeedSpaceProps={actorId:string;kind?:'my'|CommunityKind;scopeId?:string;compact?:boolean};
export function FeedSpace({actorId,kind='my',scopeId='',compact=false}:FeedSpaceProps){
 const [page,setPage]=useState<FeedPage|null>(null),[error,setError]=useState(''),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[composeScope,setComposeScope]=useState(''),[thread,setThread]=useState<string|null>(null),[replies,setReplies]=useState<FeedPost[]>([]),[reply,setReply]=useState(''),[replyCursor,setReplyCursor]=useState<string|null>(null);
 const fetching=useRef(false),attempt=useRef<{action:Action;id:string}|null>(null),active=useRef(true),feedRequest=useRef(0),replyRequest=useRef(0),loadedPages=useRef(1),threadRef=useRef(thread);
 threadRef.current=thread;
 const stopRequests=useCallback(()=>{active.current=false;feedRequest.current++;replyRequest.current++;},[]);
 const query=new URLSearchParams({kind,...(scopeId?{id:scopeId}:{})}).toString();
 const refresh=useCallback(async()=>{
  if(fetching.current)return;fetching.current=true;const version=++feedRequest.current;
  try{
   let data=await readJson<FeedPage>(`/api/community/feed?${query}`),posts=data.posts;
   for(let i=1;i<loadedPages.current&&data.nextCursor;i++){data=await readJson<FeedPage>(`/api/community/feed?${query}&cursor=${encodeURIComponent(data.nextCursor)}`);posts=[...posts,...data.posts];}
   if(active.current&&version===feedRequest.current){const allowed=new Set(data.scopes.map(scopeKey));setPage({...data,posts:posts.filter(post=>allowed.has(scopeKey({kind:post.scopeKind,id:post.scopeId})))});setError('');}
  }
  catch(e){if(active.current&&version===feedRequest.current){setError(e instanceof Error?e.message:'Geen verbinding. De laatst ontvangen feed blijft zichtbaar.');if(terminal(e)){setPage(null);setReplies([]);}}}
  finally{fetching.current=false;}
 },[query]);
 const loadReplies=useCallback(async(postId:string,cursor?:string)=>{
  const version=++replyRequest.current;
  try{const data=await readJson<FeedPage>(`/api/community/feed?${query}&parentId=${encodeURIComponent(postId)}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);if(active.current&&version===replyRequest.current&&threadRef.current===postId){setReplies(old=>cursor?[...old,...data.posts.filter(post=>!old.some(p=>p.id===post.id))]:data.posts);setReplyCursor(data.nextCursor);}}
  catch(e){if(active.current&&version===replyRequest.current&&threadRef.current===postId){setError(e instanceof Error?e.message:'Gesprek niet beschikbaar.');if(terminal(e))setReplies([]);}}
 },[query]);
 useEffect(()=>{
  active.current=true;void refresh();if(thread)void loadReplies(thread);const poll=()=>{if(document.visibilityState==='visible'){void refresh();if(thread)void loadReplies(thread);}};
  const timer=setInterval(poll,5000);window.addEventListener('online',poll);document.addEventListener('visibilitychange',poll);
    return()=>{stopRequests();clearInterval(timer);window.removeEventListener('online',poll);document.removeEventListener('visibilitychange',poll);};
 },[refresh,thread,loadReplies,stopRequests]);
 const send=async(action:Action,onSuccess?:()=>void)=>{
  if(busy)return;setBusy(true);setError('');
  // A timed-out retry retains its original action and request ID.
  const current=attempt.current||{action,id:crypto.randomUUID()};attempt.current=current;
  try{await writeAction(current.action,current.id);attempt.current=null;onSuccess?.();await refresh();if(thread)await loadReplies(thread);}
  catch(e){if(terminal(e)||e&&typeof e==='object'&&'status'in e&&Number(e.status)<500)attempt.current=null;setError(e instanceof Error?e.message:'Geen verbinding. Probeer dezelfde actie opnieuw.');}
  finally{setBusy(false);}
 };
 const selected=page?.scopes.find(s=>scopeKey(s)===composeScope)||(kind!=='my'?page?.scopes.find(s=>s.kind===kind&&(!scopeId||s.id===scopeId)):page?.scopes[0]);
 return <section className={`community-feed ${compact?'community-feed-compact':''}`} aria-label="Feed">
  {!compact&&<header className="workspace-heading"><div><p className="eyebrow">DARTFLOW COMMUNITY</p><h1>{kind==='my'?'My Feed':kind==='platform'?'Platformfeed':selected?.name||'Feed'}</h1><p>Berichten uit jouw verenigingen en evenementen.</p></div><a className="button ghost" href="/app/feed/platform">Platformfeed</a></header>}
  <div className="community-feed-tabs" aria-label="Feeds"><a href="/app/feed" aria-current={kind==='my'?'page':undefined}>My Feed</a><a href="/app/feed/platform" aria-current={kind==='platform'?'page':undefined}>Platform</a>{page?.scopes.filter(s=>s.kind!=='platform').map(s=><a key={scopeKey(s)} href={`/app/feed/${s.kind}/${s.id}`} aria-current={kind===s.kind&&scopeId===s.id?'page':undefined}>{s.name}</a>)}</div>
  {error&&<p className="notice error" role="alert">{error} <button type="button" onClick={()=>void refresh()}>Opnieuw laden</button></p>}
  {attempt.current&&<div className="notice"><p>Een eerdere actie wacht op bevestiging.</p><button type="button" disabled={busy} onClick={()=>void send(attempt.current!.action)}>Zelfde actie opnieuw proberen</button><button type="button" disabled={busy} onClick={()=>{attempt.current=null;setError('Actie vrijgegeven. Controleer de feed voor je opnieuw plaatst.');}}>Controleer en vrijgeven</button></div>}
  {page&&selected&&<CommunityRulesGate><form className="panel community-compose" onSubmit={e=>{e.preventDefault();void send({type:'community.post',scopeKind:selected.kind,scopeId:selected.id,body},()=>setBody(''));}}>
   <label className="field">Plaatsen in<select value={scopeKey(selected)} onChange={e=>setComposeScope(e.target.value)} disabled={busy||Boolean(attempt.current)}>{page.scopes.filter(s=>kind==='my'||s.kind===kind&&(!scopeId||s.id===scopeId)).map(s=><option value={scopeKey(s)} key={scopeKey(s)}>{s.name}</option>)}</select></label>
   <label className="field">Bericht<textarea value={body} onChange={e=>setBody(e.target.value)} required maxLength={4000} rows={3} placeholder="Deel iets met deze spelers…" disabled={!selected.canWrite||Boolean(attempt.current)}/></label>
   {!selected.canWrite&&<p role="status">Je kunt hier tijdelijk geen berichten plaatsen.</p>}<button className="button gold" disabled={busy||!body.trim()||!selected.canWrite||Boolean(attempt.current)}>Bericht plaatsen</button>
  </form></CommunityRulesGate>}
  {!page&&!error&&<p role="status">Feed ophalen…</p>}{page&&!page.posts.length&&<div className="workspace-empty"><p>Nog geen berichten. Start een gesprek in jouw vereniging, evenement of de platformfeed.</p></div>}
  <div className="community-posts">{page?.posts.map(post=><article className="panel community-post" key={post.id}>
   <header><div><strong>{post.authorName}</strong><a href={`/app/feed/${post.scopeKind}${post.scopeKind==='platform'?'':`/${post.scopeId}`}`}>{post.scopeName}</a></div><time dateTime={post.createdAt}>{time(post.createdAt)}</time></header><p className="community-body">{post.body}</p>{post.authorId!==actorId&&<SafetyActions targetType="post" targetId={post.id} userId={post.authorId} scopeKind={post.scopeKind} scopeId={post.scopeId} onChanged={()=>void refresh()}/>}
   <div className="button-row"><button type="button" className="button ghost small" aria-pressed={post.liked} disabled={busy||Boolean(attempt.current)} onClick={()=>void send({type:'community.like',postId:post.id,liked:!post.liked})}>♡ {post.likes} · {post.liked?'Leuk gevonden':'Vind ik leuk'}</button><button type="button" className="button ghost small" aria-expanded={thread===post.id} onClick={()=>{replyRequest.current++;setThread(thread===post.id?null:post.id);setReplies([]);setReplyCursor(null);}}>{post.replyCount} reacties</button>{post.canDelete&&<button className="button ghost small" disabled={busy} onClick={()=>void send({type:'community.delete',postId:post.id})}>Verwijderen</button>}</div>
   {thread===post.id&&<section className="community-thread" aria-label="Reacties"><h3>Reacties</h3>{replies.map(item=><article key={item.id}><strong>{item.authorName}</strong><time dateTime={item.createdAt}>{time(item.createdAt)}</time><p className="community-body">{item.body}</p>{item.authorId!==actorId&&<SafetyActions targetType="reply" targetId={item.id} userId={item.authorId} scopeKind={item.scopeKind} scopeId={item.scopeId} onChanged={()=>void refresh()}/>}{item.canDelete&&<button type="button" className="text-link" disabled={busy} onClick={()=>void send({type:'community.delete',postId:item.id})}>Reactie verwijderen</button>}</article>)}{replyCursor&&<button onClick={()=>void loadReplies(post.id,replyCursor)}>Eerdere reacties</button>}<CommunityRulesGate><form onSubmit={e=>{e.preventDefault();void send({type:'community.reply',postId:post.id,body:reply},()=>setReply(''));}}><label className="field">Jouw reactie<textarea rows={2} required maxLength={4000} value={reply} onChange={e=>setReply(e.target.value)}/></label><button className="button gold small" disabled={busy||!reply.trim()||Boolean(attempt.current)}>Reageren</button></form></CommunityRulesGate></section>}
  </article>)}</div>
  {page?.nextCursor&&<button className="button ghost" type="button" onClick={async()=>{const version=++feedRequest.current;try{const more=await readJson<FeedPage>(`/api/community/feed?${query}&cursor=${encodeURIComponent(page.nextCursor!)}`);if(active.current&&version===feedRequest.current){loadedPages.current++;setPage(current=>current?{...more,posts:[...current.posts,...more.posts.filter(p=>!current.posts.some(old=>old.id===p.id))]}:null);}}catch(e){if(active.current&&version===feedRequest.current){setError(e instanceof Error?e.message:'Eerdere berichten zijn niet beschikbaar.');if(terminal(e))setPage(null);}}}}>Eerdere berichten laden</button>}
  {!compact&&kind!=='my'&&kind!=='platform'&&kind!=='match'&&scopeId&&<ScopedChat kind={kind} scopeId={scopeId} actorId={actorId} label={kind==='club'?'Verenigingschat':'Evenementchat'}/>}
 </section>;
}

const drafts=new Map<string,string>();
export function ScopedChat({kind,scopeId,actorId,label='Chat',inConsole=false}:{kind:Exclude<CommunityKind,'platform'>;scopeId:string;actorId:string;label?:string;inConsole?:boolean}){
 const key=`${actorId}:${kind}:${scopeId}`;
 const [open,setOpen]=useState(false),[data,setData]=useState<ChatPage|null>(null),[draft,setDraft]=useState(()=>drafts.get(key)||''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[denied,setDenied]=useState(false),[moderationTarget,setModerationTarget]=useState('');
 const fetching=useRef(false),trigger=useRef<HTMLButtonElement>(null),sheet=useRef<HTMLElement>(null),attempt=useRef<{action:Action;id:string}|null>(null),chatRequest=useRef(0),chatAlive=useRef(false);
 const stopRequests=useCallback(()=>{chatAlive.current=false;chatRequest.current++;},[]);
 const refresh=useCallback(async()=>{
  if(fetching.current)return;fetching.current=true;const version=++chatRequest.current;
  try{const next=await readJson<ChatPage>(`/api/community/chat/${kind}/${scopeId}`);if(chatAlive.current&&version===chatRequest.current){setData(next);setError('');setDenied(false);}}
  catch(e){if(chatAlive.current&&version===chatRequest.current){setError(e instanceof Error?e.message:'Verbinding onderbroken. Je concept blijft bewaard.');if(terminal(e)){setData(null);setDenied(true);}}}
  finally{fetching.current=false;}
 },[kind,scopeId]);
 useEffect(()=>{
  if(!open)return;chatAlive.current=true;void refresh();const poll=()=>{if(document.visibilityState==='visible')void refresh();};const timer=setInterval(poll,2000);window.addEventListener('online',poll);document.addEventListener('visibilitychange',poll);sheet.current?.focus();
  return()=>{stopRequests();clearInterval(timer);window.removeEventListener('online',poll);document.removeEventListener('visibilitychange',poll);};
 },[open,refresh,stopRequests]);
 const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
 const send=async(action:Action)=>{
  if(busy)return;setBusy(true);chatRequest.current++;const current=attempt.current||{action,id:crypto.randomUUID()};attempt.current=current;
  try{await writeAction(current.action,current.id);attempt.current=null;if(action.type==='community.message'){setDraft('');drafts.delete(key);}await refresh();}
  catch(e){setError(e instanceof Error?e.message:'Versturen niet bevestigd. Probeer dezelfde actie opnieuw.');if(e&&typeof e==='object'&&'status'in e&&Number(e.status)<500)attempt.current=null;if(terminal(e)){chatRequest.current++;setData(null);setDenied(true);}}
  finally{setBusy(false);}
 };
 return <div className={`scoped-chat ${inConsole?'scoped-chat-console':''}`}>
  <button ref={trigger} type="button" className="button ghost small scoped-chat-trigger" aria-label={inConsole?label:undefined} aria-expanded={open} aria-controls={`chat-${kind}-${scopeId}`} onClick={()=>open?close():setOpen(true)}>◌ {label}</button>
  {open&&<section ref={sheet} tabIndex={-1} role="dialog" aria-label={label} id={`chat-${kind}-${scopeId}`} className="scoped-chat-sheet" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
   <header><div><p className="eyebrow">{data?.scope.name||label}</p><h2>{label}</h2></div><button className="button ghost small" type="button" onClick={close} aria-label="Chat minimaliseren">−</button></header>
   {error&&<p className="notice error" role="alert">{error}</p>}
   <div className="scoped-chat-messages" aria-live="polite" aria-relevant="additions text">
    {data?.messages.map(message=><article key={message.id}><header><strong>{message.authorName}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}</time></header><p className="community-body">{message.deleted?'Bericht verwijderd.':message.body}</p>{!message.deleted&&message.authorId!==actorId&&<SafetyActions targetType="message" targetId={message.id} userId={message.authorId} scopeKind={kind} scopeId={scopeId} onChanged={()=>void refresh()}/>}{!message.deleted&&(message.authorId===actorId||data.scope.canModerate)&&<button type="button" className="text-link" disabled={busy} onClick={()=>void send({type:'community.message.delete',scopeKind:kind,scopeId,messageId:message.id})}>Verwijderen</button>}{!message.deleted&&data.scope.canModerate&&message.authorId!==actorId&&<button type="button" className="text-link" disabled={busy} onClick={()=>void send({type:'community.moderate',scopeKind:kind,scopeId,userId:message.authorId,minutes:10,banned:false})}>10 minuten stil</button>}</article>)}
    {data&&!data.messages.length&&<p className="muted-copy">Nog geen berichten. Overleg hier met de spelers in deze groep.</p>}{!data&&!error&&<p>Chat ophalen…</p>}
   </div>
   {attempt.current&&<button className="button small" disabled={busy||denied} onClick={()=>void send(attempt.current!.action)}>Zelfde bericht opnieuw proberen</button>}
   <CommunityRulesGate><form onSubmit={e=>{e.preventDefault();void send({type:'community.message',scopeKind:kind,scopeId,body:draft});}}><label className="sr-only" htmlFor={`chat-input-${kind}-${scopeId}`}>Chatbericht</label><textarea id={`chat-input-${kind}-${scopeId}`} rows={2} required maxLength={2000} placeholder="Jouw bericht…" value={draft} onChange={e=>{setDraft(e.target.value);drafts.set(key,e.target.value);}} disabled={denied||data?.scope.canWrite===false||Boolean(attempt.current)}/><button className="button gold" disabled={busy||denied||!draft.trim()||data?.scope.canWrite===false||!data||Boolean(attempt.current)}>Versturen</button></form></CommunityRulesGate>
   {data?.scope.canWrite===false&&<p role="status">Je kunt tijdelijk geen berichten sturen. Je concept blijft bewaard.</p>}
   {data?.scope.canModerate&&<details className="scoped-chat-moderation"><summary>Chat modereren</summary><label className="field">Speler<select value={moderationTarget} onChange={e=>setModerationTarget(e.target.value)}><option value="">Kies een deelnemer</option>{[...new Map(data.messages.filter(m=>m.authorId!==actorId).map(m=>[m.authorId,m])).values()].map(m=><option key={m.authorId} value={m.authorId}>{m.authorName}</option>)}</select></label><div className="button-row">{[{label:'10 minuten stil',minutes:10,banned:false},{label:'Stilte en blokkade opheffen',minutes:0,banned:false},{label:'Uit chat blokkeren',minutes:0,banned:true}].map(option=><button key={option.label} type="button" className="button ghost small" disabled={busy||!moderationTarget} onClick={()=>void send({type:'community.moderate',scopeKind:kind,scopeId,userId:moderationTarget,minutes:option.minutes,banned:option.banned})}>{option.label}</button>)}</div></details>}
  </section>}
 </div>;
}
