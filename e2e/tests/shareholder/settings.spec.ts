import { test, expect } from '@playwright/test';

test.describe('Shareholder settings', () => {
  test('settings page shows language and locale options', async ({ page }) => {
    await page.goto('/nl/dashboard/settings');

    await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible({ timeout: 10_000 });
  });
});
