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

  // Wait for the coop context to load (admin page should be accessible)
  await page.waitForTimeout(2_000);

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
  await page.waitForTimeout(2_000);

  await page.context().storageState({ path: '.auth/shareholder.json' });
});
