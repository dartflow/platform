import {test,expect,type APIResponse} from '@playwright/test';

test('SocialHero confirms separate pre-pair permissions, preserves opt-outs and resumes interrupted pairing',async({browser,baseURL})=>{
  if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Only local fixtures may run this integration scenario.');
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}});
  try{
    expect((await(await context.request.get('/api/session')).json()).local).toBe(true);
    expect((await context.request.post('/api/auth/local',{headers:{Origin:baseURL},data:{userId:'00000000-0000-4000-8000-000000000001',next:'/blog/beheer'}})).status()).toBe(200);
    let connection={status:'disconnected',environment:'staging',siteId:'fixture-site',origin:'https://staging.dartflow.nl',connectionId:null as string|null,destinationId:null as string|null,draft:true,publish:true,hasSavedPolicy:false,lastCheckedAt:null as string|null,scopes:[] as string[],configured:true,needsCode:false};
    const pairings:unknown[]=[],policyWrites:unknown[]=[];let disconnects=0;
    await context.route('**/api/blog/admin',route=>route.fulfill({json:{posts:[],categories:[{id:'toernooien',name:'Toernooien'}],authors:[{id:'redactie',name:'Redactie'}]}}));
    await context.route('**/api/blog/socialhero',async route=>{
      const action=route.request().method()==='POST'?route.request().postDataJSON():null;
      if(action?.action==='pair'){
        pairings.push(action);
        if(pairings.length===1){connection={...connection,status:'pending',needsCode:true};await route.fulfill({status:503,json:{code:'SOCIALHERO_UNAVAILABLE',message:'SocialHero is tijdelijk onbereikbaar.',requestId:'fixture-network'}});return;}
        const draft=connection.hasSavedPolicy?connection.draft&&action.draft:action.draft,publish=connection.hasSavedPolicy?connection.publish&&action.publish:action.publish;
        connection={...connection,status:pairings.length===2?'pending':'active',connectionId:'fixture-connection',destinationId:'fixture-destination',draft,publish,hasSavedPolicy:true,needsCode:false,scopes:pairings.length===2?[]:['read',...(draft?['draft']:[]),...(publish?['publish']:[])]};
        if(pairings.length===2){await route.fulfill({status:409,json:{code:'PAIRING_IN_PROGRESS',message:'De verificatie is nog niet afgerond.',requestId:'fixture-pending'}});return;}
      }
      if(action?.action==='check')connection={...connection,status:'active',lastCheckedAt:'2026-11-26T12:00:00.000Z',scopes:['read',...(connection.draft?['draft']:[]),...(connection.publish?['publish']:[])]};
      if(action?.action==='policy'){
        expect(connection.hasSavedPolicy).toBe(true);expect(action.publish&&!action.draft).toBe(false);policyWrites.push(action);
        connection={...connection,draft:action.draft,publish:action.publish,hasSavedPolicy:true,scopes:connection.status==='active'?['read',...(action.draft?['draft']:[]),...(action.publish?['publish']:[])]:[]};
      }
      if(action?.action==='disconnect'){
        disconnects++;connection={...connection,status:'disconnected',connectionId:null,scopes:[]};
      }
      await route.fulfill({json:{connection}});
    });
    const page=await context.newPage();await page.goto('/blog/beheer');
    const panel=page.getByRole('region',{name:'SocialHero',exact:true});
    await expect(panel.getByText('Niet gekoppeld',{exact:true})).toBeVisible();await expect(panel.getByText('Staging',{exact:true})).toBeVisible();
    const drafting=panel.getByRole('checkbox',{name:'SocialHero mag concepten en afbeeldingen aanmaken en bijwerken.',exact:true});
    const publication=panel.getByRole('checkbox',{name:'SocialHero mag artikelen zelfstandig live zetten volgens de campagneplanning en de ingestelde goedkeuringsmodus.',exact:true});
    await expect(drafting).toBeChecked();await expect(drafting).toBeEnabled();await expect(publication).toBeChecked();await expect(publication).toBeEnabled();
    await expect(panel.getByText('Nog niet succesvol gecontroleerd',{exact:true})).toBeVisible();
    await publication.uncheck();
    const code=panel.getByLabel('Eenmalige koppelcode',{exact:true});await code.fill('fixture-pairing-code');await panel.getByRole('button',{name:'Koppelen',exact:true}).click();
    await expect(panel.getByRole('alert')).toContainText('tijdelijk onbereikbaar');await expect(code).toHaveValue('fixture-pairing-code');await expect(publication).not.toBeChecked();await expect(drafting).toBeChecked();
    await expect(panel.getByText('Verificatie nog niet afgerond',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Ontkoppelen',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'Ontkoppelen',exact:true}).click();await expect(panel.getByRole('button',{name:'Ja, ontkoppelen',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Annuleren',exact:true}).click();expect(disconnects).toBe(0);await expect(code).toHaveValue('fixture-pairing-code');
    await panel.getByRole('button',{name:'Koppelen',exact:true}).click();await expect(panel.getByText('Verificatie nog niet afgerond',{exact:true})).toBeVisible();await expect(drafting).toBeEnabled();await expect(publication).toBeEnabled();
    expect(pairings).toEqual([{action:'pair',code:'fixture-pairing-code',draft:true,publish:false},{action:'pair',code:'fixture-pairing-code',draft:true,publish:false}]);
    await panel.getByRole('button',{name:'Verbinding controleren',exact:true}).click();await expect(panel.getByText('Actief',{exact:true})).toBeVisible();await expect(publication).toBeEnabled();await expect(publication).not.toBeChecked();
    const effectiveAccess=panel.locator('p').filter({hasText:'Effectieve toegang:'});
    await expect(panel.getByText(/26 nov 2026.*13:00/)).toBeVisible();await expect(effectiveAccess).toContainText('Concepten en afbeeldingen beheren');
    await expect(panel.getByLabel('Nieuwe koppelcode',{exact:true})).toHaveValue('');
    const savePermission=panel.getByRole('button',{name:'Toestemmingen opslaan',exact:true});await expect(savePermission).toBeDisabled();await publication.check();expect(policyWrites).toHaveLength(0);await savePermission.click();await expect(savePermission).toBeDisabled();expect(policyWrites).toEqual([{action:'policy',draft:true,publish:true}]);
    await drafting.uncheck();await expect(publication).not.toBeChecked();await expect(publication).toBeDisabled();expect(policyWrites).toHaveLength(1);await savePermission.click();await expect(savePermission).toBeDisabled();
    await expect(effectiveAccess).toHaveText('Effectieve toegang: Lezen');
    expect(policyWrites).toEqual([{action:'policy',draft:true,publish:true},{action:'policy',draft:false,publish:false}]);
    await panel.getByRole('button',{name:'Ontkoppelen',exact:true}).click();expect(disconnects).toBe(0);await panel.getByRole('button',{name:'Annuleren',exact:true}).click();expect(disconnects).toBe(0);
    await panel.getByRole('button',{name:'Ontkoppelen',exact:true}).click();await panel.getByRole('button',{name:'Ja, ontkoppelen',exact:true}).click();await expect(panel.getByText('Niet gekoppeld',{exact:true})).toBeVisible();expect(disconnects).toBe(1);await expect(drafting).not.toBeChecked();await expect(publication).not.toBeChecked();
    await page.reload();await expect(panel.getByText('Niet gekoppeld',{exact:true})).toBeVisible();await expect(drafting).not.toBeChecked();await expect(publication).not.toBeChecked();
    await expect(panel.getByText('Eerder uitgezette rechten blijven bij opnieuw koppelen uit. Je kunt ze met Toestemmingen opslaan bewust weer aanzetten.',{exact:true})).toBeVisible();
    await drafting.check();await publication.check();
    await panel.getByLabel('Eenmalige koppelcode',{exact:true}).fill('fixture-relink-code');await panel.getByRole('button',{name:'Koppelen',exact:true}).click();await expect(panel.getByText('Actief',{exact:true})).toBeVisible();
    expect(pairings[2]).toEqual({action:'pair',code:'fixture-relink-code',draft:true,publish:true});await expect(drafting).not.toBeChecked();await expect(publication).not.toBeChecked();
    await panel.getByRole('button',{name:'Ontkoppelen',exact:true}).click();await panel.getByRole('button',{name:'Ja, ontkoppelen',exact:true}).click();await expect(panel.getByText('Niet gekoppeld',{exact:true})).toBeVisible();
    await drafting.check();await expect(publication).not.toBeChecked();await savePermission.click();await expect(savePermission).toBeDisabled();expect(policyWrites[2]).toEqual({action:'policy',draft:true,publish:false});
    await panel.getByLabel('Eenmalige koppelcode',{exact:true}).fill('fixture-explicit-rights-code');await panel.getByRole('button',{name:'Koppelen',exact:true}).click();await expect(panel.getByText('Actief',{exact:true})).toBeVisible();expect(pairings[3]).toEqual({action:'pair',code:'fixture-explicit-rights-code',draft:true,publish:false});await expect(drafting).toBeChecked();await expect(publication).not.toBeChecked();
    for(const width of[390,320]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  }finally{await context.close();}
});

test('real SocialHero routes enforce admin sessions, same-origin writes and safe error responses before any pairing',async({browser,baseURL})=>{
  if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Only local fixtures may run this integration scenario.');
  const anonymous=await browser.newContext({baseURL}),player=await browser.newContext({baseURL}),admin=await browser.newContext({baseURL});
  const endpoint='/api/blog/socialhero',headers={Origin:baseURL};
  async function errorResponse(response:APIResponse,status:number,code:string){
    expect(response.status(),await response.text()).toBe(status);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body=await response.json();expect(Object.keys(body).sort()).toEqual(['code','message','requestId']);
    expect(body.code).toBe(code);expect(body.message).toEqual(expect.any(String));expect(body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
  try{
    expect((await(await admin.request.get('/api/session')).json()).local).toBe(true);
    await errorResponse(await anonymous.request.get(endpoint),401,'UNAUTHENTICATED');
    expect((await player.request.post('/api/auth/local',{headers,data:{userId:'00000000-0000-4000-8000-000000000002',next:'/blog/beheer'}})).status()).toBe(200);
    await errorResponse(await player.request.get(endpoint),403,'PERMISSION_DENIED');
    expect((await admin.request.post('/api/auth/local',{headers,data:{userId:'00000000-0000-4000-8000-000000000001',next:'/blog/beheer'}})).status()).toBe(200);
    const status=await admin.request.get(endpoint);expect(status.status(),await status.text()).toBe(200);expect(status.headers()['cache-control']).toContain('no-store');
    const state=await status.json();expect(Object.keys(state)).toEqual(['connection']);
    expect(state.connection).toMatchObject({status:'disconnected',draft:expect.any(Boolean),publish:expect.any(Boolean),hasSavedPolicy:expect.any(Boolean),scopes:[],configured:false});
    if(!state.connection.hasSavedPolicy)expect(state.connection).toMatchObject({draft:true,publish:true});
    expect(state.connection.lastCheckedAt===null||Number.isFinite(Date.parse(state.connection.lastCheckedAt))).toBe(true);
    const fields=['status','environment','siteId','origin','connectionId','destinationId','draft','publish','hasSavedPolicy','policyConfigured','lastCheckedAt','scopes','configured','needsCode','previousConnectionActive'];
    expect(Object.keys(state.connection).every(field=>fields.includes(field))).toBe(true);
    expect(state.connection.environment).toEqual(expect.any(String));expect(state.connection.siteId).toEqual(expect.any(String));expect(new URL(state.connection.origin).origin).toBe(baseURL);
    await errorResponse(await admin.request.post(endpoint,{headers:{Origin:'https://other-site.invalid'},data:{action:'check'}}),403,'PERMISSION_DENIED');
    if(!state.connection.hasSavedPolicy)await errorResponse(await admin.request.post(endpoint,{headers,data:{action:'policy',draft:true,publish:true}}),403,'PERMISSION_DENIED');
    await errorResponse(await admin.request.post(endpoint,{headers,data:{action:'unknown'}}),422,'VALIDATION_ERROR');
    await errorResponse(await admin.request.post(endpoint,{headers:{...headers,'Content-Type':'application/json'},data:'{"action":'}),422,'VALIDATION_ERROR');
    const invalidCredential='fixture-invalid-credential';
    const machine=await anonymous.request.get('/api/socialhero/v1/capabilities',{headers:{Authorization:`Bearer ${invalidCredential}`}});
    await errorResponse(machine,401,'INVALID_CREDENTIAL');expect(await machine.text()).not.toContain(invalidCredential);
    const unchanged=await admin.request.get(endpoint);expect(unchanged.status()).toBe(200);expect((await unchanged.json()).connection).toMatchObject({status:'disconnected',draft:state.connection.draft,publish:state.connection.publish});
  }finally{await anonymous.close();await player.close();await admin.close();}
});
