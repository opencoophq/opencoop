import { test as setup, expect } from '@playwright/test';

setup('authenticate as admin', async ({ page }) => {
  // Navigate to login page
  await page.goto('/nl/login');

  // Step 1: Enter email
  await page.locator('input[name="email"]').fill('admin@zonnecooperatie.be');
  await page.getByRole('button', { name: 'Doorgaan' }).click();

  // Step 2: Choose password login
  await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();

  // Step 3: Enter password and login
  await page.locator('input[name="password"]').fill('demo1234');
  await page.getByRole('button', { name: 'Inloggen' }).click();

  // Wait for redirect to dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  // Wait for the JWT to be persisted before snapshotting storageState. This is the
  // exact artifact storageState captures, so polling for it (instead of a fixed
  // sleep) makes the snapshot deterministic on slow CI runners.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('accessToken')), { timeout: 10_000 })
    .not.toBeNull();

  // Dismiss cookie notice so it doesn't block E2E interactions
  await page.evaluate(() => localStorage.setItem('opencoop-cookie-notice-dismissed', '1'));

  // Save auth state
  await page.context().storageState({ path: '.auth/admin.json' });
});

setup('authenticate as shareholder', async ({ page }) => {
  await page.goto('/nl/login');

  await page.locator('input[name="email"]').fill('jan.peeters@email.be');
  await page.getByRole('button', { name: 'Doorgaan' }).click();

  await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();

  await page.locator('input[name="password"]').fill('demo1234');
  await page.getByRole('button', { name: 'Inloggen' }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  // Wait for the JWT to be persisted before snapshotting storageState (was a fixed sleep).
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('accessToken')), { timeout: 10_000 })
    .not.toBeNull();

  // Dismiss cookie notice so it doesn't block E2E interactions
  await page.evaluate(() => localStorage.setItem('opencoop-cookie-notice-dismissed', '1'));

  await page.context().storageState({ path: '.auth/shareholder.json' });
});
