import { test, expect } from '@playwright/test';

test('integration reauthentication keeps its draft in the original tab until an explicit successful save', async ({ browser, baseURL }) => {
  if (!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
    throw new Error('This integration UI scenario requires the local fixture application.');
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const session = await context.request.get('/api/session');
    if (!(await session.json()).local) throw new Error('Local fixture authentication is required.');
    const page = await context.newPage();
    await page.goto('/inloggen?next=/app/platform/integraties');
    await page.getByRole('button', { name: /Danny Goldenbelt/ }).click();
    await expect(page.getByRole('heading', { name: 'Integraties', exact: true })).toBeVisible();

    // These are synthetic UI inputs. Neither PATCH reaches an integration adapter.
    const apiKey = 're_fixture_for_reauthentication_ui_only';
    const webhook = 'whsec_Zml4dHVyZV9mb3JfcmVhdXRoX3VpX29ubHk=';
    const attempts: Array<Record<string, unknown>> = [];
    await page.route('**/api/admin/integrations/resend', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      attempts.push(route.request().postDataJSON());
      await route.fulfill({
        status: attempts.length === 1 ? 403 : 200,
        contentType: 'application/json',
        body: JSON.stringify(attempts.length === 1
          ? { error: 'Log opnieuw in om beveiligde instellingen te wijzigen.', code: 'reauth_required' }
          : { ok: true }),
      });
    });
    const keyInput = page.getByLabel('API-sleutel toevoegen of vervangen');
    const webhookInput = page.getByLabel('Webhook signing secret', { exact: true });
    await keyInput.fill(apiKey);
    await webhookInput.fill(webhook);
    await page.getByRole('button', { name: 'Instellingen opslaan', exact: true }).click();

    const reauthNotice = page.getByRole('alert').filter({ hasText: 'Bevestig je aanmelding' });
    await expect(reauthNotice).toBeVisible();
    await expect(keyInput).toHaveValue(apiKey);
    await expect(webhookInput).toHaveValue(webhook);
    const reauthLink = page.getByRole('link', { name: /Opnieuw aanmelden in een nieuw tabblad/ });
    await expect(reauthLink).toHaveAttribute('target', '_blank');
    const popupPromise = context.waitForEvent('page');
    await reauthLink.click();
    const popup = await popupPromise;
    await expect(popup.getByRole('heading', { name: 'Bevestig je aanmelding', exact: true })).toBeVisible();
    const target = new URL(popup.url());
    expect(target.pathname).toBe('/inloggen');
    expect([...target.searchParams.keys()].sort()).toEqual(['next', 'reauth']);
    expect(target.searchParams.get('next')).toBe('/app/platform/integraties');
    expect(target.searchParams.get('reauth')).toBe('1');
    await expect(popup.getByRole('link', { name: /Terug als/ })).toHaveCount(0);
    await expect(popup.getByRole('link', { name: 'Doorgaan met Google' })).toHaveAttribute('href', /[?&]reauth=1(?:&|$)/);
    await popup.goto('/inloggen?next=/app/platform/integraties&reauth=otp');
    await expect(popup.getByText('Meld je opnieuw aan met een e-mailcode om Google veilig uit te schakelen.')).toBeVisible();
    await expect(popup.getByRole('link', { name: 'Doorgaan met Google' })).toHaveCount(0);
    await expect(popup.getByRole('link', { name: /Terug als/ })).toHaveCount(0);
    // Human/provider authentication is outside this local UI regression.
    await popup.close();
    await expect(keyInput).toHaveValue(apiKey);
    await expect(webhookInput).toHaveValue(webhook);
    expect(attempts).toHaveLength(1);
    const storage = await page.evaluate(() => JSON.stringify({
      local: Object.values(localStorage), session: Object.values(sessionStorage),
    }));
    expect(storage).not.toContain(apiKey);
    expect(storage).not.toContain(webhook);

    await page.getByRole('button', { name: 'Instellingen opslaan', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Instellingen opgeslagen' })).toBeVisible();
    await expect(reauthNotice).toHaveCount(0);
    await expect(keyInput).toHaveValue('');
    await expect(webhookInput).toHaveValue('');
    expect(attempts).toHaveLength(2);
    expect(attempts[1].apiKey).toBe(apiKey);
    expect(attempts[1].webhookSigningSecret).toBe(webhook);
  } finally {
    await context.close();
  }
});
