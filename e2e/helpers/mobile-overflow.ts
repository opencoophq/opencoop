import { expect, type Page } from '@playwright/test';

// iPhone mini / SE (375) and iPhone 12-16 (390) widths.
export const PHONE_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
];

/**
 * Fails when a page is wider than the phone screen. On iOS Safari such a page
 * widens the layout viewport, so the whole dashboard (fixed top bar included)
 * shifts and clips at the left edge.
 */
export async function expectNoHorizontalOverflow(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState('networkidle');

  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const offenders: string[] = [];
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement!.getBoundingClientRect();
      // Report the element that sticks out of an in-bounds parent: that is the culprit.
      if (r.width > 0 && r.right > width + 1 && parent.right <= width + 1) {
        offenders.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> right=${Math.round(r.right)}`);
      }
    }
    return { overflow: document.documentElement.scrollWidth - width, offenders: offenders.slice(0, 5) };
  });

  expect(result.overflow, `${route} overflows by ${result.overflow}px:\n${result.offenders.join('\n')}`).toBeLessThanOrEqual(0);
}
