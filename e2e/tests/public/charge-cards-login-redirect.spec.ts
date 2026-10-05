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
});
