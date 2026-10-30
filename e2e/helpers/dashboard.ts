import { expect, type Page, type Response } from '@playwright/test';

// The dashboard layout shows a full-page spinner until /auth/me settles, and
// `api()` redirects to /login when the stored session is rejected. Wait for the
// heading (or the login form), reload once if stuck on the spinner, then fail
// with a message that says which of the three outcomes happened.
export const DASHBOARD_READY_TIMEOUT = 20_000;

// Full-page spinner rendered by dashboard/layout.tsx (page-level spinners are not min-h-screen).
const LAYOUT_SPINNER = 'div.min-h-screen > div.animate-spin';

function isAuthMe(res: Response): boolean {
  return new URL(res.url()).pathname.endsWith('/auth/me');
}

export async function gotoDashboardPage(page: Page, path: string, heading: string) {
  // Record every /auth/me status so a failure says whether the API answered.
  const authMeStatuses: number[] = [];
  const onResponse = (res: Response) => {
    if (isAuthMe(res)) authMeStatuses.push(res.status());
  };
  page.on('response', onResponse);

  const headingLocator = page.getByRole('heading', { name: heading, exact: true });
  const loginEmail = page.locator('input[name="email"]');
  const spinner = page.locator(LAYOUT_SPINNER);
  const diag = () => `/auth/me statuses: [${authMeStatuses.join(', ') || 'none'}], url: ${page.url()}`;

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const authMeOk = page
        .waitForResponse((res) => isAuthMe(res) && res.ok(), { timeout: DASHBOARD_READY_TIMEOUT })
        .catch(() => null);
      if (attempt === 1) await page.goto(path);
      else await page.reload();

      const settled = await headingLocator
        .or(loginEmail)
        .first()
        .waitFor({ state: 'visible', timeout: DASHBOARD_READY_TIMEOUT })
        .then(
          () => true,
          () => false,
        );
      if (settled) break;
      // Not settled: let the /auth/me waiter finish so the diagnostics are complete.
      await authMeOk;

      // Only a stuck layout spinner earns a reload; anything else is reported below.
      if (!(await spinner.isVisible())) break;
    }

    if ((await loginEmail.isVisible()) || !page.url().includes(path)) {
      throw new Error(`Redirected to login instead of ${path}. ${diag()}`);
    }
    if (await spinner.isVisible()) {
      throw new Error(`Stuck on the dashboard layout spinner after a reload. ${diag()}`);
    }
    await expect(headingLocator, `Heading "${heading}" missing on ${path}. ${diag()}`).toBeVisible();
  } finally {
    page.off('response', onResponse);
  }
}
