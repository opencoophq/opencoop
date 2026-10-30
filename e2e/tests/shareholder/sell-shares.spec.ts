import { test, expect, type Page } from '@playwright/test';
import { gotoDashboardPage } from '../../helpers/dashboard';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface Registration {
  type?: string;
  status: string;
  quantity: number;
  sharesOwned?: number;
}

// Ask the API, with the page's own token, whether Jan has sellable shares. This
// separates "seed/auth has no data" from "API has data but the page shows none".
async function sellableSharesDiagnosis(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('accessToken'));
  if (!token) return 'No accessToken in localStorage, so the API check was skipped.';

  const res = await page.request.get(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return `API check failed: GET /auth/me returned ${res.status()}.`;

  const me = (await res.json()) as { shareholders?: Array<{ registrations?: Registration[] }> };
  const sellable = (me.shareholders?.[0]?.registrations ?? []).filter(
    (r) => r.type !== 'SELL' && r.status === 'COMPLETED' && (r.sharesOwned ?? r.quantity) > 0,
  );
  return sellable.length === 0
    ? 'API /auth/me has no sellable COMPLETED buys: the seed or auth returned no data.'
    : `API /auth/me has ${sellable.length} sellable COMPLETED buy(s) but the page shows none: page data-loading bug.`;
}

test.describe('Sell shares', () => {
  test('can initiate share sell request', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoDashboardPage(page, '/nl/dashboard/shares', 'Aandelen');

    // Wait for the shares table or its empty state, so a settled-but-empty page fails fast.
    const emptyState = page.getByText('Geen resultaten gevonden', { exact: true });
    await expect(page.locator('tbody tr').or(emptyState).first()).toBeVisible({ timeout: 15_000 });

    // Find a row with COMPLETED status badge (fully paid shares) and click the "Verkopen" button
    // Status is translated to Dutch ("Voltooid") since the user's preferred language is nl
    const activeRow = page.locator('tr').filter({ hasText: 'Voltooid' }).first();
    if (!(await activeRow.isVisible())) {
      throw new Error(`No "Voltooid" row on /nl/dashboard/shares. ${await sellableSharesDiagnosis(page)}`);
    }

    await activeRow.getByRole('button', { name: 'Verkopen' }).click();

    // Verify sell dialog opens
    await expect(page.getByRole('heading', { name: 'Aandelen verkopen' })).toBeVisible({ timeout: 5_000 });

    // Verify quantity input is visible and defaults to 1
    const quantityInput = page.locator('input[type="number"]');
    await expect(quantityInput).toBeVisible();
    await expect(quantityInput).toHaveValue('1');

    // Verify refund amount is shown
    await expect(page.getByText('Totale terugbetaling')).toBeVisible();

    // Click confirm sell
    await page.getByRole('button', { name: 'Verkoop bevestigen' }).click();

    // Verify either success or an error about exceeding available shares
    // (prior test runs may have created pending sell requests)
    await expect(
      page.getByRole('alert').first(),
    ).toBeVisible({ timeout: 10_000 });

    // Close dialog
    const closeBtn = page.getByRole('button', { name: 'Bevestigen' });
    const cancelBtn = page.getByRole('button', { name: 'Annuleren' });
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await cancelBtn.click();
    }
  });
});
