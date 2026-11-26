import { test, expect } from '@playwright/test';

// notFound() under [locale] must render app/[locale]/not-found.tsx inside the locale layout,
// not the bare root 404 (which hardcodes <html lang="nl"> and has no translations).
test.describe('Localized 404', () => {
  test('client-side notFound() on an unknown coop login renders the Dutch 404', async ({
    page,
  }) => {
    await page.goto('/nl/no-such-coop-xyz/login');
    await expect(page.getByTestId('locale-not-found')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByRole('heading', { name: 'Pagina niet gevonden' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Naar de startpagina' })).toHaveAttribute(
      'href',
      '/nl',
    );
  });

  test('the French locale keeps lang="fr" and French text', async ({ page }) => {
    await page.goto('/fr/no-such-coop-xyz/login');
    await expect(page.getByTestId('locale-not-found')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
  });
});
