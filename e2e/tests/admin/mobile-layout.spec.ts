import { test } from '@playwright/test';
import { PHONE_VIEWPORTS, expectNoHorizontalOverflow } from '../../helpers/mobile-overflow';

const ROUTES = [
  '/nl/dashboard/admin',
  '/nl/dashboard/admin/shareholders',
  '/nl/dashboard/admin/transactions',
  '/nl/dashboard/admin/share-classes',
  '/nl/dashboard/admin/projects',
  '/nl/dashboard/admin/dividends',
  '/nl/dashboard/admin/meetings',
  '/nl/dashboard/admin/messages',
  '/nl/dashboard/admin/bank-import',
  '/nl/dashboard/admin/reports',
  '/nl/dashboard/admin/settings',
  '/nl/dashboard/admin/billing',
  '/nl/dashboard/admin/team',
  '/nl/dashboard/admin/volunteers',
  '/nl/dashboard/admin/changelog',
];

for (const viewport of PHONE_VIEWPORTS) {
  test.describe(`Admin pages fit a ${viewport.width}px phone`, () => {
    test.use({ viewport });

    for (const route of ROUTES) {
      test(route, async ({ page }) => {
        await expectNoHorizontalOverflow(page, route);
      });
    }
  });
}
