import {test,expect,type Page,type BrowserContext,type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const origin='http://localhost:3000';
async function login(page:Page,name:string,next:string){await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL(new URL(next,origin).href);}
async function action(context:BrowserContext,action:Record<string,unknown>){const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action}});expect(response.status(),await response.text()).toBe(200);return response.json();}
test('two phone sessions share a private feed, likes, threads and minimized chat, and lose access after leaving',async({browser,baseURL})=>{
 test.setTimeout(120000);if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Only isolated loopback fixture sessions may run this test.');
 const owner=await browser.newContext({viewport:{width:390,height:844}}),player=await browser.newContext({viewport:{width:412,height:915}}),outsider=await browser.newContext();
 try{
  const a=await owner.newPage(),b=await player.newPage(),c=await outsider.newPage();await login(a,'Danny Goldenbelt','/app/feed');await login(b,'Michael de Groot','/app/feed');await login(c,'Raymond van Dijk','/app/feed');
  const person=(await(await player.request.get('/api/session')).json()).user.id,suffix=randomUUID().slice(0,8),club=(await action(owner,{type:'club.create',name:`Feedclub ${suffix}`})).id;
  await action(player,{type:'club.request',id:club});await action(owner,{type:'club.approve',id:club,userId:person});
  const path=`/app/feed/club/${club}`,post=`Feedbericht ${suffix}`,reply=`Reactie ${suffix}`,message=`Chat ${suffix}`;
  await a.goto(path);await b.goto(path);await b.getByLabel('Bericht',{exact:true}).fill(post);await b.getByRole('button',{name:'Plaatsen',exact:true}).click();await expect(a.getByText(post,{exact:true})).toBeVisible();
  const card=a.locator('.df-feed-card').filter({hasText:post});await card.getByRole('button',{name:/Vind bericht leuk/}).click();await expect(card.getByRole('button',{name:/Vind bericht leuk/})).toHaveAttribute('aria-pressed','true');
  const other=b.locator('.df-feed-card').filter({hasText:post});await expect(other.getByRole('button',{name:'Vind bericht leuk (1)',exact:true})).toBeVisible();await card.getByRole('button',{name:/reacties/}).click();await card.getByLabel('Reactie',{exact:true}).fill(reply);await card.getByRole('button',{name:'Reageren',exact:true}).click();await expect(card.getByText(reply,{exact:true})).toBeVisible();await other.getByRole('button',{name:/reacties/}).click();await expect(other.getByText(reply,{exact:true})).toBeVisible();
  await a.getByRole('button',{name:'◌ Verenigingschat',exact:true}).click();await b.getByRole('button',{name:'◌ Verenigingschat',exact:true}).click();const aChat=a.getByRole('dialog',{name:'Verenigingschat',exact:true}),bChat=b.getByRole('dialog',{name:'Verenigingschat',exact:true});
  await bChat.getByLabel('Chatbericht',{exact:true}).fill(message);await bChat.getByRole('button',{name:'Versturen',exact:true}).click();await expect(aChat.getByText(message,{exact:true})).toBeVisible();
  await bChat.getByLabel('Chatbericht',{exact:true}).fill('Concept bewaren');await bChat.getByRole('button',{name:'Chat minimaliseren',exact:true}).click();await expect(bChat).toHaveCount(0);await b.getByRole('button',{name:'◌ Verenigingschat',exact:true}).click();await expect(bChat.getByLabel('Chatbericht',{exact:true})).toHaveValue('Concept bewaren');
  await player.setOffline(true);await expect(bChat.getByRole('alert')).toBeVisible();await aChat.getByLabel('Chatbericht',{exact:true}).fill(`Tijdens offline ${suffix}`);await aChat.getByRole('button',{name:'Versturen',exact:true}).click();await player.setOffline(false);await expect(bChat.getByText(`Tijdens offline ${suffix}`,{exact:true})).toBeVisible();await expect(bChat.getByLabel('Chatbericht',{exact:true})).toHaveValue('Concept bewaren');
  const denied=await outsider.request.get(`/api/community/feed?kind=club&id=${club}`);expect(denied.status()).toBe(403);expect((await outsider.request.get(`/api/feed?channel=club:${club}`)).status()).toBe(403);await c.goto(path);await expect(c.locator('.df-feed > [role="alert"]')).toBeVisible();await expect(c.getByText(post,{exact:true})).toHaveCount(0);
  await action(player,{type:'club.leave',id:club});await expect(bChat.getByRole('alert')).toBeVisible();await expect(bChat.getByText(message,{exact:true})).toHaveCount(0);await expect(bChat.getByRole('button',{name:'Versturen',exact:true})).toBeDisabled();await expect(b.getByText(post,{exact:true})).toHaveCount(0);
  expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }finally{await player.setOffline(false);await Promise.all([owner.close(),player.close(),outsider.close()]);}
});

test('late feed pages cannot restore revoked data or put replies into a different open thread',async({browser,baseURL})=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Loopback-only UI scheduling fixture.');
 const context=await browser.newContext({viewport:{width:390,height:844}}),scopeId=randomUUID(),first=randomUUID(),second=randomUUID();let lateThread:Route|undefined,latePage:Route|undefined,lateChat:Route|undefined,revoked=false,chatReads=0,chatDenied=false;
 const scope={kind:'club',id:scopeId,name:'UI scheduling fixture',canWrite:true,canModerate:false};
 const channel={key:`club:${scopeId}`,kind:'club',id:scopeId,name:scope.name,visibility:'members',following:true,mode:'all',canPost:true,canReact:true,canManage:false,membersCanPost:true,reactions:true,maxPinDays:7,href:`/app/clubs/${scopeId}`};
 const post=(id:string,body:string)=>({id,body,channel:channel.key,category:'post',title:'',authorName:'Fixture player',createdAt:'2026-11-12T12:00:00.000000Z',likes:0,liked:false,replyCount:1,canDelete:false,canManage:false,reactions:true,pinUntil:null,important:false,href:null});
 const response=(posts:ReturnType<typeof post>[],nextCursor:string|null=null)=>({posts,pins:[],nextCursor,channels:[channel],upcoming:[]});
 const threadResponse=(body:string)=>({replies:[{id:randomUUID(),authorName:'Fixture player',body,createdAt:'2026-11-12T12:00:00.000000Z'}],nextCursor:null});
 try{
  const page=await context.newPage();await login(page,'Michael de Groot','/app/feed');
  await context.route('**/api/feed?**',async route=>{
   const url=new URL(route.request().url());
   if(url.searchParams.get('cursor')){latePage=route;return;}
   if(revoked)return route.fulfill({status:403,json:{error:'De verenigingsrechten zijn ingetrokken.'}});
   return route.fulfill({json:response([post(first,'Thread A'),post(second,'Thread B')],'next-page')});
  });
  let holdReplyB=false,lateCurrentThread:Route|undefined;
  await context.route('**/api/feed/replies/*',async route=>{
   const id=new URL(route.request().url()).pathname.split('/').at(-1);
   if(id===first){lateThread=route;return;}
   if(id===second&&holdReplyB){lateCurrentThread=route;return;}
   return route.fulfill({json:threadResponse('Correct reply B')});
  });
  const chatData={scope,messages:[{id:randomUUID(),sequence:1,authorId:randomUUID(),authorName:'Private player',body:'Protected chat message',createdAt:'2026-11-12T12:00:00Z',deleted:false}],cursor:1};
  await context.route(`**/api/community/chat/club/${scopeId}`,async route=>{if(chatDenied)return route.fulfill({status:403,json:{error:'Chat niet meer toegestaan.'}});if(chatReads++===0)return route.fulfill({json:chatData});lateChat=route;});
  await context.route('**/api/platform/actions',async route=>{chatDenied=true;return route.fulfill({status:403,json:{error:'Chat niet meer toegestaan.'}});});
  await page.goto(`/app/feed/club/${scopeId}`);const a=page.locator('.df-feed-card').filter({hasText:'Thread A'}),b=page.locator('.df-feed-card').filter({hasText:'Thread B'});
  await a.getByRole('button',{name:'1 reacties',exact:true}).click();await expect.poll(()=>Boolean(lateThread)).toBe(true);await b.getByRole('button',{name:'1 reacties',exact:true}).click();await expect(b.getByText('Correct reply B',{exact:true})).toBeVisible();await lateThread!.fulfill({json:threadResponse('Stale reply A')});await expect(b.getByText('Stale reply A',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'◌ Verenigingschat',exact:true}).click();const chat=page.getByRole('dialog',{name:'Verenigingschat',exact:true});await expect(chat.getByText('Protected chat message',{exact:true})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>Boolean(lateChat)).toBe(true);await chat.getByLabel('Chatbericht',{exact:true}).fill('Rejected message');await chat.getByRole('button',{name:'Versturen',exact:true}).click();await expect(chat.getByRole('alert')).toContainText('niet meer toegestaan');await lateChat!.fulfill({json:chatData});await expect(chat.getByText('Protected chat message',{exact:true})).toHaveCount(0);await expect(chat.getByRole('button',{name:'Versturen',exact:true})).toBeDisabled();await chat.getByRole('button',{name:'Chat minimaliseren',exact:true}).click();
  holdReplyB=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>Boolean(lateCurrentThread)).toBe(true);
  await page.getByRole('button',{name:'Laad meer berichten',exact:true}).click();await expect.poll(()=>Boolean(latePage)).toBe(true);revoked=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.locator('.df-feed > [role="alert"]')).toContainText('ingetrokken');await expect(page.locator('.df-feed-card')).toHaveCount(0);
  await latePage!.fulfill({json:response([post(randomUUID(),'Late private page')])});await lateCurrentThread!.fulfill({json:threadResponse('Late private reply')});await expect(page.getByText('Late private reply',{exact:true})).toHaveCount(0);await expect(page.getByText('Late private page',{exact:true})).toHaveCount(0);await expect(page.locator('.df-feed-card')).toHaveCount(0);
 }finally{await context.close();}
});

test('legacy event chat remains participant-only while its public Feed channel stays readable',async({browser,baseURL})=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Loopback-only event scope fixture.');
 const context=await browser.newContext({viewport:{width:390,height:844}});let allowed=false,muted=false;
 try{
  const page=await context.newPage();await login(page,'Michael de Groot','/app/feed');
  for(const kind of ['league','tournament'] as const){
   const id=randomUUID(),key=`${kind}:${id}`,scope={kind,id,name:'Legacy participant event',canWrite:true,canModerate:false};
   await context.route('**/api/feed?**',route=>route.fulfill({json:{channels:[{key,kind,id,name:scope.name,visibility:'public',following:true,mode:'all',canPost:false,canReact:true,canManage:false,membersCanPost:false,reactions:true,maxPinDays:7,href:'/app/feed'}],posts:[{id:randomUUID(),channel:key,category:'update',title:'Published event update',body:'Open public announcement',authorName:'Official',createdAt:'2026-11-13T12:00:00Z',important:true,pinUntil:null,likes:0,liked:false,replyCount:0,canDelete:false,canManage:false,reactions:true,href:null}],pins:[],nextCursor:null,upcoming:[]}}));
   await context.route(`**/api/community/feed?kind=${kind}&id=${id}`,route=>allowed?route.fulfill({json:{posts:[],nextCursor:null,scopes:[scope]}}):route.fulfill({status:403,json:{error:'Alleen deelnemers hebben chattoegang.'}}));
   await context.route(`**/api/community/chat/${kind}/${id}`,route=>allowed?route.fulfill({json:{scope:{...scope,canWrite:!muted},messages:[{id:randomUUID(),sequence:1,authorId:randomUUID(),authorName:'Participant',body:'Protected participant message',createdAt:'2026-11-13T12:00:00Z',deleted:false}],cursor:1}}):route.fulfill({status:403,json:{error:'Chatrechten ingetrokken.'}}));
   allowed=false;muted=false;await page.goto(`/app/feed/${kind}/${id}`);await expect(page.getByText('Open public announcement',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'◌ Evenementchat',exact:true})).toHaveCount(0);
   allowed=true;await page.reload();await page.getByRole('button',{name:'◌ Evenementchat',exact:true}).click();const chat=page.getByRole('dialog',{name:'Evenementchat',exact:true});await expect(chat.getByText('Protected participant message',{exact:true})).toBeVisible();await chat.getByLabel('Chatbericht',{exact:true}).fill('Concept bij tijdelijke stilte');muted=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(chat.getByLabel('Chatbericht',{exact:true})).toBeDisabled();await expect(chat.getByText('Protected participant message',{exact:true})).toBeVisible();muted=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(chat.getByLabel('Chatbericht',{exact:true})).toBeEnabled();await expect(chat.getByLabel('Chatbericht',{exact:true})).toHaveValue('Concept bij tijdelijke stilte');allowed=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(chat.getByRole('alert')).toContainText('ingetrokken');await expect(chat.getByText('Protected participant message',{exact:true})).toHaveCount(0);await expect(chat.getByRole('button',{name:'Versturen',exact:true})).toBeDisabled();await expect(page.getByText('Open public announcement',{exact:true})).toBeVisible();
  }
 }finally{await context.close();}
});
