import { test, expect } from '@playwright/test';

test.describe('Admin share classes', () => {
  test('share classes page shows seed data', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/share-classes');

    await expect(page.getByRole('heading', { name: /Aandelenklassen/i })).toBeVisible({ timeout: 10_000 });

    // Verify seed share classes are listed
    await expect(page.getByText('Aandeel A')).toBeVisible();
    await expect(page.getByText('Aandeel B')).toBeVisible();
  });
});
