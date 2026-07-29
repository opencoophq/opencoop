# ESLint Setup & E2E Test Expansion Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ESLint to CI pipeline and expand E2E test coverage for all critical user flows.

**Architecture:** ESLint is already configured per-app (api has `.eslintrc.js`, web has `.eslintrc.json`) but never runs in CI. We add a lint step to CI and fix any violations. For E2E, we add Playwright specs for public registration, admin settings (Ponto), admin transactions, and other untested flows. All tests use the demo coop seed data (slug: `demo`, channel: `default`).

**Tech Stack:** ESLint 8, @typescript-eslint, Playwright, next-intl (Dutch locale `nl`)

---

### Task 1: Add ESLint to CI Pipeline

**Files:**
- Modify: `.github/workflows/build-deploy.yml`
- Modify: `apps/web/.eslintrc.json`
- Modify: `apps/web/package.json`

**Step 1: Add lint step to CI workflow**

In `.github/workflows/build-deploy.yml`, add a lint step inside the `e2e` job (which already has pnpm + node setup), right after "Generate Prisma client" and before "Build API & Web":

```yaml
      - name: Lint
        run: pnpm lint
```

**Step 2: Verify lint passes locally**

Run: `pnpm lint`

If the web app fails due to missing eslint dependencies (next lint should auto-detect), verify it works. If there are lint errors, fix them in subsequent steps.

**Step 3: Fix any lint errors**

Fix all errors reported by `pnpm lint`. Common issues:
- Unused imports
- Missing React imports
- `@typescript-eslint/no-unused-vars` warnings

**Step 4: Commit**

```bash
git add -A
git commit -m "ci: add ESLint to CI pipeline and fix lint errors"
```

---

### Task 2: E2E — Public Registration Flow (New User, Individual)

**Files:**
- Create: `e2e/tests/public/registration-individual.spec.ts`

**Context:**
- URL: `/nl/demo/default/register`
- Demo coop slug: `demo`, channel: `default`
- The form has 4 steps for new users: Welcome → Details → Order → Payment
- All UI text is Dutch (nl locale)
- Key translations: "Ik ben nieuw" (I'm new), "Voornaam" (First name), "Achternaam" (Last name), "Registratie voltooien" (Complete registration), "Registratie voltooid" (Registration complete)

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

// Public registration tests — no stored auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Public registration - Individual', () => {
  test('can register as a new individual shareholder', async ({ page }) => {
    const uniqueEmail = `e2e-reg-${Date.now()}@test.be`;

    // Navigate to registration page
    await page.goto('/nl/demo/default/register');

    // Step 1: Welcome — click "I'm new"
    await expect(page.getByText('Ik ben nieuw')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ik ben nieuw').click();

    // Step 2: Details — fill individual shareholder form
    await expect(page.locator('input[name="firstName"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('Registratie');
    await page.locator('input[name="email"]').fill(uniqueEmail);

    // Address fields
    await page.locator('input[name="street"]').fill('Teststraat');
    await page.locator('input[name="number"]').fill('1');
    await page.locator('input[name="postalCode"]').fill('1000');
    await page.locator('input[name="city"]').fill('Brussel');

    // Click next
    await page.getByRole('button', { name: /volgende|Volgende/i }).click();

    // Step 3: Order — select share class and quantity
    // Select first share class
    const shareClassSelect = page.locator('[role="combobox"]').first();
    await expect(shareClassSelect).toBeVisible({ timeout: 10_000 });
    await shareClassSelect.click();
    await page.locator('[role="option"]').first().click();

    // Quantity should default to 1
    const quantityInput = page.locator('input[type="number"]');
    await expect(quantityInput).toHaveValue('1');

    // Accept terms
    await page.locator('[role="checkbox"]').click();

    // Click next / complete
    await page.getByRole('button', { name: /volgende|Volgende|voltooien/i }).click();

    // Step 4: Payment confirmation
    await expect(page.getByText('Registratie voltooid')).toBeVisible({ timeout: 15_000 });

    // Verify bank payment details are shown (OGM code)
    await expect(page.getByText('+++')).toBeVisible();
  });

  test('channel landing page shows share classes and navigation buttons', async ({ page }) => {
    await page.goto('/nl/demo/default');

    // Verify coop name is displayed
    await expect(page.getByText('Zonnecoöperatie Vlaanderen')).toBeVisible({ timeout: 15_000 });

    // Verify share classes are listed
    await expect(page.getByText('Aandeel A')).toBeVisible();
    await expect(page.getByText('Aandeel B')).toBeVisible();

    // Verify login and register buttons
    await expect(page.getByRole('link', { name: /Inloggen/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Registreren/i })).toBeVisible();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd e2e && npx playwright test tests/public/registration-individual.spec.ts --headed`

Watch the test run to verify each step works. The test navigates the full registration flow.

**Step 3: Commit**

```bash
git add e2e/tests/public/registration-individual.spec.ts
git commit -m "test(e2e): add public registration flow for individual shareholders"
```

---

### Task 3: E2E — Public Registration Flow (Company)

**Files:**
- Create: `e2e/tests/public/registration-company.spec.ts`

**Context:**
- Same URL, but select "Voor mijn bedrijf" (For my company) as beneficiary type
- Company fields: "Bedrijfsnaam" (Company name), "Ondernemingsnummer" (KBO/Company ID)

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Public registration - Company', () => {
  test('can register as a company shareholder', async ({ page }) => {
    const uniqueEmail = `e2e-company-${Date.now()}@test.be`;

    await page.goto('/nl/demo/default/register');

    // Step 1: Welcome — "I'm new"
    await expect(page.getByText('Ik ben nieuw')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ik ben nieuw').click();

    // Step 2: Details — select company type
    await expect(page.locator('input[name="firstName"], [data-value="company"]')).toBeVisible({ timeout: 10_000 });

    // Select "For my company" radio
    await page.getByText('Voor mijn bedrijf').click();

    // Fill company details
    await page.locator('input[name="companyName"]').fill('Test Bedrijf BV');
    await page.locator('input[name="companyId"]').fill('0123456789');
    await page.locator('input[name="email"]').fill(uniqueEmail);
    await page.locator('input[name="street"]').fill('Bedrijfslaan');
    await page.locator('input[name="number"]').fill('42');
    await page.locator('input[name="postalCode"]').fill('2000');
    await page.locator('input[name="city"]').fill('Antwerpen');

    // Next
    await page.getByRole('button', { name: /volgende|Volgende/i }).click();

    // Step 3: Order
    const shareClassSelect = page.locator('[role="combobox"]').first();
    await expect(shareClassSelect).toBeVisible({ timeout: 10_000 });
    await shareClassSelect.click();
    await page.locator('[role="option"]').first().click();

    await page.locator('[role="checkbox"]').click();
    await page.getByRole('button', { name: /volgende|Volgende|voltooien/i }).click();

    // Step 4: Confirmation
    await expect(page.getByText('Registratie voltooid')).toBeVisible({ timeout: 15_000 });
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/public/registration-company.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/public/registration-company.spec.ts
git commit -m "test(e2e): add public registration flow for company shareholders"
```

---

### Task 4: E2E — Public Registration (Logged-in User Buys Additional Shares)

**Files:**
- Create: `e2e/tests/public/registration-existing-user.spec.ts`

**Context:**
- When a logged-in user visits the registration page, the Welcome step is skipped
- They see a list of their existing shareholders and can choose one or register a new person
- Uses shareholder auth state (jan.peeters@email.be)

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Public registration - Existing user', () => {
  test('logged-in user can buy additional shares for existing shareholder', async ({ page }) => {
    await page.goto('/nl/demo/default/register');

    // Should skip Welcome step — go straight to Details
    // Should show existing shareholder (Jan Peeters) as an option
    await expect(page.getByText('Jan Peeters')).toBeVisible({ timeout: 15_000 });

    // Select existing shareholder
    await page.getByText('Jan Peeters').click();

    // Click next to go to order step
    await page.getByRole('button', { name: /volgende|Volgende/i }).click();

    // Order step — select share class
    const shareClassSelect = page.locator('[role="combobox"]').first();
    await expect(shareClassSelect).toBeVisible({ timeout: 10_000 });
    await shareClassSelect.click();
    await page.locator('[role="option"]').first().click();

    // Accept terms
    await page.locator('[role="checkbox"]').click();

    // Complete registration
    await page.getByRole('button', { name: /volgende|Volgende|voltooien/i }).click();

    // Confirmation
    await expect(page.getByText('Registratie voltooid')).toBeVisible({ timeout: 15_000 });
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/public/registration-existing-user.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/public/registration-existing-user.spec.ts
git commit -m "test(e2e): add registration flow for logged-in user buying additional shares"
```

---

### Task 5: E2E — Admin Settings Page (Ponto Connection)

**Files:**
- Create: `e2e/tests/admin/settings.spec.ts`

**Context:**
- URL: `/nl/dashboard/admin/settings`
- Admin user: uses stored admin auth state
- The Ponto card shows "Disconnected" state since no Ponto env vars are configured in test
- Other settings should be visible: coop info, branding

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Admin settings', () => {
  test('settings page loads with all sections', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/settings');

    await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible({ timeout: 10_000 });

    // Verify key settings sections are visible
    await expect(page.getByText('Bankverbinding')).toBeVisible();
  });

  test('bank connection card shows disconnected state', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/settings');

    await expect(page.getByText('Bankverbinding')).toBeVisible({ timeout: 10_000 });

    // Should show connect button (since Ponto is not configured in test env)
    // or show that the feature is not enabled for this coop
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/admin/settings.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/admin/settings.spec.ts
git commit -m "test(e2e): add admin settings page tests"
```

---

### Task 6: E2E — Admin Transactions Page

**Files:**
- Create: `e2e/tests/admin/transactions.spec.ts`

**Context:**
- URL: `/nl/dashboard/admin/transactions`
- Shows all transactions table with filters
- Has "Ongematchte betalingen" (Unmatched payments) tab (new Ponto feature)

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Admin transactions', () => {
  test('transactions page loads with table', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/transactions');

    await expect(page.getByRole('heading', { name: 'Transacties' })).toBeVisible({ timeout: 10_000 });

    // Table should be visible
    await expect(page.locator('table')).toBeVisible();
  });

  test('can switch to unmatched payments tab', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/transactions');

    await expect(page.getByRole('heading', { name: 'Transacties' })).toBeVisible({ timeout: 10_000 });

    // Click the unmatched payments tab
    const unmatchedTab = page.getByRole('tab', { name: /ongematchte/i });
    if (await unmatchedTab.isVisible()) {
      await unmatchedTab.click();
      // Tab content should load (may show empty state)
      await expect(page.locator('[role="tabpanel"]')).toBeVisible();
    }
  });

  test('can filter transactions by status', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/transactions');

    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });

    // Status filter should be available
    const statusFilter = page.locator('select, [role="combobox"]').first();
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
    }
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/admin/transactions.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/admin/transactions.spec.ts
git commit -m "test(e2e): add admin transactions page tests"
```

---

### Task 7: E2E — Admin Dashboard Overview

**Files:**
- Create: `e2e/tests/admin/dashboard.spec.ts`

**Context:**
- URL: `/nl/dashboard/admin`
- Shows overview stats, recent activity, shareholder links

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Admin dashboard', () => {
  test('displays overview stats and navigation', async ({ page }) => {
    await page.goto('/nl/dashboard/admin');

    // Verify admin dashboard loads
    await expect(page.getByRole('heading', { name: 'Overzicht' })).toBeVisible({ timeout: 10_000 });

    // Verify stats cards are shown (shareholders count, capital, etc.)
    await expect(page.getByText('Aandeelhouders')).toBeVisible();

    // Verify admin sidebar navigation
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Aandeelhouders')).toBeVisible();
    await expect(sidebar.getByText('Transacties')).toBeVisible();
    await expect(sidebar.getByText('Instellingen')).toBeVisible();
  });

  test('shareholder links section has copy buttons', async ({ page }) => {
    await page.goto('/nl/dashboard/admin');

    await expect(page.getByRole('heading', { name: 'Overzicht' })).toBeVisible({ timeout: 10_000 });

    // Look for shareholder links section
    const linksSection = page.getByText('Aandeelhouderslinks');
    if (await linksSection.isVisible()) {
      await expect(linksSection).toBeVisible();
    }
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/admin/dashboard.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/admin/dashboard.spec.ts
git commit -m "test(e2e): add admin dashboard overview tests"
```

---

### Task 8: E2E — Shareholder Transactions Page

**Files:**
- Create: `e2e/tests/shareholder/transactions.spec.ts`

**Context:**
- URL: `/nl/dashboard/transactions`
- Shows shareholder's transaction history
- Uses shareholder auth state (jan.peeters@email.be)

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Shareholder transactions', () => {
  test('transactions page loads with history', async ({ page }) => {
    await page.goto('/nl/dashboard/transactions');

    await expect(page.getByRole('heading', { name: 'Transacties' })).toBeVisible({ timeout: 10_000 });

    // Table should be visible with transaction data from seed
    await expect(page.locator('table')).toBeVisible();
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/shareholder/transactions.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/shareholder/transactions.spec.ts
git commit -m "test(e2e): add shareholder transactions page test"
```

---

### Task 9: E2E — Shareholder Settings Page

**Files:**
- Create: `e2e/tests/shareholder/settings.spec.ts`

**Context:**
- URL: `/nl/dashboard/settings`
- Language preference, formatting locale, password change

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Shareholder settings', () => {
  test('settings page shows language and locale options', async ({ page }) => {
    await page.goto('/nl/dashboard/settings');

    await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible({ timeout: 10_000 });
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/shareholder/settings.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/shareholder/settings.spec.ts
git commit -m "test(e2e): add shareholder settings page test"
```

---

### Task 10: E2E — Admin Share Classes & Projects

**Files:**
- Create: `e2e/tests/admin/share-classes.spec.ts`

**Context:**
- URL: `/nl/dashboard/admin/share-classes`
- Shows share classes table (Aandeel A, Aandeel B from seed)

**Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Admin share classes', () => {
  test('share classes page shows seed data', async ({ page }) => {
    await page.goto('/nl/dashboard/admin/share-classes');

    await expect(page.getByRole('heading', { name: /Aandelenklassen/i })).toBeVisible({ timeout: 10_000 });

    // Verify seed share classes are listed
    await expect(page.getByText('Aandeel A')).toBeVisible();
    await expect(page.getByText('Aandeel B')).toBeVisible();
  });
});
```

**Step 2: Run and verify**

Run: `cd e2e && npx playwright test tests/admin/share-classes.spec.ts --headed`

**Step 3: Commit**

```bash
git add e2e/tests/admin/share-classes.spec.ts
git commit -m "test(e2e): add admin share classes page test"
```

---

### Task 11: Add `public` Project to Playwright Config

**Files:**
- Modify: `e2e/playwright.config.ts`

**Context:**
- The new `public` test directory needs its own project in Playwright config
- Public tests should NOT use any stored auth state (anonymous users)

**Step 1: Add the public project**

Add a new project to the `projects` array in `playwright.config.ts`:

```typescript
{
  name: 'public',
  testMatch: /tests\/public\/.*/,
  use: {
    ...devices['Desktop Chrome'],
    storageState: { cookies: [], origins: [] },
  },
  dependencies: ['setup'],
},
```

This should go BEFORE the admin and shareholder projects, since public tests are independent.

**Step 2: Verify all tests still pass**

Run: `cd e2e && npx playwright test`

**Step 3: Commit**

```bash
git add e2e/playwright.config.ts
git commit -m "test(e2e): add public project to Playwright config"
```

---

## Execution Order

**Critical path:** Task 11 (Playwright config) should be done BEFORE Tasks 2-4 (public registration tests), since those tests need the `public` project.

Suggested order:
1. Task 11 — Playwright config for public project
2. Task 2 — Registration (Individual) — **highest priority**
3. Task 3 — Registration (Company)
4. Task 4 — Registration (Existing user)
5. Task 1 — ESLint in CI
6. Task 7 — Admin dashboard
7. Task 5 — Admin settings
8. Task 6 — Admin transactions
9. Task 8 — Shareholder transactions
10. Task 9 — Shareholder settings
11. Task 10 — Admin share classes
