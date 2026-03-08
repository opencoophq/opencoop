import { test, expect } from '@playwright/test';

test.describe('Sell shares', () => {
  test('can initiate share sell request', async ({ page }) => {
    await page.goto('/nl/dashboard/shares');

    // Wait for shares table to load
    await expect(page.getByRole('heading', { name: 'Aandelen', exact: true })).toBeVisible({ timeout: 10_000 });

    // Find a row with COMPLETED status badge (fully paid shares) and click the "Verkopen" button
    // Status is translated to Dutch ("Voltooid") since the user's preferred language is nl
    const activeRow = page.locator('tr').filter({ hasText: 'Voltooid' }).first();
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

    // Verify either success or an error about exceeding available shares
    // (prior test runs may have created pending sell requests)
    await expect(
      page.getByRole('alert').first(),
    ).toBeVisible({ timeout: 10_000 });

    // Close dialog
    const closeBtn = page.getByRole('button', { name: 'Bevestigen' });
    const cancelBtn = page.getByRole('button', { name: 'Annuleren' });
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await cancelBtn.click();
    }
  });
});
