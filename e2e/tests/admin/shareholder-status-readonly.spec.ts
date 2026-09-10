import { test, expect } from '@playwright/test';

test.describe('Shareholder status read-only', () => {
  test('shows shareholder status as a read-only badge', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    await page.getByPlaceholder('Zoeken').fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({
      timeout: 10_000,
    });
    const row = page.getByRole('row').filter({ hasText: 'jan.peeters@email.be' });
    await row.getByRole('link').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // The status field is the container that holds the "derived from paid shares" helper text.
    const statusField = page.getByText('Afgeleid van betaalde aandelen').locator('..');
    await expect(
      statusField.getByText(/^Actief$|^In behandeling$|^Inactief$/),
    ).toBeVisible();
    await expect(
      page.locator('button[role="combobox"]').filter({ hasText: /Actief|In behandeling|Inactief/ }),
    ).toHaveCount(0);
  });
});
