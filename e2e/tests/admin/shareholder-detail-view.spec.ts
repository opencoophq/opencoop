import { test, expect } from '@playwright/test';

test.describe('Shareholder detail view', () => {
  test('displays individual shareholder details', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Search for the shareholder by email (name may not be on page 1)
    await page.getByPlaceholder('Zoeken').fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('row').filter({ hasText: 'jan.peeters@email.be' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Verify personal info fields are populated
    const firstNameInput = page.locator('input[name="firstName"]');
    await expect(firstNameInput).toBeVisible();
    await expect(firstNameInput).toHaveValue('Jan');

    const lastNameInput = page.locator('input[name="lastName"]');
    await expect(lastNameInput).toBeVisible();
    await expect(lastNameInput).toHaveValue('Peeters');

    // Verify email field is populated
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveValue('jan.peeters@email.be');

    // Verify shareholdings section exists
    await expect(page.getByText('Aandelenbezit')).toBeVisible();

    // Verify transaction history section exists
    await expect(page.getByText('Transactiegeschiedenis')).toBeVisible();

    // Verify audit history section exists
    await expect(page.getByText('Wijzigingsgeschiedenis')).toBeVisible();
  });

  test('displays company shareholder details', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Search for the shareholder by email (name may not be on page 1)
    await page.getByPlaceholder('Zoeken').fill('info@bakkerijjanssens.be');
    await expect(page.getByRole('cell', { name: 'info@bakkerijjanssens.be' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('row').filter({ hasText: 'info@bakkerijjanssens.be' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Verify company name field is populated
    const companyNameInput = page.locator('input[name="companyName"]');
    await expect(companyNameInput).toBeVisible();
    await expect(companyNameInput).toHaveValue('Bakkerij Janssens BVBA');

    // Verify company ID (KBO) field is visible
    const companyIdInput = page.locator('input[name="companyId"]');
    await expect(companyIdInput).toBeVisible();
    const companyIdValue = await companyIdInput.inputValue();
    expect(companyIdValue.length).toBeGreaterThan(0);

    // Verify the save button is visible
    await expect(page.getByRole('button', { name: 'Wijzigingen opslaan' })).toBeVisible();
  });

  test('shows back button that returns to list', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    // Search for the shareholder by email (name may not be on page 1)
    await page.getByPlaceholder('Zoeken').fill('jan.peeters@email.be');
    await expect(page.getByRole('cell', { name: 'jan.peeters@email.be' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('row').filter({ hasText: 'jan.peeters@email.be' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Click back button
    await page.getByRole('link', { name: 'Terug' }).click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders$/);
  });
});
