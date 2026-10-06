import { test, expect } from '@playwright/test';
import { enableChargeCards } from '../../helpers/charge-cards';

test.describe('Admin settings', () => {
  test('settings page loads with all sections', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/settings');

    // Wait for settings heading in main content
    await expect(page.locator('main').getByRole('heading', { name: 'Instellingen', exact: true })).toBeVisible({ timeout: 10_000 });

    // Verify key sections
    await expect(page.getByRole('heading', { name: 'Algemene instellingen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bankgegevens' })).toBeVisible();
  });

  test('shows the charge-card settings when the feature is on', async ({ page }) => {
    await enableChargeCards();

    await page.goto('/nl/dashboard/admin/settings');

    await expect(page.getByRole('heading', { name: 'Laadpassen', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Laadpassen inschakelen')).toBeChecked();
    await expect(page.getByLabel('Prijs per pas (incl. btw)')).toHaveValue('6.00');
    await expect(page.getByLabel('Prijs vervangpas na verlies of diefstal (incl. btw)')).toHaveValue('12.00');
    await expect(page.getByLabel('Btw-tarief (%)')).toHaveValue('21');
  });
});
