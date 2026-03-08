import { test, expect } from '@playwright/test';

test.describe('Edit Individual Shareholder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Search for the shareholder by email (name may not be on page 1)
    await page.getByPlaceholder('Zoeken').fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('row').filter({ hasText: 'jan.peeters@email.be' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);
  });

  test('can edit first name and save successfully', async ({ page }) => {
    const firstNameInput = page.locator('input[name="firstName"]');
    await expect(firstNameInput).toBeVisible();

    const originalValue = await firstNameInput.inputValue();

    await firstNameInput.clear();
    await firstNameInput.fill('Johannes');

    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Revert
    await firstNameInput.clear();
    await firstNameInput.fill(originalValue);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });

  test('can edit last name and save successfully', async ({ page }) => {
    const lastNameInput = page.locator('input[name="lastName"]');
    await expect(lastNameInput).toBeVisible();

    const originalValue = await lastNameInput.inputValue();

    await lastNameInput.clear();
    await lastNameInput.fill('Pieters');

    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Revert
    await lastNameInput.clear();
    await lastNameInput.fill(originalValue);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });

  test('can edit contact info (phone)', async ({ page }) => {
    const phoneInput = page.locator('input[name="phone"]');
    await expect(phoneInput).toBeVisible();

    const originalValue = await phoneInput.inputValue();

    await phoneInput.clear();
    await phoneInput.fill('+32 499 00 00 00');

    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Revert
    await phoneInput.clear();
    await phoneInput.fill(originalValue);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });

  test('can edit address fields', async ({ page }) => {
    const streetInput = page.locator('input[name="street"]');
    await expect(streetInput).toBeVisible();

    const originalStreet = await streetInput.inputValue();

    await streetInput.clear();
    await streetInput.fill('Stationsstraat');

    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Revert
    await streetInput.clear();
    await streetInput.fill(originalStreet);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });
});
