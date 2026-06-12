import { test, expect } from '@playwright/test';

// Public registration tests — no stored auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Public registration - Individual', () => {
  test('can register as a new individual shareholder', async ({ page }) => {
    const uniqueEmail = `e2e-ind-${Date.now()}@test.be`;

    // Navigate to registration page
    await page.goto('/nl/demo/default/register');

    // Step 1: Welcome — click "Ik ben nieuw" card
    await expect(page.getByText('Ik ben nieuw')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ik ben nieuw').click();

    // Step 2: Details — beneficiary type defaults to "self", fill individual form
    await expect(page.locator('input[name="firstName"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('Registratie');
    // Skip birthDate — it's optional in the schema and the date picker dropdown
    // navigation is unreliable in CI headless browsers
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

    // Submit registration and wait for the actual API response rather than a fixed
    // sleep. This is deterministic and lets us surface the real failure reason.
    const registerResponse = page.waitForResponse(
      (resp) => resp.url().includes('/register') && resp.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Registratie voltooien' }).click();
    const resp = await registerResponse;

    // On failure the funnel shows an inline error banner (role="alert"); surface its
    // text so a CI failure points at the real cause instead of a generic timeout.
    if (!resp.ok()) {
      const banner = page.locator('[role="alert"]');
      const detail = (await banner.count())
        ? (await banner.first().textContent())?.trim()
        : `HTTP ${resp.status()}`;
      throw new Error(`Registration API failed: ${detail}`);
    }

    // Step 4: Payment confirmation — assert the DB-visible outcome of the purchase:
    // a confirmed order with a generated OGM payment code (+++XXX/XXXX/XXXXX+++).
    await expect(page.getByText('Je bestelling is bevestigd')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+/)).toBeVisible();
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
