import { test } from '@playwright/test';
import { PHONE_VIEWPORTS, expectNoHorizontalOverflow } from '../../helpers/mobile-overflow';

const ROUTES = [
  '/nl/dashboard',
  '/nl/dashboard/shares',
  '/nl/dashboard/transactions',
  '/nl/dashboard/dividends',
  '/nl/dashboard/meetings',
  '/nl/dashboard/documents',
  '/nl/dashboard/inbox',
  '/nl/dashboard/personal-data',
  '/nl/dashboard/settings',
];

for (const viewport of PHONE_VIEWPORTS) {
  test.describe(`Shareholder pages fit a ${viewport.width}px phone`, () => {
    test.use({ viewport });

    for (const route of ROUTES) {
      test(route, async ({ page }) => {
        await expectNoHorizontalOverflow(page, route);
      });
    }
  });
}
