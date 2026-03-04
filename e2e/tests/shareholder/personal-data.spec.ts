import { test, expect } from '@playwright/test';

test.describe('Personal data page', () => {
  test('form is pre-filled with shareholder data', async ({ page }) => {
    await page.goto('/nl/dashboard/personal-data');

    const firstNameInput = page.locator('input[name="firstName"]');
    await expect(firstNameInput).toBeVisible({ timeout: 10_000 });
    await expect(firstNameInput).toHaveValue('Jan');

    const lastNameInput = page.locator('input[name="lastName"]');
    await expect(lastNameInput).toBeVisible();
    await expect(lastNameInput).toHaveValue('Peeters');
  });

  test('can edit phone number', async ({ page }) => {
    await page.goto('/nl/dashboard/personal-data');

    const phoneInput = page.locator('input[name="phone"]');
    await expect(phoneInput).toBeVisible({ timeout: 10_000 });

    const original = await phoneInput.inputValue();

    await phoneInput.clear();
    await phoneInput.fill('+32 479 00 00 00');

    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Revert
    await phoneInput.clear();
    await phoneInput.fill(original);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });

  test('email field is read-only', async ({ page }) => {
    await page.goto('/nl/dashboard/personal-data');

    // The email input has no name attribute; it's the disabled input inside the contact card
    const emailInput = page.locator('input[disabled]').first();
    await expect(emailInput).toBeVisible({ timeout: 10_000 });
    await expect(emailInput).toBeDisabled();
    // Verify it contains the shareholder's email
    await expect(emailInput).toHaveValue('jan.peeters@email.be');
  });
});
