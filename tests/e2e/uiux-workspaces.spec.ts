import {test, expect, type BrowserContext, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {SeasonStatus, SeasonView} from '../../lib/seasons-types';
import type {PlatformEntity, PlatformOverview} from '../../lib/platform-types';
import {seasonSettings} from '../../lib/seasons-domain';

const owner = '00000000-0000-4000-8000-000000000001';
const origin = 'http://localhost:3000';
const viewports = [{width:1440,height:900},{width:390,height:844},{width:360,height:568}];
async function localLogin(context:BrowserContext, baseURL:string|undefined) {
  if (!baseURL || !['localhost','127.0.0.1'].includes(new URL(baseURL).hostname)) throw Error('Workspace checks require the loopback fixture application.');
  expect((await (await context.request.get('/api/session')).json()).local).toBe(true);
  const response = await context.request.post('/api/auth/local',{headers:{Origin:origin},data:{userId:owner,next:'/app'}});
  expect(response.status(),await response.text()).toBe(200);
}
async function noOverflow(page:Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
}
function season(name:string,status:SeasonStatus,startDate:string):SeasonView {
  return {id:randomUUID(),revision:1,name,scope:'internal',clubId:null,ownerId:owner,managerIds:[],status,format:'singles',settings:seasonSettings({startDate}),rulesVersion:1,publishedAt:null,eventId:randomUUID(),coreClubId:randomUUID(),divisions:[],participants:[],teams:[],rounds:[],fixtures:[],decisions:[],deductions:{},createdAt:'2026-11-01T12:00:00Z',standings:[],canManage:false,myTeamIds:[],capabilities:{canEnroll:false,canRegisterTeam:false,canPlay:false,unsupportedReason:null},eligiblePlayers:[],boards:[],statistics:[],conflicts:[]};
}
function tournament(name:string,state:Partial<PlatformEntity['state']>):PlatformEntity {
  return {id:randomUUID(),kind:'tournament',name,ownerId:owner,clubId:null,visibility:'public',revision:1,state:{name,...state},members:[],canManage:false};
}

test('competition workspace puts active and upcoming seasons before drafts and finished seasons',async({browser,baseURL},info)=>{
  const context = await browser.newContext({serviceWorkers:'block'}), page = await context.newPage();
  try {
    await localLogin(context,baseURL);
    const seasons = [season('Afgerond seizoen','completed','2026-01-01'),season('Nieuw concept','draft','2026-01-01'),season('Later inschrijven','registration','2027-04-01'),season('Eerst gepland','planned','2027-02-01'),season('Nu actief','active','2027-12-01'),season('Vorig archief','archived','2025-01-01')];
    await context.route('**/api/seasons',route=>route.fulfill({json:{seasons,clubs:[],canCreateNational:false,canCreateInternal:false}}));
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await page.goto('/app/competities');
      const titles=page.locator('.season-season-card h2');
      await expect(titles).toHaveText(['Nu actief','Eerst gepland','Later inschrijven','Nieuw concept','Afgerond seizoen']);
      await expect(page.locator('.season-season-card').first()).toHaveAttribute('data-status','active');
      await noOverflow(page);
      await info.attach(`workspace-season-order-${viewport.width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
      await page.getByRole('button',{name:'Toon archief',exact:true}).click();
      await expect(titles).toHaveText(['Vorig archief']);
      await page.getByRole('button',{name:'Toon huidige seizoenen',exact:true}).click();
      await expect(titles).toHaveCount(5);
    }
    // Tournaments often use closed/completed flags and fixture states instead
    // of state.status. Keep the real actor/platform envelope for this UI check.
    const baseline:PlatformOverview=await(await context.request.get('/api/platform')).json();
    const liveFixture={id:randomUUID(),players:[null,null],round:1,phase:'knockout' as const,status:'live' as const};
    const tournaments=[
      tournament('Gesloten toernooi',{date:'2026-01-02T19:00:00Z',closed:true,fixtures:[liveFixture]}),
      tournament('Afgerond toernooi',{date:'2026-01-01T19:00:00Z',completed:true,fixtures:[{...liveFixture,status:'scheduled'}]}),
      tournament('Concepttoernooi',{date:'2027-03-01T19:00:00Z',status:'draft'}),
      tournament('Binnenkort toernooi',{date:'2027-02-01T19:00:00Z',fixtures:[{...liveFixture,status:'proposed'}]}),
      tournament('Nu live toernooi',{date:'2027-04-01T19:00:00Z',fixtures:[liveFixture]}),
    ];
    await context.route('**/api/platform',route=>{
      expect(route.request().method()).toBe('GET');
      return route.fulfill({json:{...baseline,tournaments}});
    });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);await page.goto('/app/hall');
      const tiles=page.locator('.platform-workspace .workspace-grid .workspace-tile');
      await expect(tiles.locator('h2')).toHaveText(['Nu live toernooi','Binnenkort toernooi','Concepttoernooi','Afgerond toernooi','Gesloten toernooi']);
      for(const [index,status] of ['live','planned','draft','completed','completed'].entries())await expect(tiles.nth(index)).toHaveAttribute('data-status',status);
      await expect(tiles.locator(':scope > .badge')).toHaveText(['Live','Gepland','Concept','Afgerond','Afgerond']);
      await noOverflow(page);
      await info.attach(`workspace-tournament-state-order-${viewport.width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
    }
  } finally { await context.close(); }
});

test('clubhouse orders its agenda, groups permitted links and keeps mobile navigation reachable',async({browser,baseURL},info)=>{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(); let clubId='';
  const action=async(command:Record<string,unknown>)=>{
    const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:command}});
    expect(response.status(),await response.text()).toBe(200);return response.json();
  };
  try {
    await localLogin(context,baseURL);
    clubId=(await action({type:'club.create',name:`Workspace indeling ${randomUUID().slice(0,8)}`})).id;
    for (const day of [7,3,5,1]) {
      const response=await context.request.post('/api/clubhouse/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:0,action:{type:'activity.save',clubId,title:`Clubavond ${day}`,description:'Lokale indelingsproef',startsAt:`2091-06-0${day}T17:30:00Z`,endsAt:`2091-06-0${day}T20:30:00Z`,timeZone:'Europe/Amsterdam',capacity:20,location:'Eigen clubruimte',organizerName:'Clubbeheer',organizerId:owner,activityType:'club',lastChange:''}}});
      expect(response.status(),await response.text()).toBe(200);
    }
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await page.goto(`/app/clubs/${clubId}`);
      const nav=page.getByRole('navigation',{name:'Verenigingsonderdelen',exact:true});
      for (const label of ['Club','Spelen','Organiseren']) await expect(nav.getByRole('group',{name:label,exact:true})).toBeVisible();
      await expect(nav.getByRole('link',{name:'Overzicht',exact:true})).toHaveAttribute('aria-current','page');
      const agenda=page.getByRole('heading',{name:'Op de clubagenda',exact:true}).locator('..').locator('..');
      await expect(agenda.locator('.ch-list-item strong')).toHaveText(['Clubavond 1','Clubavond 3','Clubavond 5']);
      await expect(agenda.getByRole('link',{name:'Bekijk agenda ↗',exact:true})).toHaveAttribute('href',`/app/clubs/${clubId}/agenda`);
      const manage=nav.getByRole('link',{name:'Verenigingsbeheer',exact:true});
      await manage.focus(); await expect(manage).toBeFocused(); await noOverflow(page);
      if (viewport.width<760) {
        const bounds=await manage.boundingBox(); expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width+1);
      }
      await info.attach(`workspace-club-navigation-${viewport.width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
      await page.keyboard.press('Enter'); await expect(page).toHaveURL(`${origin}/app/clubs/${clubId}/beheer`);
      await expect(page.getByRole('heading',{name:'Rollen en eigendom',exact:true})).toBeVisible();
      await noOverflow(page);
    }
  } finally { if (clubId) await action({type:'club.deactivate',id:clubId}); await context.close(); }
});
