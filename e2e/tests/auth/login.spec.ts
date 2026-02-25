import { test, expect } from '@playwright/test';

// These tests do NOT use the stored auth state — they test the login flow itself
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login', () => {
  test('successful login with password redirects to dashboard', async ({ page }) => {
    await page.goto('/nl/login');

    // Enter email
    await page.locator('input[name="email"]').fill('admin@zonnecooperatie.be');
    await page.getByRole('button', { name: 'Doorgaan' }).click();

    // Choose password method
    await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();

    // Enter password and submit
    await page.locator('input[name="password"]').fill('demo1234');
    await page.getByRole('button', { name: 'Inloggen' }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/nl/login');

    await page.locator('input[name="email"]').fill('admin@zonnecooperatie.be');
    await page.getByRole('button', { name: 'Doorgaan' }).click();

    await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();

    await page.locator('input[name="password"]').fill('wrongpassword');
    await page.getByRole('button', { name: 'Inloggen' }).click();

    // Should show error alert
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });
  });
});
