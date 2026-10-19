import { test, expect } from '@playwright/test';
import { enableChargeCards } from '../../helpers/charge-cards';

test.describe('Public charge-card entry', () => {
  test.beforeAll(async () => {
    await enableChargeCards();
  });

  test('asks a logged-out visitor whether they are already a member', async ({ page }) => {
    await page.goto('/nl/demo/laadpas');

    await expect(page.getByRole('heading', { name: 'Laadpas aanvragen' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Bent u al coöperant/ })).toBeVisible();
    await expect(page.getByTestId('charge-card-entry-yes')).toHaveAttribute(
      'href',
      '/nl/demo/login?redirect=%2Fnl%2Fdemo%2Flaadpas',
    );
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('a member logs in and lands on the charge-card request', async ({ page }) => {
    await page.goto('/nl/demo/laadpas');
    await page.getByTestId('charge-card-entry-yes').click();

    // /nl/demo/login is the static demo shortcut; it keeps the redirect query
    // and does not hop through /default/login.
    await expect(page).toHaveURL(/\/nl\/demo\/login\?redirect=%2Fnl%2Fdemo%2Flaadpas$/, {
      timeout: 15_000,
    });
    // The redirect is stored once the login page has hydrated.
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('opencoop-post-login-redirect')))
      .toContain('/nl/demo/laadpas');

    await page.locator('input[name="email"]').fill('jan.peeters@email.be');
    await page.getByRole('button', { name: 'Doorgaan' }).click();
    await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();
    await page.locator('input[name="password"]').fill('demo1234');
    await page.getByRole('button', { name: 'Inloggen' }).click();

    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards\?request=1$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Laadpas aanvragen' })).toBeVisible({ timeout: 15_000 });
  });

  test('someone who is not a member is sent into registration and comes back', async ({ page }) => {
    test.setTimeout(60_000);
    const uniqueEmail = `e2e-laadpas-${Date.now()}@test.be`;

    await page.goto('/nl/demo/laadpas');
    await page.getByTestId('charge-card-entry-no').click();
    await expect(page.getByRole('heading', { name: 'Word eerst coöperant' })).toBeVisible();
    await page.getByTestId('charge-card-entry-register').click();

    await expect(page).toHaveURL(/\/nl\/demo\/register\?/, { timeout: 15_000 });
    const redirect = new URL(page.url()).searchParams.get('redirect');
    expect(redirect).toBe('/nl/demo/laadpas');

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
      const detail = (await banner.count())
        ? (await banner.first().textContent())?.trim()
        : `HTTP ${resp.status()}`;
      throw new Error(`Registration API failed: ${detail}`);
    }

    const back = page.getByTestId('charge-card-return');
    await expect(back).toBeVisible({ timeout: 15_000 });
    await expect(back.getByRole('link', { name: 'Naar de aanvraag van uw laadpas' })).toHaveAttribute(
      'href',
      '/nl/demo/laadpas',
    );
    await back.getByRole('link', { name: 'Naar de aanvraag van uw laadpas' }).click();

    // A brand-new registration is not logged in and not yet paid, so the entry
    // asks again instead of opening a request the API would refuse.
    await expect(page).toHaveURL(/\/nl\/demo\/laadpas$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Bent u al coöperant/ })).toBeVisible();
  });

  test('an unsafe redirect is not stored', async ({ page }) => {
    await page.goto('/nl/demo/register?redirect=https%3A%2F%2Fevil.com');
    await expect(page.getByText('Ik ben nieuw')).toBeVisible({ timeout: 15_000 });
    const stored = await page.evaluate(() => localStorage.getItem('opencoop-post-login-redirect'));
    expect(stored).toBeNull();
  });
});

test.describe('[coopSlug] login keeps a laadpas redirect', () => {
  test('redirects 307 to the default channel and keeps ?redirect= in the Location header', async ({ page }) => {
    const response = await page.request.get('/nl/bronsgroen/login?redirect=%2Fnl%2Fbronsgroen%2Flaadpas', {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    const location = response.headers()['location'];
    expect(location).toMatch(/\/nl\/bronsgroen\/default\/login\?redirect=/);
    expect(location).toContain('redirect=%2Fnl%2Fbronsgroen%2Flaadpas');
  });
});
