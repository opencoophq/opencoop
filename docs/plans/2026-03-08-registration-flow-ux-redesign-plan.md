# Registration Flow UX Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the public share registration flow with a modern light header, 4-step wizard (3 for logged-in users), and a proper welcome gate with login option.

**Architecture:** Rewrite `CoopRegisterContent` component — new header (light bg + logo), add Step 1 welcome gate (new/login), re-number existing steps, add `onLoginSuccess` callback to `EmailFirstLogin` so it can be embedded without redirecting. No backend changes.

**Tech Stack:** Next.js 14, React 18, next-intl, react-hook-form, zod, Tailwind CSS

**Design doc:** `docs/plans/2026-03-08-registration-flow-ux-redesign.md`

---

### Task 1: Add `onLoginSuccess` callback to EmailFirstLogin

The `EmailFirstLogin` component hardcodes `router.push('/dashboard')` on successful login (password, passkey, MFA). We need it to accept an optional callback that fires instead of redirecting, so we can embed it in the registration flow.

**Files:**
- Modify: `apps/web/src/components/auth/email-first-login.tsx`

**Step 1: Add `onLoginSuccess` to the props interface**

At line 28-30, change:

```typescript
interface EmailFirstLoginProps {
  coop?: CoopBranding;
  onLoginSuccess?: () => void;
}
```

**Step 2: Destructure the new prop**

At line 45, change:

```typescript
export function EmailFirstLogin({ coop, onLoginSuccess }: EmailFirstLoginProps) {
```

**Step 3: Replace all `router.push('/dashboard')` calls**

There are 3 occurrences that set localStorage then redirect. Replace each `router.push('/dashboard')` with:

```typescript
if (onLoginSuccess) {
  onLoginSuccess();
} else {
  router.push('/dashboard');
}
```

Locations:
- `onPasswordSubmit` (line 131-133): after `localStorage.setItem`
- `PasskeyLoginButton onSuccess` callback (line 221-224): after `localStorage.setItem`
- `MfaVerifyStep onSuccess` callback (line 415-418): after `localStorage.setItem`

**Step 4: Conditionally hide the "Register" link at bottom**

At line 429-436, the register link should be hidden when embedded in the registration flow. Wrap it:

```tsx
{!onLoginSuccess && step !== 'magic-link-sent' && step !== 'mfa' && (
  <div className="mt-6 text-center text-sm">
    ...
  </div>
)}
```

**Step 5: Verify build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors.

**Step 6: Commit**

```bash
git add apps/web/src/components/auth/email-first-login.tsx
git commit -m "feat: add onLoginSuccess callback to EmailFirstLogin component"
```

---

### Task 2: Add i18n keys for the new step flow

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Update the `registration.steps` keys and add welcome keys**

In each locale file, find the `"registration"` section and update/add these keys inside it.

**en.json** — find `"steps"` inside `"registration"` and replace + add:

```json
"steps": {
  "welcome": "Welcome",
  "details": "Details",
  "order": "Order",
  "payment": "Payment"
},
"welcome": {
  "newTitle": "I'm new",
  "newDescription": "Register as a new shareholder",
  "existingTitle": "I already have an account",
  "existingDescription": "Log in to buy shares faster"
},
```

**nl.json:**

```json
"steps": {
  "welcome": "Welkom",
  "details": "Gegevens",
  "order": "Bestelling",
  "payment": "Betaling"
},
"welcome": {
  "newTitle": "Ik ben nieuw",
  "newDescription": "Registreer als nieuwe aandeelhouder",
  "existingTitle": "Ik heb al een account",
  "existingDescription": "Log in om sneller aandelen te kopen"
},
```

**fr.json:**

```json
"steps": {
  "welcome": "Bienvenue",
  "details": "Coordonnées",
  "order": "Commande",
  "payment": "Paiement"
},
"welcome": {
  "newTitle": "Je suis nouveau",
  "newDescription": "S'inscrire en tant que nouvel actionnaire",
  "existingTitle": "J'ai déjà un compte",
  "existingDescription": "Connectez-vous pour acheter des actions plus rapidement"
},
```

**de.json:**

```json
"steps": {
  "welcome": "Willkommen",
  "details": "Angaben",
  "order": "Bestellung",
  "payment": "Zahlung"
},
"welcome": {
  "newTitle": "Ich bin neu",
  "newDescription": "Als neuer Aktionär registrieren",
  "existingTitle": "Ich habe bereits ein Konto",
  "existingDescription": "Melden Sie sich an, um schneller Aktien zu kaufen"
},
```

**Step 2: Remove the old `"confirm"` step key**

In each locale file, remove `"confirm": "..."` from the `"steps"` object (it's replaced by `"payment"`).

**Step 3: Commit**

```bash
git add apps/web/messages/
git commit -m "feat: add i18n keys for 4-step registration flow"
```

---

### Task 3: Add `logoUrl` to CoopPublicInfo interface

The API already returns `logoUrl` in the channel public-info response, but the frontend interface doesn't include it.

**Files:**
- Modify: `apps/web/src/components/coop-register-content.tsx:24-45`

**Step 1: Add `logoUrl` to the `CoopPublicInfo` interface**

At line 24-45, add `logoUrl` and `secondaryColor`:

```typescript
interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  primaryColor: string;
  secondaryColor?: string;
  logoUrl?: string | null;
  bankName?: string;
  bankIban?: string;
  bankBic?: string;
  termsUrl?: string;
  shareClasses: Array<{
    id: string;
    name: string;
    code: string;
    pricePerShare: number;
    minShares: number;
    maxShares?: number;
  }>;
  projects: Array<{
    id: string;
    name: string;
  }>;
}
```

**Step 2: Add `resolveLogoUrl` import**

At the top of the file (around line 19), add:

```typescript
import { resolveLogoUrl } from '@/lib/api';
```

**Step 3: Commit**

```bash
git add apps/web/src/components/coop-register-content.tsx
git commit -m "feat: add logoUrl to CoopPublicInfo interface"
```

---

### Task 4: Rewrite the header

Replace the dark colored header with a light header showing logo + coop name.

**Files:**
- Modify: `apps/web/src/components/coop-register-content.tsx:1071-1097`

**Step 1: Replace the header and step indicator**

Find the return statement (line 1071-1097) and replace the `<header>` block (lines 1074-1082) with:

```tsx
<header className="bg-white border-b shadow-sm">
  <div className="container mx-auto px-4 py-4">
    <div className="flex items-center gap-3">
      {coop.logoUrl ? (
        <img
          src={resolveLogoUrl(coop.logoUrl)!}
          alt={coop.name}
          className="h-10 object-contain"
        />
      ) : (
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: coop.primaryColor }}
        >
          <span className="text-white font-bold text-lg">
            {coop.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div>
        <h1
          className="text-xl font-bold"
          style={{ color: coop.primaryColor }}
        >
          {coop.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('registration.title')}
        </p>
      </div>
    </div>
  </div>
</header>
```

**Step 2: Update the step indicator to use primaryColor for active step**

Find `renderStepIndicator` (line 450-486). The current implementation already uses `coop.primaryColor` for the active step. No structural changes needed here — it will be updated in Task 5 with the new step labels.

**Step 3: Verify it renders**

Run: `cd apps/web && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add apps/web/src/components/coop-register-content.tsx
git commit -m "feat: light header with logo for registration flow"
```

---

### Task 5: Implement 4-step logic with welcome gate

This is the main task. We need to:
- Add a welcome step (Step 1) for non-logged-in users
- Skip it for logged-in users
- Adjust step numbering dynamically
- Add inline login via `EmailFirstLogin`

**Files:**
- Modify: `apps/web/src/components/coop-register-content.tsx`

**Step 1: Add EmailFirstLogin import**

Add at the top of the file:

```typescript
import { EmailFirstLogin } from '@/components/auth/email-first-login';
```

**Step 2: Replace the step labels and navigation logic**

Find the steps array (lines 123-128). Replace with:

```typescript
// Step labels depend on whether user is logged in
// Logged in: Details → Order → Payment (3 steps)
// Not logged in: Welcome → Details → Order → Payment (4 steps)
const stepsForLoggedIn = [
  t('registration.steps.details'),
  t('registration.steps.order'),
  t('registration.steps.payment'),
];
const stepsForNewUser = [
  t('registration.steps.welcome'),
  t('registration.steps.details'),
  t('registration.steps.order'),
  t('registration.steps.payment'),
];
const steps = isLoggedIn ? stepsForLoggedIn : stepsForNewUser;
const totalSteps = steps.length;

// Map logical step names to step numbers
const STEP = isLoggedIn
  ? { DETAILS: 1, ORDER: 2, PAYMENT: 3 }
  : { WELCOME: 1, DETAILS: 2, ORDER: 3, PAYMENT: 4 };
```

**Step 3: Update initial step**

Find `const [step, setStep] = useState(1);` (line 107). This stays as 1 — for logged-in users step 1 is Details, for new users step 1 is Welcome. Correct by default.

**Step 4: Add a `handleLoginSuccess` callback**

Add after the `handleShareholderChange` function (around line 327):

```typescript
// Called when user logs in via the welcome step's inline login
const handleLoginSuccess = async () => {
  // Re-fetch data now that we're logged in
  const token = localStorage.getItem('accessToken');
  if (!token || !coop) return;

  try {
    const meResponse = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/auth/me`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (meResponse.ok) {
      const meData = await meResponse.json();
      setIsLoggedIn(true);

      const shareholdersForCoop: ExistingShareholder[] = (meData.shareholders || [])
        .filter((s: { coop: { id: string } }) => s.coop.id === coop.id)
        .map((s: {
          id: string;
          type: 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
          firstName?: string;
          lastName?: string;
          birthDate?: string;
          companyName?: string;
          companyId?: string;
          vatNumber?: string;
          email?: string;
          phone?: string;
          address?: { street?: string; number?: string; postalCode?: string; city?: string; country?: string } | null;
        }) => ({
          id: s.id,
          type: s.type,
          firstName: s.firstName,
          lastName: s.lastName,
          birthDate: s.birthDate,
          companyName: s.companyName,
          companyId: s.companyId,
          vatNumber: s.vatNumber,
          email: s.email,
          phone: s.phone,
          street: s.address?.street,
          number: s.address?.number,
          postalCode: s.address?.postalCode,
          city: s.address?.city,
          country: s.address?.country,
        }));
      setAllShareholders(shareholdersForCoop);

      if (shareholdersForCoop.length > 0) {
        setSelectedShareholder(shareholdersForCoop[0]);
        prefillFormWithShareholder(shareholdersForCoop[0]);
      } else if (meData.email) {
        form.setValue('email', meData.email);
      }

      // Jump to Details step (step 1 for logged-in users)
      setStep(1);
    }
  } catch {
    // Login worked but data fetch failed — still advance
    setIsLoggedIn(true);
    setStep(1);
  }
};
```

**Step 5: Add `showLoginForm` state and the welcome step renderer**

Add state variable near the other state declarations (around line 111):

```typescript
const [showLoginForm, setShowLoginForm] = useState(false);
```

Add the welcome step renderer after the existing `renderStep1NewUser` function (around line 772):

```tsx
// ============================================================================
// WELCOME STEP: New vs Existing (non-logged-in users only)
// ============================================================================
const renderWelcomeStep = () => (
  <div className="space-y-4">
    {!showLoginForm ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* I'm new */}
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow border-2 hover:border-current"
          style={{ '--tw-border-opacity': 0 } as React.CSSProperties}
          onClick={() => {
            setStep(STEP.DETAILS);
          }}
        >
          <CardContent className="pt-6 text-center space-y-3">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
              style={{ backgroundColor: `${coop.primaryColor}15`, color: coop.primaryColor }}
            >
              <UserPlus className="h-7 w-7" />
            </div>
            <h3 className="font-semibold text-lg">
              {t('registration.welcome.newTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('registration.welcome.newDescription')}
            </p>
            <Button
              className="w-full"
              style={{ backgroundColor: coop.primaryColor }}
            >
              {t('common.next')}
            </Button>
          </CardContent>
        </Card>

        {/* I have an account */}
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setShowLoginForm(true)}
        >
          <CardContent className="pt-6 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
              <LogIn className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg">
              {t('registration.welcome.existingTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('registration.welcome.existingDescription')}
            </p>
            <Button variant="outline" className="w-full">
              {t('auth.login')}
            </Button>
          </CardContent>
        </Card>
      </div>
    ) : (
      <div className="max-w-md mx-auto space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowLoginForm(false)}
        >
          ← {t('common.back')}
        </Button>
        <EmailFirstLogin
          coop={{
            name: coop.name,
            logoUrl: coop.logoUrl,
            primaryColor: coop.primaryColor,
            secondaryColor: coop.secondaryColor || coop.primaryColor,
            slug: coopSlug,
          }}
          onLoginSuccess={handleLoginSuccess}
        />
      </div>
    )}
  </div>
);
```

**Step 6: Add `LogIn` to the lucide-react imports**

At line 21, update the import:

```typescript
import { Gift, UserPlus, LogIn } from 'lucide-react';
```

**Step 7: Update `renderStep` to include the welcome step**

Find the `renderStep` switch (lines 1058-1069). Replace with:

```typescript
const renderStep = () => {
  if (!isLoggedIn && step === STEP.WELCOME) {
    return renderWelcomeStep();
  }
  if (step === STEP.DETAILS) {
    return hasExistingShareholders ? renderStep1ExistingUser() : renderStep1NewUser();
  }
  if (step === STEP.ORDER) {
    return renderStep2Order();
  }
  if (step === STEP.PAYMENT) {
    return renderStep3Confirmation();
  }
  return null;
};
```

**Step 8: Update `nextStep` / `prevStep` and navigation in step renderers**

Find `const nextStep` and `const prevStep` (lines 330-331). These still work as-is since they just increment/decrement.

Update `handleStep1Next` (line 334-355) — this advances from Details to Order. Change `nextStep()` calls to `setStep(STEP.ORDER)`:

```typescript
const handleStep1Next = async () => {
  if (hasExistingShareholders) {
    setStep(STEP.ORDER);
    return;
  }
  // ... validation logic stays the same ...
  if (result) {
    setStep(STEP.ORDER);
  }
};
```

Update `onSubmit` (line 357-431) — on success, change `setStep(totalSteps)` to `setStep(STEP.PAYMENT)`:

```typescript
setStep(STEP.PAYMENT);
```

Update the Back button in `renderStep2Order` (line 934) to go to Details:

```typescript
<Button type="button" variant="outline" onClick={() => setStep(STEP.DETAILS)}>
```

Update the Back button in `renderStep1NewUser` (line 738-745) for logged-in users who clicked "register new" — Back should go to the existing shareholder picker (still STEP.DETAILS, same step).

**Step 9: Remove the "choosePaymentMethod" section from Step 2 (Order)**

Find the payment method section in `renderStep2Order` (lines 852-873). Remove the entire `{/* Payment method */}` block since only bank transfer exists. Keep the `paymentMethod` default as `'BANK_TRANSFER'` in the form defaults (line 134).

**Step 10: Verify build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors.

**Step 11: Commit**

```bash
git add apps/web/src/components/coop-register-content.tsx
git commit -m "feat: 4-step registration flow with welcome gate and login option

- Step 1 (Welcome): new vs existing user cards, inline login
- Step 2 (Details): beneficiary type + form (skipped to directly for logged-in users)
- Step 3 (Order): share class, project, quantity, terms
- Step 4 (Payment): summary + EPC QR + bank details
- Logged-in users see 3 steps (Details → Order → Payment)
- Removed payment method selector (only bank transfer exists)"
```

---

### Task 6: End-to-end verification

**Step 1: Run full type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

**Step 2: Run dev server and test manually**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm dev`

Test the following scenarios:

1. **New user flow (not logged in):**
   - Navigate to `http://localhost:3002/nl/bronsgroen/default/register`
   - Should see Welcome step with two cards
   - Click "I'm new" → should go to Details step (beneficiary type + form)
   - Fill in details → Next → Order step (share class, quantity, terms)
   - Accept terms, click complete → Payment step (QR + bank details)

2. **Login flow from welcome:**
   - Navigate to register page (not logged in)
   - Click "I have an account" → should show inline login form
   - Click Back → should return to two-card view
   - Log in successfully → should jump to Details step with shareholder profiles loaded

3. **Already logged in:**
   - Log in first via `/nl/login`
   - Navigate to `http://localhost:3002/nl/bronsgroen/default/register`
   - Should skip Welcome step entirely
   - Should see Details step directly (pick existing profile or register new)
   - Step indicator should show 3 steps, not 4

4. **Header:**
   - Should be light/white background
   - Should show coop logo (or initial letter fallback)
   - Coop name in brand color
   - "Aandelenregistratie" subtitle in muted text

5. **Preselection via URL params:**
   - Navigate with `?class=A&project=some-id`
   - Should auto-select in Order step

**Step 3: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: address issues found during registration flow testing"
```
