import { test, expect } from '@playwright/test';

test.describe('Audit history', () => {
  test('shows audit entry after editing shareholder', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    await page.getByText('Jan Peeters').click();
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

    // Verify an entry mentions "phone" field change
    await expect(auditTable.getByText('phone')).toBeVisible();

    // REVERT: restore original phone value
    await page.locator('input[name="phone"]').clear();
    await page.locator('input[name="phone"]').fill(original);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });

  test('audit history section is visible on detail page', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    await page.getByText('Els De Vos').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // The audit history card should always be visible
    await expect(page.getByText('Wijzigingsgeschiedenis')).toBeVisible({ timeout: 5_000 });
  });
});
