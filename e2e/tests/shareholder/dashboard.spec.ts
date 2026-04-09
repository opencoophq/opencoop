import { test, expect } from '@playwright/test';

test.describe('Shareholder dashboard', () => {
  test('displays stats cards', async ({ page }) => {
    await page.goto('/nl/dashboard');

    // Verify page loads with the overview heading (not redirected to login)
    await expect(page.getByRole('heading', { name: 'Overzicht' })).toBeVisible({ timeout: 10_000 });

    // Verify all 4 stats cards are visible
    await expect(page.getByText('Aandelen').first()).toBeVisible();
    await expect(page.getByText('Totale waarde')).toBeVisible();
    await expect(page.getByText('Dividenden').first()).toBeVisible();
  });

  test('navigation links are visible', async ({ page }) => {
    await page.goto('/nl/dashboard');
    await expect(page.getByRole('heading', { name: 'Overzicht' })).toBeVisible({ timeout: 10_000 });

    // Verify sidebar nav has shareholder links
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Overzicht')).toBeVisible();
    await expect(sidebar.getByText('Aandelen')).toBeVisible();
    await expect(sidebar.getByText('Transacties')).toBeVisible();
    await expect(sidebar.getByText('Dividenden')).toBeVisible();
    await expect(sidebar.getByText('Documenten')).toBeVisible();
    await expect(sidebar.getByText('Persoonlijke gegevens')).toBeVisible();
  });
});
