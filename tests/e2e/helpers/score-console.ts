import {expect,type Page} from '@playwright/test';

// Existing detailed-media and administration scenarios intentionally leave the
// new automatic console. Dedicated console scenarios assert the fullscreen flow.
export async function openMatchDetails(page:Page){
  await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toBeVisible();
  await page.getByRole('button',{name:'Terug naar wedstrijd',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toHaveCount(0);
}
