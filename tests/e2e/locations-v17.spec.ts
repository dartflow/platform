import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {LocationOverview} from '../../lib/location-types';

const origin='http://localhost:3000';
const users={owner:'00000000-0000-4000-8000-000000000001',first:'00000000-0000-4000-8000-000000000002',second:'00000000-0000-4000-8000-000000000003'};
async function login(page:Page,name:string,next='/app/locations'){await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL(new URL(next,origin).href);}
async function command(context:BrowserContext,action:Record<string,unknown>,revision?:number){const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action,...(revision===undefined?{}:{expectedRevision:revision})}});expect(response.status(),await response.text()).toBe(200);return response.json();}
async function overview(context:BrowserContext):Promise<LocationOverview>{const response=await context.request.get('/api/locations');expect(response.status()).toBe(200);return response.json();}

test('independent physical ownership creates home and venue boards, approves a UTC slot and prepares its existing fixture from the fixed QR',async({browser,baseURL})=>{
 test.setTimeout(120000);
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw new Error('Location acceptance requires the loopback fixture app.');
 const clubOwner=await browser.newContext({timezoneId:'Europe/Amsterdam'}),venueOwner=await browser.newContext({timezoneId:'Europe/Amsterdam'}),first=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Amsterdam'}),second=await browser.newContext(),viewer=await browser.newContext({viewport:{width:540,height:960}});
 try{
  expect((await(await clubOwner.request.get('/api/session')).json()).local).toBe(true);
  const clubPage=await clubOwner.newPage(),venuePage=await venueOwner.newPage(),firstPage=await first.newPage(),secondPage=await second.newPage(),screen=await viewer.newPage();
  await login(clubPage,'Danny Goldenbelt');await login(venuePage,'Speler andere club');await login(firstPage,'Michael de Groot');await login(secondPage,'Raymond van Dijk');
  const suffix=randomUUID().slice(0,6),locationName=`De Oche ${suffix}`,homeName=`Mijn thuisbaan ${suffix}`,boardName=`Locatiebaan 1 ${suffix}`,boardName2=`Locatiebaan 2 ${suffix}`,clubName=`Reserveringsclub ${suffix}`,eventName=`Gereserveerde speeldag ${suffix}`;
  const activateHome=firstPage.getByRole('button',{name:'Thuisbaan activeren',exact:true});if(await activateHome.count())await activateHome.click();
  await expect(firstPage.getByText('Thuisbaan geactiveerd',{exact:true})).toBeVisible();
  const home=firstPage.locator('.location-card').filter({has:firstPage.getByRole('heading',{name:'Thuis',exact:true})});
  const existingHome=(await overview(first)).locations.find(l=>l.kind==='home')?.boards[0];
  if(!existingHome){await home.getByLabel('Nieuwe vaste baan',{exact:true}).fill(homeName);await home.getByRole('button',{name:'Baan toevoegen',exact:true}).click();await expect(home.getByRole('heading',{name:homeName,exact:true})).toBeVisible();}
  const activateVenue=venuePage.getByRole('button',{name:'Locatiebeheer activeren',exact:true});if(await activateVenue.count())await activateVenue.click();
  const createLocation=venuePage.locator('section.panel').filter({has:venuePage.getByRole('heading',{name:'Locatie toevoegen',exact:true})});await createLocation.getByLabel('Locatienaam',{exact:true}).fill(locationName);await createLocation.getByRole('button',{name:'Locatie maken',exact:true}).click();
  const venue=venuePage.locator('.location-card').filter({has:venuePage.getByRole('heading',{name:locationName,exact:true})});await expect(venue).toBeVisible();
  for(const name of [boardName,boardName2]){await venue.getByLabel('Nieuwe vaste baan',{exact:true}).fill(name);await venue.getByRole('button',{name:'Baan toevoegen',exact:true}).click();const card=venue.locator('.location-board').filter({has:venuePage.getByRole('heading',{name,exact:true})});await expect(card).toBeVisible();await card.getByLabel('Open voor reserveringsaanvragen',{exact:true}).check();await card.getByRole('button',{name:'Baan opslaan',exact:true}).click();await expect(venuePage.getByRole('status').filter({hasText:'Opgeslagen'})).toContainText('Opgeslagen');}
  const physical=(await overview(venueOwner)).locations.find(l=>l.name===locationName)!,board=physical.boards.find(b=>b.name===boardName)!,other=physical.boards.find(b=>b.name===boardName2)!;
  await screen.goto(board.screenUrl);await expect(screen.getByRole('heading',{name:board.name,exact:true})).toBeVisible();await expect(screen.getByRole('link',{name:'Open deze baan ↗',exact:true})).toHaveAttribute('href',board.playUrl);
  const club=await command(clubOwner,{type:'club.create',name:clubName});for(const [context,id] of [[first,users.first],[second,users.second]] as const){await command(context,{type:'club.request',id:club.id});await command(clubOwner,{type:'club.approve',id:club.id,userId:id});}
  const competition=await command(clubOwner,{type:'tournament.create',clubId:club.id,name:eventName,boards:1,format:'knockout',requireWriter:false,startScore:301,bestOfLegs:1});for(const context of [first,second]){await command(context,{type:'competition.register',id:competition.id});await command(context,{type:'competition.checkin',id:competition.id});}const planned=await command(clubOwner,{type:'competition.plan',id:competition.id});
  await clubPage.reload();const request=clubPage.locator('section.panel').filter({has:clubPage.getByRole('heading',{name:'Locatiebanen voor een speeldag aanvragen',exact:true})});
  await request.getByRole('combobox',{name:'Verenigingsspeeldag',exact:true}).selectOption(String(competition.entity.state.eventId));await request.getByRole('combobox',{name:'Locatie',exact:true}).selectOption(physical.id);
  const times=await clubPage.evaluate(()=>{const local=(date:Date)=>new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);return {start:local(new Date(Date.now()-60_000)),end:local(new Date(Date.now()+15*60_000))};});
  await request.getByLabel('Vanaf',{exact:true}).fill(times.start);await request.getByLabel('Tot',{exact:true}).fill(times.end);await request.getByLabel('Aantal banen',{exact:true}).fill('1');await request.getByLabel('Maximaal aantal partijen',{exact:true}).fill('1');await request.getByRole('button',{name:'Aanvraag indienen',exact:true}).click();
  const ownerRequest=clubPage.locator('.location-reservation').filter({has:clubPage.getByRole('heading',{name:eventName,exact:true})});await expect(ownerRequest).toContainText('In afwachting');await expect(ownerRequest.getByRole('button',{name:'Aanvraag goedkeuren',exact:true})).toHaveCount(0);
  await venuePage.bringToFront();await venuePage.reload();const decision=venuePage.locator('.location-reservation').filter({has:venuePage.getByRole('heading',{name:eventName,exact:true})});await expect(decision).toBeVisible();await decision.getByLabel(boardName,{exact:true}).check();await decision.getByRole('button',{name:'Aanvraag goedkeuren',exact:true}).click();await expect(decision).toContainText('Goedgekeurd');
  const approved=(await overview(venueOwner)).reservations.find(r=>r.eventName===eventName)!;expect(approved.startsAt).toMatch(/Z$/);expect(approved.endsAt).toMatch(/Z$/);expect(approved.boards.map(b=>b.id)).toEqual([board.id]);
  await expect(screen.getByText(eventName,{exact:true})).toBeVisible();const otherResponse=await viewer.request.get(`/api/board-screens/${other.id}`);expect((await otherResponse.json()).snapshot.match).toBeNull();
  const fixture=planned.entity.state.fixtures.find((f:{status:string})=>f.status==='scheduled'),starter=fixture.players[0]===users.first?firstPage:secondPage,opponent=starter===firstPage?secondPage:firstPage;
  await starter.goto(board.playUrl);await starter.getByRole('button',{name:'Mijn ingeplande partij klaarmaken',exact:true}).click();await expect(starter).toHaveURL(/\/wedstrijd\/[a-f0-9-]{36}$/);
  const matchId=new URL(starter.url()).pathname.split('/').at(-1)!;await opponent.goto(board.playUrl);await expect(opponent.getByRole('heading',{name:/Michael de Groot.*Raymond van Dijk|Raymond van Dijk.*Michael de Groot/})).toBeVisible();
  const state=await(await first.request.get(`/api/matches/${matchId}`)).json();expect(state.boardId).toBe(board.id);expect(state.eventId).toBe(competition.entity.state.eventId);expect((await overview(venueOwner)).events.some(e=>e.clubId===club.id)).toBe(false);
  const starterContext=fixture.players[0]===users.first?first:second,opponentContext=starterContext===first?second:first;
  const send=async(context:BrowserContext,action:Record<string,unknown>)=>{const current=await(await context.request.get(`/api/matches/${matchId}`)).json();const response=await context.request.post(`/api/matches/${matchId}/actions`,{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:current.revision,action}});expect(response.status(),await response.text()).toBe(200);return response.json();};
  await send(starterContext,{type:'accept'});await send(opponentContext,{type:'accept'});await send(starterContext,{type:'start'});await send(starterContext,{type:'score',score:180});await expect(screen.locator('.sprint-number').filter({hasText:/^121$/})).toBeVisible();await send(starterContext,{type:'score',score:0});await send(starterContext,{type:'score',score:121,doubleConfirmed:true});await send(starterContext,{type:'confirm'});await send(opponentContext,{type:'confirm'});
  await expect.poll(async()=>(await(await viewer.request.get(`/api/board-screens/${board.id}`)).json()).snapshot.match).toBeNull();
 }finally{await Promise.all([clubOwner.close(),venueOwner.close(),first.close(),second.close(),viewer.close()]);}
});
