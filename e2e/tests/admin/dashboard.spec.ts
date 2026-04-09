import { test, expect } from '@playwright/test';

test.describe('Admin dashboard', () => {
  test('displays overview stats and navigation', async ({ page }) => {
    await page.goto('/nl/dashboard/admin');

    // Main heading includes coop name
    await expect(page.getByRole('heading', { name: /Overzicht/i })).toBeVisible({ timeout: 10_000 });

    // Verify stats cards are shown
    await expect(page.getByRole('heading', { name: 'Totaal aandeelhouders' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Totaal kapitaal' })).toBeVisible();

    // Verify sidebar navigation links
    await expect(page.getByRole('link', { name: /Aandeelhouders/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Transacties/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Instellingen' }).first()).toBeVisible();
  });
});
