import { test, expect } from '@playwright/test';

test.describe('Admin transactions', () => {
  test('transactions page loads with table', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/transactions');

    await expect(page.getByRole('heading', { name: 'Transacties' })).toBeVisible({ timeout: 10_000 });

    // Table should be visible
    await expect(page.locator('table')).toBeVisible();
  });
});
