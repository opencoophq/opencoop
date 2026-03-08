import { test, expect } from '@playwright/test';

test.describe('Shareholder transactions', () => {
  test('transactions page loads with history', async ({ page }) => {
    await page.goto('/nl/dashboard/transactions');

    await expect(page.getByRole('heading', { name: 'Transacties' })).toBeVisible({ timeout: 10_000 });

    // Table should be visible with transaction data from seed
    await expect(page.locator('table')).toBeVisible();
  });
});
