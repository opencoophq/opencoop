import { test, expect } from '@playwright/test';

test.describe('Sell shares', () => {
  test('can initiate share sell request', async ({ page }) => {
    await page.goto('/nl/dashboard/shares');

    // Wait for shares table to load
    await expect(page.getByRole('heading', { name: 'Aandelen' })).toBeVisible({ timeout: 10_000 });

    // Find a row with ACTIVE status badge and click the "Verkopen" button on that row
    const activeRow = page.locator('tr').filter({ hasText: 'ACTIVE' }).first();
    await expect(activeRow).toBeVisible({ timeout: 10_000 });

    await activeRow.getByRole('button', { name: 'Verkopen' }).click();

    // Verify sell dialog opens
    await expect(page.getByRole('heading', { name: 'Aandelen verkopen' })).toBeVisible();

    // Verify quantity input is visible and defaults to 1
    const quantityInput = page.locator('input[type="number"]');
    await expect(quantityInput).toBeVisible();
    await expect(quantityInput).toHaveValue('1');

    // Verify refund amount is shown
    await expect(page.getByText('Totale terugbetaling')).toBeVisible();

    // Click confirm sell
    await page.getByRole('button', { name: 'Verkoop bevestigen' }).click();

    // Verify success message
    await expect(page.getByText('Uw verkoopverzoek is ingediend')).toBeVisible({ timeout: 10_000 });

    // Close dialog
    await page.getByRole('button', { name: 'Bevestigen' }).click();
  });
});
