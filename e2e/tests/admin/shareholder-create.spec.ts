import { test, expect } from '@playwright/test';

test.describe('Shareholder creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Wait for the shareholder table to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });
  });

  test('can create an individual shareholder', async ({ page }) => {
    const uniqueEmail = `test-e2e-${Date.now()}@test.be`;

    // Click the add button to open the create dialog
    await page.getByRole('button', { name: 'Aandeelhouder toevoegen' }).first().click();

    // Dialog should be visible
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // INDIVIDUAL is the default type, fill required fields
    await dialog.locator('input[name="firstName"]').fill('Test');
    await dialog.locator('input[name="lastName"]').fill('E2E');
    await dialog.locator('input[name="email"]').fill(uniqueEmail);

    // Submit the form (click the submit button inside the dialog)
    await dialog.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();

    // Dialog should close and success message should appear
    await expect(page.getByText('Aandeelhouder succesvol toegevoegd')).toBeVisible({ timeout: 10_000 });

    // New shareholder should appear in the list (search by unique email to avoid duplicates)
    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 5_000 });
  });

  test('can create a company shareholder', async ({ page }) => {
    const uniqueEmail = `test-company-e2e-${Date.now()}@test.be`;

    await page.getByRole('button', { name: 'Aandeelhouder toevoegen' }).first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Switch type to COMPANY
    // Click the type selector (first combobox in dialog)
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Bedrijf' }).click();

    // Fill company fields
    await dialog.locator('input[name="companyName"]').fill('Test Bedrijf E2E');
    await dialog.locator('input[name="email"]').fill(uniqueEmail);

    // Submit
    await dialog.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();

    // Verify success
    await expect(page.getByText('Aandeelhouder succesvol toegevoegd')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 5_000 });
  });

  test('shows error for duplicate email', async ({ page }) => {
    await page.getByRole('button', { name: 'Aandeelhouder toevoegen' }).first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Fill with an existing email from seed data
    await dialog.locator('input[name="firstName"]').fill('Duplicate');
    await dialog.locator('input[name="lastName"]').fill('Test');
    await dialog.locator('input[name="email"]').fill('jan.peeters@email.be');

    // Submit
    await dialog.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();

    // Should show an error inside the dialog (not close)
    await expect(dialog.locator('[role="alert"]')).toBeVisible({ timeout: 5_000 });
  });
});
