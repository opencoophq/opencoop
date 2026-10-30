import { test } from '@playwright/test';
import { gotoDashboardPage } from '../../helpers/dashboard';

test.describe('Shareholder settings', () => {
  test('settings page shows language and locale options', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoDashboardPage(page, '/nl/dashboard/settings', 'Instellingen');
  });
});
