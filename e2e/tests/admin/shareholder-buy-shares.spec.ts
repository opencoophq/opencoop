import { test, expect } from '@playwright/test';

test.describe('Buy shares for shareholder', () => {
  test('can purchase shares via admin dialog', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    await page.getByText('Jan Peeters').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Click the buy button ("Aandelen kopen")
    await page.getByRole('button', { name: 'Aandelen kopen' }).click();

    // Wait for dialog to appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // A share class should be pre-selected in the dropdown
    await expect(dialog.getByRole('combobox').first()).toBeVisible();

    // Set quantity to 1 (should be default)
    const quantityInput = dialog.locator('input[type="number"]');
    await expect(quantityInput).toBeVisible();
    await quantityInput.fill('1');

    // Verify total cost is shown
    await expect(dialog.getByText('Totaal')).toBeVisible();

    // Click confirm button
    await dialog.getByRole('button', { name: 'Bevestigen' }).click();

    // After purchase, payment details should appear (QR code or success message)
    await expect(dialog.getByText('Succes')).toBeVisible({ timeout: 10_000 });

    // Close the dialog
    await dialog.getByRole('button', { name: 'Bevestigen' }).click();
  });
});
