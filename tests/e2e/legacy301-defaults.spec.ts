import {test,expect} from '@playwright/test';

test('fresh legacy 301 defaults to double opening while an explicit single choice remains authoritative',async({page,baseURL})=>{
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Fresh training acceptance requires loopback.');
  expect((await(await page.request.get('/api/session')).json()).local).toBe(true);
  await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:/Danny Goldenbelt/}).click();await expect(page).toHaveURL('/app');
  await page.goto('/app/training');
  const solo=page.locator('form').filter({has:page.getByRole('heading',{name:'Solo X01',exact:true})});
  await solo.getByText('Discipline, spelregels en handicap',{exact:true}).click();
  const score=solo.getByRole('combobox',{name:'Startscore',exact:true}),opening=solo.getByRole('combobox',{name:'Openen',exact:true});
  await expect(opening).toHaveValue('single');await score.selectOption('301');await expect(opening).toHaveValue('double');await score.selectOption('701');await expect(opening).toHaveValue('single');await score.selectOption('501');await expect(opening).toHaveValue('single');await score.selectOption('301');await expect(opening).toHaveValue('double');
  await opening.selectOption('single');await expect(opening).toHaveValue('single');
  const explicit=page.waitForResponse(r=>r.url().endsWith('/api/platform/actions')&&r.request().postDataJSON()?.action?.type==='training.create');
  await solo.getByRole('button',{name:'Start training',exact:true}).click();const single=await explicit;expect(single.status(),await single.text()).toBe(200);expect(single.request().postDataJSON().action).toMatchObject({startScore:301,inRule:'single'});expect((await single.json()).entity.state.game.inRule).toBe('single');
  await page.goto('/app/training');const bot=page.locator('form').filter({has:page.getByRole('heading',{name:'Dartbot',exact:true})});
  await bot.getByText('Openingsregel',{exact:true}).click();await bot.getByRole('combobox',{name:'Startscore',exact:true}).selectOption('301');await expect(bot.getByRole('combobox',{name:'Openen',exact:true})).toHaveValue('double');
  const created=page.waitForResponse(r=>r.url().endsWith('/api/platform/actions')&&r.request().postDataJSON()?.action?.type==='training.create');
  await bot.getByRole('button',{name:'Start training',exact:true}).click();const double=await created;expect(double.status(),await double.text()).toBe(200);expect(double.request().postDataJSON().action).toMatchObject({mode:'bot',startScore:301,inRule:'double'});expect((await double.json()).entity.state.game).toMatchObject({startScore:301,inRule:'double',opened:[false,false]});
});
