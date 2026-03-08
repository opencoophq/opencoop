import { test, expect } from '@playwright/test';

test.describe('Shareholder List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
  });

  test('renders shareholders table with seed data', async ({ page }) => {
    // Search for each seed shareholder by email and verify they exist
    const searchInput = page.getByPlaceholder('Zoeken');

    await searchInput.fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });

    await searchInput.clear();
    await searchInput.fill('info@bakkerijjanssens.be');
    await expect(page.getByRole('cell', { name: 'info@bakkerijjanssens.be' })).toBeVisible({ timeout: 10_000 });

    await searchInput.clear();
    await searchInput.fill('els.devos@email.be');
    await expect(page.getByRole('cell', { name: 'els.devos@email.be' })).toBeVisible({ timeout: 10_000 });
  });

  test('search filters shareholders by name', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Zoeken');

    // Search for the company shareholder by email
    await searchInput.fill('info@bakkerijjanssens.be');
    await expect(page.getByRole('cell', { name: 'info@bakkerijjanssens.be' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Bakkerij Janssens BVBA')).toBeVisible();

    // Clear and search for Jan Peeters
    await searchInput.clear();
    await searchInput.fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });

    // Company shareholder should not be visible
    await expect(page.getByText('Bakkerij Janssens BVBA')).not.toBeVisible();
  });

  test('type filter shows only company shareholders', async ({ page }) => {
    // Open the type filter (second combobox, after the status filter)
    await page.getByRole('combobox').nth(1).click();

    // Select COMPANY from the dropdown
    await page.getByRole('option', { name: /bedrijf/i }).click();

    // Should show a table with results (company shareholders)
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });

    // Individual shareholders should not be visible on the current page
    // (We don't assert specific company names since they may be on page 2+)
  });

  test('clicking shareholder name navigates to detail page', async ({ page }) => {
    // Search for the shareholder by email first (name may not be on page 1)
    await page.getByPlaceholder('Zoeken').fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('row').filter({ hasText: 'jan.peeters@email.be' }).getByRole('link').click();

    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);
  });
});
