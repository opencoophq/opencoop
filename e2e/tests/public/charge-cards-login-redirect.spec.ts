import { test, expect } from '@playwright/test';

test.describe('Login keeps the charge-cards deep link', () => {
  test('a logged-out visit goes to login and remembers the page', async ({ page }) => {
    await page.goto('/nl/dashboard/charge-cards');

    await expect(page).toHaveURL(/\/nl\/login$/);
    const stored = await page.evaluate(() => localStorage.getItem('opencoop-post-login-redirect'));
    expect(JSON.parse(stored ?? '{}').path).toBe('/nl/dashboard/charge-cards');
  });

  test('the branded coop login returns the shareholder to the charge-cards page', async ({ page }) => {
    // /nl/demo/login is a static shortcut that renders the demo coop's
    // default-channel login inline (apps/web/src/app/[locale]/demo/login/page.tsx);
    // it does not navigate through the dynamic [coopSlug]/login redirect, so the
    // URL stays put here. What matters is where login lands afterwards.
    await page.goto('/nl/demo/login?redirect=%2Fnl%2Fdashboard%2Fcharge-cards');

    await page.locator('input[name="email"]').fill('jan.peeters@email.be');
    await page.getByRole('button', { name: 'Doorgaan' }).click();
    await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();
    await page.locator('input[name="password"]').fill('demo1234');
    await page.getByRole('button', { name: 'Inloggen' }).click();

    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards$/, { timeout: 15_000 });
  });

  test('an expired session still remembers the deep link and returns to it after a fresh login', async ({ page }) => {
    // A returning bronsgroen.be visitor with a stale token: the dashboard
    // layout sees a token and proceeds past its own "remember and redirect"
    // branch, then /auth/me 401s and the refresh fails too. api.ts's
    // clearAuthAndRedirect must remember the deep link itself before it
    // clears the dead session and sends the user to /login.
    // Seed the stale session once, on an already-loaded page. An
    // addInitScript would re-seed it on every subsequent navigation too,
    // including the one clearAuthAndRedirect makes to /login, which would
    // resurrect the dead tokens there and bounce forever between /dashboard
    // and /login.
    await page.goto('/nl/login');
    await page.evaluate(() => {
      localStorage.setItem('accessToken', 'garbage-access-token');
      localStorage.setItem('refreshToken', 'garbage-refresh-token');
      localStorage.setItem('user', JSON.stringify({ email: 'jan.peeters@email.be', role: 'SHAREHOLDER' }));
    });

    await page.goto('/nl/dashboard/charge-cards');

    await expect(page).toHaveURL(/\/nl\/login$/, { timeout: 15_000 });
    const stored = await page.evaluate(() => localStorage.getItem('opencoop-post-login-redirect'));
    expect(JSON.parse(stored ?? '{}').path).toBe('/nl/dashboard/charge-cards');

    await page.locator('input[name="email"]').fill('jan.peeters@email.be');
    await page.getByRole('button', { name: 'Doorgaan' }).click();
    await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();
    await page.locator('input[name="password"]').fill('demo1234');
    await page.getByRole('button', { name: 'Inloggen' }).click();

    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards$/, { timeout: 15_000 });
  });
});

test.describe('[coopSlug] login redirect carries the query string', () => {
  test('redirects 307 to the default channel and keeps ?redirect= in the Location header', async ({ page }) => {
    // These server pages (apps/web/src/app/[locale]/[coopSlug]/login/page.tsx
    // and .../[coopSlug]/page.tsx) do not check whether the coop exists, so no
    // seeded coop is needed here — a request-level check is enough.
    const response = await page.request.get(
      '/nl/any-slug-at-all/login?redirect=%2Fnl%2Fdashboard%2Fcharge-cards',
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(307);
    const location = response.headers()['location'];
    expect(location).toMatch(/\/nl\/any-slug-at-all\/default\/login\?redirect=/);
    expect(location).toContain('redirect=%2Fnl%2Fdashboard%2Fcharge-cards');
  });
});
