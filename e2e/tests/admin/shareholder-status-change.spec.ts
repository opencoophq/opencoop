import { test, expect } from '@playwright/test';

test.describe('Shareholder status change', () => {
  test('can change shareholder status and save', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    await page.getByText('Jan Peeters').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Find the status select — it's the combobox inside the personal info card
    // The status select shows the translated status value
    const statusTrigger = page.locator('button[role="combobox"]').filter({ hasText: /Actief|In behandeling|Inactief/ });
    await expect(statusTrigger).toBeVisible();

    // Note the original value
    const originalStatus = await statusTrigger.textContent();

    // Open the status dropdown and change to PENDING
    await statusTrigger.click();
    await page.getByRole('option', { name: 'In behandeling' }).click();

    // Save
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });

    // Reload the page and verify persistence
    await page.reload();
    const statusTriggerAfter = page.locator('button[role="combobox"]').filter({ hasText: /Actief|In behandeling|Inactief/ });
    await expect(statusTriggerAfter).toBeVisible({ timeout: 5_000 });
    await expect(statusTriggerAfter).toHaveText('In behandeling');

    // REVERT: change back to original status
    await statusTriggerAfter.click();
    await page.getByRole('option', { name: originalStatus!.trim() }).click();
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
  });
});
