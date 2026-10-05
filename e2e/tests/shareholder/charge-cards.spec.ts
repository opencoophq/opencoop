import { test, expect } from '@playwright/test';
import { enableChargeCards } from '../../helpers/charge-cards';

test.describe('Shareholder charge cards', () => {
  test.beforeAll(async () => {
    await enableChargeCards();
  });

  test('requests a card, sees the payment details, and cancels the request', async ({ page }) => {
    const label = `E2E auto ${Date.now()}`;
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/nl/dashboard');
    await page.locator('aside').getByRole('link', { name: 'Laadpassen' }).click();
    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards$/);
    await expect(page.locator('main').getByRole('heading', { name: 'Laadpassen' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Pas aanvragen' }).click();
    const requestDialog = page.getByRole('dialog');
    await requestDialog.getByLabel('Label (optioneel)').fill(label);
    await requestDialog.getByRole('button', { name: 'Aanvraag versturen' }).click();

    const payDialog = page.getByRole('dialog');
    await expect(payDialog.getByRole('heading', { name: 'Betaal je laadpas' })).toBeVisible();
    await expect(payDialog.getByTestId('charge-card-ogm')).toHaveText(/^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
    await expect(payDialog.getByText(/6[,.]00/)).toBeVisible();
    await payDialog.getByRole('button', { name: 'Sluiten', exact: true }).click();

    const card = page.getByTestId('charge-card').filter({ hasText: label });
    await expect(card.getByText('Aangevraagd', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Aanvraag annuleren' }).click();
    await expect(card.getByText('Geannuleerd', { exact: true })).toBeVisible();
  });
});
