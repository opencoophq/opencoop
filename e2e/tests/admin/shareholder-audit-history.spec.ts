import { test, expect } from '@playwright/test';

test.describe('Audit history', () => {
  test('shows audit entry after editing shareholder', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Wait for the table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });
    // Use the search box to find Jan Peeters by email (name may have changed from prior test runs)
    await page.getByPlaceholder('Zoeken').fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });
    const row = page.getByRole('row').filter({ hasText: 'jan.peeters@email.be' });
    await row.getByRole('link').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Edit the phone field to a new value
    const phoneInput = page.locator('input[name="phone"]');
    await expect(phoneInput).toBeVisible();
    const original = await phoneInput.inputValue();

    await phoneInput.clear();
    await phoneInput.fill('+32 479 99 99 99');

    // Save changes
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Reload to ensure audit log is fetched fresh
    await page.reload();

    // Scroll to audit history section
    const auditHeading = page.getByText('Wijzigingsgeschiedenis');
    await expect(auditHeading).toBeVisible({ timeout: 5_000 });
    await auditHeading.scrollIntoViewIfNeeded();

    // Verify at least one audit entry exists in the table
    const auditTable = auditHeading.locator('..').locator('..').locator('table');
    await expect(auditTable).toBeVisible({ timeout: 5_000 });

    // Verify there is at least one row in the audit table body
    const auditRows = auditTable.locator('tbody tr');
    await expect(auditRows.first()).toBeVisible({ timeout: 5_000 });

    // Verify an entry mentions the phone or address field change
    // (The API may log the change under "phone" or "address" depending on how the form data is diffed)
    await expect(
      auditTable.getByText(/phone|address/).first(),
    ).toBeVisible();

    // REVERT: restore original phone value
    await page.locator('input[name="phone"]').clear();
    await page.locator('input[name="phone"]').fill(original);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });

  test('audit history section is visible on detail page', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Wait for the table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });
    // Use the search box to find Els De Vos by email (more resilient than name)
    await page.getByPlaceholder('Zoeken').fill('els.devos@email.be');
    await expect(page.getByRole('cell', { name: 'els.devos@email.be' })).toBeVisible({ timeout: 10_000 });
    const row = page.getByRole('row').filter({ hasText: 'els.devos@email.be' });
    await row.getByRole('link').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // The audit history card should always be visible
    await expect(page.getByText('Wijzigingsgeschiedenis')).toBeVisible({ timeout: 5_000 });
  });
});
