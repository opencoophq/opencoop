import { test, expect } from '@playwright/test';

test.describe('Purchase shares', () => {
  test('can open buy dialog and see share classes', async ({ page }) => {
    await page.goto('/nl/dashboard/shares');

    // Wait for shares page to load
    await expect(page.getByRole('heading', { name: 'Aandelen', exact: true })).toBeVisible({ timeout: 10_000 });

    // Click "Aandelen kopen" button (first one = parent's, minors may have their own)
    await page.getByRole('button', { name: 'Aandelen kopen' }).first().click();

    // Verify dialog opens with the title
    await expect(page.getByRole('heading', { name: 'Aandelen kopen' })).toBeVisible();

    // Verify share class select trigger is visible
    const selectTrigger = page.locator('[role="combobox"]');
    await expect(selectTrigger).toBeVisible();

    // Open the select dropdown and pick the first share class
    await selectTrigger.click();
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    await firstOption.click();

    // Verify quantity input is visible and defaults to 1
    const quantityInput = page.locator('input[type="number"]');
    await expect(quantityInput).toBeVisible();
    await expect(quantityInput).toHaveValue('1');

    // Verify total cost is shown after selecting a share class
    await expect(page.getByText('Totale kosten')).toBeVisible();

    // Submit purchase
    // The confirm button re-uses the "Aandelen kopen" label
    const buyButtons = page.getByRole('button', { name: 'Aandelen kopen' });
    await buyButtons.last().click();

    // Verify success: purchase submitted alert
    await expect(page.getByText('Aankoop succesvol ingediend')).toBeVisible({ timeout: 10_000 });

    // Close dialog
    await page.getByRole('button', { name: 'Bevestigen' }).click();
  });
});
