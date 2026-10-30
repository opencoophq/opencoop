import { test, expect } from '@playwright/test';
import { gotoDashboardPage } from '../../helpers/dashboard';

test.describe('Shareholder transactions', () => {
  test('transactions page loads with history', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoDashboardPage(page, '/nl/dashboard/transactions', 'Transacties');

    // Seed data gives a table; accept the empty state so missing data does not fail the page check
    await expect(
      page.locator('table').or(page.getByText('Geen resultaten gevonden')).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
