"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe('Shareholder List', () => {
    test_1.test.beforeEach(async ({ page }) => {
        await page.goto('/nl/dashboard/admin/shareholders');
    });
    (0, test_1.test)('renders shareholders table with seed data', async ({ page }) => {
        // Should show known shareholders from seed
        await (0, test_1.expect)(page.getByText('Jan Peeters')).toBeVisible();
        await (0, test_1.expect)(page.getByText('Bakkerij Janssens BVBA')).toBeVisible();
        await (0, test_1.expect)(page.getByText('Els De Vos')).toBeVisible();
    });
    (0, test_1.test)('search filters shareholders by name', async ({ page }) => {
        const searchInput = page.getByPlaceholder(/zoek/i);
        await searchInput.fill('Bakkerij');
        // Should show the company shareholder
        await (0, test_1.expect)(page.getByText('Bakkerij Janssens BVBA')).toBeVisible();
        // Other shareholders should not be visible
        await (0, test_1.expect)(page.getByText('Jan Peeters')).not.toBeVisible();
    });
    (0, test_1.test)('type filter shows only company shareholders', async ({ page }) => {
        // Open the type filter (second combobox, after the status filter)
        await page.getByRole('combobox').nth(1).click();
        // Select COMPANY from the dropdown
        await page.getByRole('option', { name: /bedrijf/i }).click();
        // Should show company shareholders
        await (0, test_1.expect)(page.getByText('Bakkerij Janssens BVBA')).toBeVisible();
        // Should not show individual shareholders
        await (0, test_1.expect)(page.getByText('Jan Peeters')).not.toBeVisible();
    });
    (0, test_1.test)('clicking shareholder name navigates to detail page', async ({ page }) => {
        await page.getByText('Jan Peeters').click();
        await (0, test_1.expect)(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);
    });
});
