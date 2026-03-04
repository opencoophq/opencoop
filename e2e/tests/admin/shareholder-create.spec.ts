import { test, expect } from '@playwright/test';

test.describe('Shareholder creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
  });

  test('can create an individual shareholder', async ({ page }) => {
    const uniqueEmail = `test-e2e-${Date.now()}@test.be`;

    // Click the add button to open the create dialog
    await page.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();

    // Dialog should be visible
    await expect(page.getByText('Voeg een nieuwe aandeelhouder toe')).toBeVisible({ timeout: 5_000 });

    // INDIVIDUAL is the default type, fill required fields
    const firstNameInput = page.locator('input').filter({ hasText: '' }).nth(0);
    await page.locator('[name="firstName"]').fill('Test');
    await page.locator('[name="lastName"]').fill('E2E');
    await page.locator('[name="email"]').fill(uniqueEmail);

    // Submit the form
    await page.getByRole('button', { name: 'Aandeelhouder toevoegen' }).nth(1).click();

    // Dialog should close and success message should appear
    await expect(page.getByText('Aandeelhouder succesvol toegevoegd')).toBeVisible({ timeout: 5_000 });

    // New shareholder should appear in the list
    await expect(page.getByText('Test E2E')).toBeVisible({ timeout: 5_000 });
  });

  test('can create a company shareholder', async ({ page }) => {
    const uniqueEmail = `test-company-e2e-${Date.now()}@test.be`;

    await page.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();
    await expect(page.getByText('Voeg een nieuwe aandeelhouder toe')).toBeVisible({ timeout: 5_000 });

    // Switch type to COMPANY
    // Click the type selector (first combobox in dialog)
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Bedrijf' }).click();

    // Fill company fields
    await page.locator('[name="companyName"]').fill('Test Bedrijf E2E');
    await page.locator('[name="email"]').fill(uniqueEmail);

    // Submit
    await dialog.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();

    // Verify success
    await expect(page.getByText('Aandeelhouder succesvol toegevoegd')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Test Bedrijf E2E')).toBeVisible({ timeout: 5_000 });
  });

  test('shows error for duplicate email', async ({ page }) => {
    await page.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();
    await expect(page.getByText('Voeg een nieuwe aandeelhouder toe')).toBeVisible({ timeout: 5_000 });

    // Fill with an existing email from seed data
    await page.locator('[name="firstName"]').fill('Duplicate');
    await page.locator('[name="lastName"]').fill('Test');
    await page.locator('[name="email"]').fill('jan.peeters@email.be');

    // Submit
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'Aandeelhouder toevoegen' }).click();

    // Should show an error inside the dialog (not close)
    await expect(dialog.locator('[role="alert"]')).toBeVisible({ timeout: 5_000 });
  });
});
