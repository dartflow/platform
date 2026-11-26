import {test,expect,type APIResponse} from '@playwright/test';

test('SocialHero keeps a failed pairing code, resumes verification and saves publication permission only after explicit opt-in',async({browser,baseURL})=>{
  if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Only local fixtures may run this integration scenario.');
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}});
  try{
    expect((await(await context.request.get('/api/session')).json()).local).toBe(true);
    expect((await context.request.post('/api/auth/local',{headers:{Origin:baseURL},data:{userId:'00000000-0000-4000-8000-000000000001',next:'/blog/beheer'}})).status()).toBe(200);
    let connection={status:'disconnected',environment:'staging',siteId:'fixture-site',origin:'https://staging.dartflow.nl',connectionId:null as string|null,destinationId:null as string|null,publish:false,scopes:['read','draft'],configured:true,needsCode:false};
    let pairings=0,policyWrites=0,disconnects=0;
    await context.route('**/api/blog/admin',route=>route.fulfill({json:{posts:[],categories:[{id:'toernooien',name:'Toernooien'}],authors:[{id:'redactie',name:'Redactie'}]}}));
    await context.route('**/api/blog/socialhero',async route=>{
      const action=route.request().method()==='POST'?route.request().postDataJSON():null;
      if(action?.action==='pair'){
        expect(action.code).toBe('fixture-pairing-code');
        pairings++;
        if(pairings===1){connection={...connection,status:'pending',needsCode:true};await route.fulfill({status:503,json:{code:'SOCIALHERO_UNAVAILABLE',message:'SocialHero is tijdelijk onbereikbaar.',requestId:'fixture-network'}});return;}
        connection={...connection,status:'pending',connectionId:'fixture-connection',destinationId:'fixture-destination',needsCode:false};
        await route.fulfill({status:409,json:{code:'PAIRING_IN_PROGRESS',message:'De verificatie is nog niet afgerond.',requestId:'fixture-pending'}});return;
      }
      if(action?.action==='check')connection={...connection,status:'active'};
      if(action?.action==='policy'){
        expect(connection.status).toBe('active');expect(action.publish).toBe(true);policyWrites++;
        connection={...connection,publish:true,scopes:['read','draft','publish']};
      }
      if(action?.action==='disconnect'){
        disconnects++;connection={...connection,status:'disconnected',connectionId:null,publish:false,scopes:['read','draft']};
      }
      await route.fulfill({json:{connection}});
    });
    const page=await context.newPage();await page.goto('/blog/beheer');
    const panel=page.getByRole('region',{name:'SocialHero',exact:true});
    await expect(panel.getByText('Niet gekoppeld',{exact:true})).toBeVisible();await expect(panel.getByText('Staging',{exact:true})).toBeVisible();
    const publication=panel.getByRole('checkbox',{name:'SocialHero mag artikelen publiceren'});
    await expect(publication).toBeDisabled();await expect(publication).not.toBeChecked();
    const code=panel.getByLabel('Eenmalige koppelcode',{exact:true});await code.fill('fixture-pairing-code');await panel.getByRole('button',{name:'Koppelen',exact:true}).click();
    await expect(panel.getByRole('alert')).toContainText('tijdelijk onbereikbaar');await expect(code).toHaveValue('fixture-pairing-code');
    await expect(panel.getByText('Verificatie nog niet afgerond',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Ontkoppelen',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'Ontkoppelen',exact:true}).click();await expect(panel.getByRole('button',{name:'Ja, ontkoppelen',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Annuleren',exact:true}).click();expect(disconnects).toBe(0);await expect(code).toHaveValue('fixture-pairing-code');
    await panel.getByRole('button',{name:'Koppelen',exact:true}).click();await expect(panel.getByText('Verificatie nog niet afgerond',{exact:true})).toBeVisible();await expect(publication).toBeDisabled();
    await panel.getByRole('button',{name:'Verbinding controleren',exact:true}).click();await expect(panel.getByText('Actief',{exact:true})).toBeVisible();await expect(publication).toBeEnabled();await expect(publication).not.toBeChecked();
    await expect(panel.getByLabel('Nieuwe koppelcode',{exact:true})).toHaveValue('');
    const savePermission=panel.getByRole('button',{name:'Publicatierecht opslaan',exact:true});await expect(savePermission).toBeDisabled();await publication.check();expect(policyWrites).toBe(0);await savePermission.click();await expect(savePermission).toBeDisabled();expect(policyWrites).toBe(1);
    await panel.getByRole('button',{name:'Ontkoppelen',exact:true}).click();expect(disconnects).toBe(0);await panel.getByRole('button',{name:'Annuleren',exact:true}).click();expect(disconnects).toBe(0);
    await panel.getByRole('button',{name:'Ontkoppelen',exact:true}).click();await panel.getByRole('button',{name:'Ja, ontkoppelen',exact:true}).click();await expect(panel.getByText('Niet gekoppeld',{exact:true})).toBeVisible();expect(disconnects).toBe(1);await expect(publication).not.toBeChecked();
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
    expect(state.connection).toMatchObject({status:'disconnected',publish:false,scopes:[],configured:false});
    const fields=['status','environment','siteId','origin','connectionId','destinationId','publish','scopes','configured','needsCode'];
    expect(Object.keys(state.connection).every(field=>fields.includes(field))).toBe(true);
    expect(state.connection.environment).toEqual(expect.any(String));expect(state.connection.siteId).toEqual(expect.any(String));expect(new URL(state.connection.origin).origin).toBe(baseURL);
    await errorResponse(await admin.request.post(endpoint,{headers:{Origin:'https://other-site.invalid'},data:{action:'check'}}),403,'PERMISSION_DENIED');
    await errorResponse(await admin.request.post(endpoint,{headers,data:{action:'policy',publish:true}}),403,'PERMISSION_DENIED');
    await errorResponse(await admin.request.post(endpoint,{headers,data:{action:'unknown'}}),422,'VALIDATION_ERROR');
    await errorResponse(await admin.request.post(endpoint,{headers:{...headers,'Content-Type':'application/json'},data:'{"action":'}),422,'VALIDATION_ERROR');
    const invalidCredential='fixture-invalid-credential';
    const machine=await anonymous.request.get('/api/socialhero/v1/capabilities',{headers:{Authorization:`Bearer ${invalidCredential}`}});
    await errorResponse(machine,401,'INVALID_CREDENTIAL');expect(await machine.text()).not.toContain(invalidCredential);
    const unchanged=await admin.request.get(endpoint);expect(unchanged.status()).toBe(200);expect((await unchanged.json()).connection).toMatchObject({status:'disconnected',publish:false});
  }finally{await anonymous.close();await player.close();await admin.close();}
});
