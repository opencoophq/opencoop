"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe('Edit Company Shareholder', () => {
    test_1.test.beforeEach(async ({ page }) => {
        // Navigate to shareholders list and click the company shareholder
        await page.goto('/nl/dashboard/admin/shareholders');
        await page.getByText('Bakkerij Janssens BVBA').click();
        await (0, test_1.expect)(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);
    });
    (0, test_1.test)('can edit company name and save successfully', async ({ page }) => {
        const companyNameInput = page.locator('input[name="companyName"]');
        await (0, test_1.expect)(companyNameInput).toBeVisible();
        // Clear and type new name
        await companyNameInput.clear();
        await companyNameInput.fill('Bakkerij Janssens NV');
        // Submit the form
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        // Should show success alert (not error)
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
        // Revert: restore original name
        await companyNameInput.clear();
        await companyNameInput.fill('Bakkerij Janssens BVBA');
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
    });
    (0, test_1.test)('can edit company ID (KBO number)', async ({ page }) => {
        const companyIdInput = page.locator('input[name="companyId"]');
        await (0, test_1.expect)(companyIdInput).toBeVisible();
        const originalValue = await companyIdInput.inputValue();
        await companyIdInput.clear();
        await companyIdInput.fill('0999888777');
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
        // Revert
        await companyIdInput.clear();
        await companyIdInput.fill(originalValue);
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
    });
    (0, test_1.test)('can edit VAT number', async ({ page }) => {
        const vatInput = page.locator('input[name="vatNumber"]');
        await (0, test_1.expect)(vatInput).toBeVisible();
        const originalValue = await vatInput.inputValue();
        await vatInput.clear();
        await vatInput.fill('BE0999888777');
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
        // Revert
        await vatInput.clear();
        await vatInput.fill(originalValue);
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        await (0, test_1.expect)(page.getByText('Succes')).toBeVisible({ timeout: 5_000 });
    });
    (0, test_1.test)('shows error alert not shown on valid save', async ({ page }) => {
        // Just save without changes — should still succeed
        await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
        // Should NOT show an error
        await (0, test_1.expect)(page.getByText('Er is een fout opgetreden')).not.toBeVisible({ timeout: 3_000 });
    });
});
