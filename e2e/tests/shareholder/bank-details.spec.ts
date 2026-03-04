import { test, expect } from '@playwright/test';

test.describe('Bank details', () => {
  test('can update bank IBAN', async ({ page }) => {
    await page.goto('/nl/dashboard/personal-data');

    const ibanInput = page.locator('input[name="bankIban"]');
    await expect(ibanInput).toBeVisible({ timeout: 10_000 });

    const original = await ibanInput.inputValue();

    await ibanInput.clear();
    await ibanInput.fill('BE71096123456769');

    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Revert
    await ibanInput.clear();
    await ibanInput.fill(original);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });

  test('can update bank BIC', async ({ page }) => {
    await page.goto('/nl/dashboard/personal-data');

    const bicInput = page.locator('input[name="bankBic"]');
    await expect(bicInput).toBeVisible({ timeout: 10_000 });

    const original = await bicInput.inputValue();

    await bicInput.clear();
    await bicInput.fill('KREDBEBB');

    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });

    // Revert
    await bicInput.clear();
    await bicInput.fill(original);
    await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
    await expect(page.getByText('Succesvol opgeslagen')).toBeVisible({ timeout: 5_000 });
  });
});
