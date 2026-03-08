import { test, expect } from '@playwright/test';

test.describe('Admin settings', () => {
  test('settings page loads with all sections', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/settings');

    // Wait for settings heading in main content
    await expect(page.locator('main').getByRole('heading', { name: 'Instellingen', exact: true })).toBeVisible({ timeout: 10_000 });

    // Verify key sections
    await expect(page.getByRole('heading', { name: 'Algemene instellingen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bankgegevens' })).toBeVisible();
  });
});
