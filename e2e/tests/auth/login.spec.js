"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
// These tests do NOT use the stored auth state — they test the login flow itself
test_1.test.use({ storageState: { cookies: [], origins: [] } });
test_1.test.describe('Login', () => {
    (0, test_1.test)('successful login with password redirects to dashboard', async ({ page }) => {
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
        await (0, test_1.expect)(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    });
    (0, test_1.test)('login with wrong password shows error', async ({ page }) => {
        await page.goto('/nl/login');
        await page.locator('input[name="email"]').fill('admin@zonnecooperatie.be');
        await page.getByRole('button', { name: 'Doorgaan' }).click();
        await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();
        await page.locator('input[name="password"]').fill('wrongpassword');
        await page.getByRole('button', { name: 'Inloggen' }).click();
        // Should show error alert
        await (0, test_1.expect)(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });
    });
});
