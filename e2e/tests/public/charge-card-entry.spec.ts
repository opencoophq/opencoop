import { test, expect } from '@playwright/test';
import { enableChargeCards } from '../../helpers/charge-cards';

test.describe('Public charge-card entry', () => {
  test.beforeAll(async () => {
    await enableChargeCards();
  });

  test('asks whether the visitor is already a member, and keeps the destination', async ({ page }) => {
    await page.goto('/nl/demo/laadpas');

    await expect(page.getByRole('heading', { name: 'Bent u al coöperant?' })).toBeVisible({ timeout: 15_000 });

    const yes = page.getByTestId('charge-card-yes');
    await expect(yes).toHaveAttribute('href', /\/nl\/demo\/login\?redirect=/);
    const yesHref = await yes.getAttribute('href');
    const redirect = new URL(yesHref ?? '', 'http://localhost:3002').searchParams.get('redirect');
    expect(redirect).toBe('/nl/dashboard/charge-cards?coop=demo&request=1');

    const no = page.getByTestId('charge-card-no');
    const noHref = await no.getAttribute('href');
    const returnTo = new URL(noHref ?? '', 'http://localhost:3002').searchParams.get('returnTo');
    expect(noHref).toContain('/nl/demo/register');
    expect(returnTo).toBe('/nl/demo/laadpas?after=registration');
  });

  test('an unknown cooperative does not offer the form', async ({ page }) => {
    await page.goto('/nl/no-such-coop-xyz/laadpas');
    await expect(page.getByText('Wij vonden deze coöperatie niet.')).toBeVisible({ timeout: 15_000 });
  });

  test('a member who logs in from the entry lands on the request form', async ({ page }) => {
    await page.goto('/nl/demo/laadpas');
    await page.getByTestId('charge-card-yes').click();

    await page.locator('input[name="email"]').fill('jan.peeters@email.be');
    await page.getByRole('button', { name: 'Doorgaan' }).click();
    await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();
    await page.locator('input[name="password"]').fill('demo1234');
    await page.getByRole('button', { name: 'Inloggen' }).click();

    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards\?coop=demo&request=1$/, { timeout: 15_000 });
    await expect(page.getByTestId('charge-card-request').getByRole('heading', { name: 'Laadpas aanvragen' })).toBeVisible();
  });

  test('after registration the visitor is told the card waits on an active membership', async ({ page }) => {
    const uniqueEmail = `e2e-laadpas-${Date.now()}@test.be`;
    const returnTo = encodeURIComponent('/nl/demo/laadpas?after=registration');
    await page.goto(`/nl/demo/default/register?returnTo=${returnTo}`);

    await expect(page.getByText('Ik ben nieuw')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ik ben nieuw').click();

    await expect(page.locator('input[name="firstName"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('Laadpas');
    await page.locator('input[name="email"]').fill(uniqueEmail);
    await page.locator('input[name="street"]').fill('Teststraat');
    await page.locator('input[name="number"]').fill('1');
    await page.locator('input[name="postalCode"]').fill('1000');
    await page.locator('input[name="city"]').fill('Brussel');
    await page.getByRole('button', { name: 'Volgende' }).click();

    await expect(page.getByRole('heading', { name: 'Selecteer aandelenklasse' })).toBeVisible({ timeout: 10_000 });
    await page.locator('[role="combobox"]').first().click();
    await page.waitForSelector('[role="option"]', { timeout: 5_000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('#privacy').click();

    const registerResponse = page.waitForResponse(
      (resp) => resp.url().includes('/register') && resp.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Registratie voltooien' }).click();
    const resp = await registerResponse;
    if (!resp.ok()) {
      const banner = page.locator('[role="alert"]');
      const detail = (await banner.count()) ? (await banner.first().textContent())?.trim() : `HTTP ${resp.status()}`;
      throw new Error(`Registration API failed: ${detail}`);
    }

    await expect(page.getByTestId('charge-card-return')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Verder naar de laadpas' }).click();

    await expect(page).toHaveURL(/\/nl\/demo\/laadpas\?after=registration$/);
    await expect(page.getByTestId('charge-card-after-registration')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Eerst wordt u coöperant, daarna volgt de laadpas' })).toBeVisible();
  });
});
