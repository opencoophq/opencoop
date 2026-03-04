import { test, expect } from '@playwright/test';

test.describe('Shareholder detail view', () => {
  test('displays individual shareholder details', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/shareholders');
    await page.getByText('Jan Peeters').click();
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
    await page.getByText('Bakkerij Janssens BVBA').click();
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
    await page.getByText('Jan Peeters').click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders\/.+/);

    // Click back button
    await page.getByRole('link', { name: 'Terug' }).click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/shareholders$/);
  });
});
