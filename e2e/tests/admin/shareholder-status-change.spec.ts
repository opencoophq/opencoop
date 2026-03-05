import { test, expect } from '@playwright/test';

test.describe('Shareholder status change', () => {
  test('can change shareholder status and save', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Wait for the table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });
    // Use the search box to find Jan Peeters by email (name may have changed from prior test runs)
    await page.getByPlaceholder('Zoeken').fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });
    const row = page.getByRole('row').filter({ hasText: 'jan.peeters@email.be' });
    await row.getByRole('link').click();
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
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Reload the page and verify persistence
    await page.reload();
    const statusTriggerAfter = page.locator('button[role="combobox"]').filter({ hasText: /Actief|In behandeling|Inactief/ });
    await expect(statusTriggerAfter).toBeVisible({ timeout: 5_000 });
    await expect(statusTriggerAfter).toHaveText('In behandeling');

    // REVERT: change back to original status
    await statusTriggerAfter.click();
    await page.getByRole('option', { name: originalStatus!.trim(), exact: true }).click();
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });
});
