import { test, expect } from '@playwright/test';

// Public registration tests — no stored auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Public registration - Individual', () => {
  test('can register as a new individual shareholder', async ({ page }) => {
    const uniqueEmail = `e2e-ind-${Date.now()}@test.be`;

    // Capture any alert dialogs (registration errors surface via native alert())
    let dialogMessage = '';
    page.on('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss();
    });

    // Navigate to registration page
    await page.goto('/nl/demo/default/register');

    // Step 1: Welcome — click "Ik ben nieuw" card
    await expect(page.getByText('Ik ben nieuw')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ik ben nieuw').click();

    // Step 2: Details — beneficiary type defaults to "self", fill individual form
    await expect(page.locator('input[name="firstName"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('Registratie');
    // Open the date picker popover (button text matches birthdate placeholder)
    await page.getByRole('button', { name: /datum|date|pick|geboortedatum/i }).first().click();
    // Wait for the popover calendar to appear, then use dropdowns
    const popover = page.locator('[data-radix-popper-content-wrapper]');
    await expect(popover).toBeVisible({ timeout: 5_000 });
    // Select year 1990 and month January from the caption dropdowns
    await popover.locator('select').last().selectOption('1990');
    await popover.locator('select').first().selectOption('0');
    // Wait for calendar to re-render after dropdown change, then click day 15
    await page.waitForTimeout(500);
    await popover.getByRole('gridcell', { name: '15', exact: true }).click();
    await page.locator('input[name="email"]').fill(uniqueEmail);
    await page.locator('input[name="street"]').fill('Teststraat');
    await page.locator('input[name="number"]').fill('1');
    await page.locator('input[name="postalCode"]').fill('1000');
    await page.locator('input[name="city"]').fill('Brussel');

    // Click "Volgende" to proceed to Order step
    await page.getByRole('button', { name: 'Volgende' }).click();

    // Step 3: Order — select share class
    await expect(page.getByRole('heading', { name: 'Selecteer aandelenklasse' })).toBeVisible({ timeout: 10_000 });

    // Open share class dropdown (Radix UI Select) and pick first option
    const shareClassCombobox = page.locator('[role="combobox"]').first();
    await shareClassCombobox.click();
    await page.waitForSelector('[role="option"]', { timeout: 5_000 });
    await page.locator('[role="option"]').first().click();

    // Quantity defaults to 1 (from minShares)
    const quantityInput = page.locator('input[type="number"]');
    await expect(quantityInput).toBeVisible();

    // Accept privacy policy (coop terms checkbox only shown when channel has termsUrl)
    await page.locator('#privacy').click();

    // Click "Registratie voltooien"
    await page.getByRole('button', { name: 'Registratie voltooien' }).click();

    // Wait for navigation to Payment step or dialog error
    await page.waitForTimeout(3_000);

    // If a dialog appeared, the API call failed — fail with useful message
    if (dialogMessage) {
      throw new Error(`Registration API failed: ${dialogMessage}`);
    }

    // Step 4: Payment confirmation
    await expect(page.getByText('Registratie voltooid')).toBeVisible({ timeout: 15_000 });

    // Verify bank payment details are shown (OGM code format: +++XXX/XXXX/XXXXX+++)
    await expect(page.getByText('+++')).toBeVisible();
  });

  test('channel landing page shows share classes and navigation', async ({ page }) => {
    await page.goto('/nl/demo/default');

    // Verify share classes heading loads
    await expect(page.getByRole('heading', { name: 'Aandelenklassen' })).toBeVisible({ timeout: 15_000 });

    // Verify share classes from seed data
    await expect(page.getByText('Aandeel A')).toBeVisible();
    await expect(page.getByText('Aandeel B')).toBeVisible();

    // Verify login and register buttons
    await expect(page.getByRole('link', { name: 'Inloggen' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Registreren' })).toBeVisible();
  });
});
