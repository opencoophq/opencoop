import { test, expect } from '@playwright/test';

test.describe('Sell shares for shareholder', () => {
  test('can sell shares via admin dialog', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    await page.getByText('Jan Peeters').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Click the sell button ("Aandelen verkopen")
    await page.getByRole('button', { name: 'Aandelen verkopen' }).click();

    // Wait for dialog to appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Selecteer aandelen om te verkopen')).toBeVisible();

    // A share should be pre-selected in the dropdown
    await expect(dialog.getByRole('combobox').first()).toBeVisible();

    // Set quantity to 1
    const quantityInput = dialog.locator('input[type="number"]');
    await expect(quantityInput).toBeVisible();
    await quantityInput.fill('1');

    // Verify refund amount is shown
    await expect(dialog.getByText('Totale terugbetaling')).toBeVisible();

    // Click confirm sell button ("Verkoop bevestigen")
    await dialog.getByRole('button', { name: 'Verkoop bevestigen' }).click();

    // After sale, payment details should appear with success message
    await expect(dialog.getByText('Uw verkoopverzoek is ingediend')).toBeVisible({ timeout: 10_000 });

    // Close the dialog
    await dialog.getByRole('button', { name: 'Bevestigen' }).click();
  });
});
