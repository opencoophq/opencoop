import { expect, type Page } from '@playwright/test';

// Dashboard pages render a spinner until /auth/me returns, and the layout
// redirects to /login when the stored session is rejected. Wait for either
// outcome, then fail with a clear message if we were bounced to login.
export const DASHBOARD_READY_TIMEOUT = 25_000;

export async function gotoDashboardPage(page: Page, path: string, heading: string) {
  await page.goto(path);

  const headingLocator = page.getByRole('heading', { name: heading, exact: true });
  const loginEmail = page.locator('input[name="email"]');
  await expect(headingLocator.or(loginEmail).first()).toBeVisible({
    timeout: DASHBOARD_READY_TIMEOUT,
  });

  expect(page.url(), `expected to stay on ${path}, got redirected`).toContain(path);
  await expect(headingLocator).toBeVisible();
}
