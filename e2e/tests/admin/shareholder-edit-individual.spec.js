"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe('Edit Individual Shareholder', () => {
    test_1.test.beforeEach(async ({ page }) => {
        await page.goto('/nl/dashboard/admin/shareholders');
        await page.getByText('Jan Peeters').click();
        await (0, test_1.expect)(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);
    });
    (0, test_1.test)('can edit first name and save successfully', async ({ page }) => {
        const firstNameInput = page.locator('input[name="firstName"]');
        await (0, test_1.expect)(firstNameInput).toBeVisible();
        const originalValue = await firstNameInput.inputValue();
        await firstNameInput.clear();
        await firstNameInput.fill('Johannes');
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
        // Revert
        await firstNameInput.clear();
        await firstNameInput.fill(originalValue);
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
    });
    (0, test_1.test)('can edit last name and save successfully', async ({ page }) => {
        const lastNameInput = page.locator('input[name="lastName"]');
        await (0, test_1.expect)(lastNameInput).toBeVisible();
        const originalValue = await lastNameInput.inputValue();
        await lastNameInput.clear();
        await lastNameInput.fill('Pieters');
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
        // Revert
        await lastNameInput.clear();
        await lastNameInput.fill(originalValue);
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
    });
    (0, test_1.test)('can edit contact info (phone)', async ({ page }) => {
        const phoneInput = page.locator('input[name="phone"]');
        await (0, test_1.expect)(phoneInput).toBeVisible();
        const originalValue = await phoneInput.inputValue();
        await phoneInput.clear();
        await phoneInput.fill('+32 499 00 00 00');
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
        // Revert
        await phoneInput.clear();
        await phoneInput.fill(originalValue);
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
    });
    (0, test_1.test)('can edit address fields', async ({ page }) => {
        const streetInput = page.locator('input[name="street"]');
        await (0, test_1.expect)(streetInput).toBeVisible();
        const originalStreet = await streetInput.inputValue();
        await streetInput.clear();
        await streetInput.fill('Stationsstraat');
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
        // Revert
        await streetInput.clear();
        await streetInput.fill(originalStreet);
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
    });
});
