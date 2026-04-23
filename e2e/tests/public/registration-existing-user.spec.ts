import { test, expect } from '@playwright/test';

// This test uses the shareholder auth state (jan.peeters@email.be)
test.use({ storageState: '.auth/shareholder.json' });

test.describe('Public registration - Existing user', () => {
  test('logged-in user can buy additional shares for existing shareholder', async ({ page }) => {
    await page.goto('/nl/demo/default/register');

    // Should skip Welcome step — go straight to Details with shareholder picker
    // Jan Peeters is the existing shareholder
    await expect(page.getByText('Jan Peeters')).toBeVisible({ timeout: 15_000 });

    // Select existing shareholder (should be pre-selected or clickable)
    await page.getByText('Jan Peeters').click();

    // Click "Volgende" to go to Order step
    await page.getByRole('button', { name: 'Volgende' }).click();

    // Step 2: Order — select share class
    await expect(page.getByRole('heading', { name: 'Selecteer aandelenklasse' })).toBeVisible({ timeout: 10_000 });
    await page.locator('[role="combobox"]').first().click();
    await page.waitForSelector('[role="option"]', { timeout: 5_000 });
    await page.locator('[role="option"]').first().click();

    // Accept privacy policy (coop terms checkbox only shown when channel has termsUrl)
    await page.locator('#privacy').click();

    // Complete registration
    await page.getByRole('button', { name: 'Registratie voltooien' }).click();

    // Confirmation
    await expect(page.getByText('Je bestelling is bevestigd')).toBeVisible({ timeout: 15_000 });
  });
});
