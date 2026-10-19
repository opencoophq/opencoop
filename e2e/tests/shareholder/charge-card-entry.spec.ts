import { test, expect } from '@playwright/test';
import { enableChargeCards } from '../../helpers/charge-cards';

test.describe('Logged-in charge-card entry', () => {
  test.beforeAll(async () => {
    await enableChargeCards();
  });

  test('an active shareholder goes straight to the request', async ({ page }) => {
    await page.goto('/nl/demo/laadpas');

    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards\?request=1$/, { timeout: 20_000 });
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Laadpas aanvragen' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
