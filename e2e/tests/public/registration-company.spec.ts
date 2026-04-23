import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Public registration - Company', () => {
  test('can register as a company shareholder', async ({ page }) => {
    const uniqueEmail = `e2e-company-${Date.now()}@test.be`;

    await page.goto('/nl/demo/default/register');

    // Step 1: Welcome — "Ik ben nieuw"
    await expect(page.getByText('Ik ben nieuw')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ik ben nieuw').click();

    // Step 2: Details — select "Voor mijn bedrijf" beneficiary type
    await expect(page.getByText('Voor mijn bedrijf')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Voor mijn bedrijf').click();

    // Fill company details
    await page.locator('input[name="companyName"]').fill('Test Bedrijf BV');
    await page.locator('input[name="companyId"]').fill('0123456789');
    await page.locator('input[name="email"]').fill(uniqueEmail);
    await page.locator('input[name="street"]').fill('Bedrijfslaan');
    await page.locator('input[name="number"]').fill('42');
    await page.locator('input[name="postalCode"]').fill('2000');
    await page.locator('input[name="city"]').fill('Antwerpen');

    // Click "Volgende"
    await page.getByRole('button', { name: 'Volgende' }).click();

    // Step 3: Order — select share class
    await expect(page.getByRole('heading', { name: 'Selecteer aandelenklasse' })).toBeVisible({ timeout: 10_000 });
    await page.locator('[role="combobox"]').first().click();
    await page.waitForSelector('[role="option"]', { timeout: 5_000 });
    await page.locator('[role="option"]').first().click();

    // Accept privacy policy (coop terms checkbox only shown when channel has termsUrl)
    await page.locator('#privacy').click();

    // Complete registration
    await page.getByRole('button', { name: 'Registratie voltooien' }).click();

    // Step 4: Confirmation
    await expect(page.getByText('Je bestelling is bevestigd')).toBeVisible({ timeout: 15_000 });
  });
});
