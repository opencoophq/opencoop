import { test, expect } from '@playwright/test';
import { API_URL, apiAs, enableChargeCards, tokenFor } from '../../helpers/charge-cards';

test.describe('Admin charge cards', () => {
  let label: string;

  test.beforeAll(async () => {
    const coopId = await enableChargeCards();
    label = `E2E paid ${Date.now()}`;

    const me = await apiAs<{ shareholders: Array<{ id: string }> }>('shareholder', 'GET', '/auth/me');
    const { card } = await apiAs<{ card: { ogmCode: string; feeInclVat: number } }>(
      'shareholder',
      'POST',
      `/shareholders/${me.shareholders[0].id}/charge-cards`,
      { label },
    );

    // Pay the card the way a coop does: a bank CSV import with the card's OGM.
    const csv = `date;amount;counterparty;reference\n2026-10-06;${card.feeInclVat.toFixed(2)};Jan Peeters;${card.ogmCode}\n`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'charge-card.csv');
    const res = await fetch(`${API_URL}/admin/coops/${coopId}/bank-import?preset=generic`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await tokenFor('admin')}` },
      body: form,
    });
    expect(res.ok).toBe(true);
  });

  test('issues a paid card, blocks it, and clears the provider to-do', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/nl/dashboard/admin/charge-cards');
    await expect(page.locator('main').getByRole('heading', { name: 'Laadpassen' })).toBeVisible({ timeout: 10_000 });

    const row = page.getByRole('row').filter({ hasText: label });
    await expect(row.getByText('Betaald', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Uitgeven', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Kaartnummer').fill(`  E2E-${Date.now()}  `);
    await dialog.getByRole('button', { name: 'Pas uitgeven' }).click();
    await expect(row.getByText('Actief', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Blokkeren', exact: true }).click();
    await expect(row.getByText('Te doen in leveranciersportaal', { exact: true })).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Te doen in leveranciersportaal' }).click();
    const todoRow = page.getByRole('row').filter({ hasText: label });
    await expect(todoRow).toBeVisible();
    await todoRow.getByRole('button', { name: 'Gedaan in portaal' }).click();
    await expect(todoRow).toHaveCount(0);
  });
});
