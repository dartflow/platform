import {expect,type Page} from '@playwright/test';

// Existing detailed-media and administration scenarios intentionally leave the
// new automatic console. Dedicated console scenarios assert the fullscreen flow.
export async function openMatchDetails(page:Page){
  await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toBeVisible();
  await page.getByRole('button',{name:'Terug naar wedstrijd',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toHaveCount(0);
}

/** These scenarios verify exact hit journals; opt in through the real UI. */
export async function choosePerDartInput(page:Page,game='X01'){
  return chooseScoreInputMode(page,'per-dart',game);
}

export async function chooseScoreInputMode(page:Page,mode:'total'|'per-dart',game='X01'){
  const dialog=page.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});
  await expect(dialog).toBeVisible();
  const preference=dialog.getByRole('combobox',{name:`Score-invoer ${game}`,exact:true});
  const target=mode==='per-dart'?dialog.getByLabel('Ingevoerde pijlen'):dialog.getByLabel('Bezoekscore',{exact:true});
  const revealPreference=async()=>{
    if(await preference.isVisible())return;
    const summary=dialog.locator('summary').filter({hasText:'Stand, darts & correctie'});
    if(await summary.count())await summary.click();
    else await dialog.getByRole('button',{name:'Darts & correctie',exact:true}).click();
    await expect(preference).toBeVisible();
  };
  await revealPreference();
  await preference.selectOption(mode);
  await expect(dialog).toHaveCount(1);
  await expect(target).toBeVisible();
  // Core matches and legacy training replace their frame on a mode change.
  // Open the replacement frame's lazy options before checking the saved enum.
  await revealPreference();
  await expect(preference).toHaveValue(mode);
  const close=dialog.getByRole('button',{name:'Opties sluiten',exact:true});
  if(await close.isVisible())await close.click();
  else{
    const summary=dialog.locator('details[open] > summary').filter({hasText:'Stand, darts & correctie'});
    if(await summary.count())await summary.click();
  }
  await expect(dialog).toHaveCount(1);
  await expect(target).toBeVisible();
}
