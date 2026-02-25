import { test, expect } from '@playwright/test';

test.describe('Shareholder List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
  });

  test('renders shareholders table with seed data', async ({ page }) => {
    // Should show known shareholders from seed
    await expect(page.getByText('Jan Peeters')).toBeVisible();
    await expect(page.getByText('Bakkerij Janssens BVBA')).toBeVisible();
    await expect(page.getByText('Els De Vos')).toBeVisible();
  });

  test('search filters shareholders by name', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/zoek/i);
    await searchInput.fill('Bakkerij');

    // Should show the company shareholder
    await expect(page.getByText('Bakkerij Janssens BVBA')).toBeVisible();

    // Other shareholders should not be visible
    await expect(page.getByText('Jan Peeters')).not.toBeVisible();
  });

  test('type filter shows only company shareholders', async ({ page }) => {
    // Open the type filter (second combobox, after the status filter)
    await page.getByRole('combobox').nth(1).click();

    // Select COMPANY from the dropdown
    await page.getByRole('option', { name: /bedrijf/i }).click();

    // Should show company shareholders
    await expect(page.getByText('Bakkerij Janssens BVBA')).toBeVisible();

    // Should not show individual shareholders
    await expect(page.getByText('Jan Peeters')).not.toBeVisible();
  });

  test('clicking shareholder name navigates to detail page', async ({ page }) => {
    await page.getByText('Jan Peeters').click();

    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);
  });
});
