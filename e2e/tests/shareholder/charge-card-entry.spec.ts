import { test, expect } from '@playwright/test';
import { enableChargeCards } from '../../helpers/charge-cards';

test.describe('Logged-in charge-card entry', () => {
  test.beforeAll(async () => {
    await enableChargeCards();
  });

  test('an active member opens the request form directly', async ({ page }) => {
    await page.goto('/nl/demo/laadpas');

    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards\?coop=demo&request=1$/, { timeout: 15_000 });
    await expect(page.getByTestId('charge-card-request').getByRole('heading', { name: 'Laadpas aanvragen' })).toBeVisible();
  });
});
