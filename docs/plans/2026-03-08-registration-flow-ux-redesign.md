# Registration Flow UX Redesign — Design

**Date:** 2026-03-08
**Status:** Approved
**Scope:** Public share registration flow (`CoopRegisterContent`) — header, step structure, and logged-in shortcuts

---

## Problem

The current 3-step registration flow feels like a bureaucratic form rather than a smooth checkout. Specific issues:

1. **Header** — Dark colored background looks dated. Logo not shown. The `secondaryColor` isn't used; `primaryColor` as a flat bg often looks muddy.
2. **Step 1 is overloaded** — Beneficiary type selection + all personal details on one screen. No quick path for existing shareholders.
3. **No login prompt upfront** — "Already a member? Log in" is a text link buried at the bottom of the form. Returning shareholders have to scroll past the entire form to find it.
4. **Step 2 mixes concerns** — Share selection, payment method (only bank transfer), order summary, and terms acceptance all on one screen.

## Design

### Header

**Before:** Solid `primaryColor` background, white text, no logo.

**After:** Light/white background with subtle bottom border. Coop logo on the left, coop name + "Aandelenregistratie" subtitle next to it. `primaryColor` used only for accents (step indicators, buttons, links) — not as a background fill.

```
┌─────────────────────────────────────────────────────┐
│  [logo]  Bronsgroen                                 │
│          Aandelenregistratie                         │
├─────────────────────────────────────────────────────┤
│  ● 1 Gegevens ──── 2 Bestelling ──── 3 Betaling    │
└─────────────────────────────────────────────────────┘
```

- Logo from channel/coop `logoUrl` (fallback: Building2 icon)
- Coop name styled in `primaryColor`
- Step indicator: active step number uses `primaryColor` background, completed steps get a green checkmark
- The header + step indicator sit in a single white bar with a shadow, sticky on scroll

### Step Flow (4 Steps)

#### Routing Logic

```
logged in?
  ├── yes → skip to Step 2 (pick profile or register new)
  └── no → Step 1 (welcome gate)
```

If the URL has `?class=X&project=Y`, those are preselected and Step 3 auto-fills (but user can still change).

#### Step 1: Welcome (non-logged-in users only)

Two large cards, side by side on desktop, stacked on mobile:

```
┌──────────────────┐  ┌──────────────────┐
│   👤 I'm new     │  │  🔑 I already    │
│                  │  │  have an account  │
│  Register as a   │  │                  │
│  new shareholder │  │  Log in to buy   │
│                  │  │  shares faster   │
│    [Continue →]  │  │    [Log in →]    │
└──────────────────┘  └──────────────────┘
```

- **"I'm new"** → proceeds to Step 2 (new user flow with beneficiary type + details)
- **"Log in"** → shows inline email-first login (same `EmailFirstLogin` component used elsewhere). On success, reloads and jumps to Step 2 with shareholder profiles loaded.

No form fields on this screen. Just a decision point.

#### Step 2: Your Details

**Two sub-flows based on auth state:**

**A) Logged in with existing shareholders in this coop:**
- Shows list of shareholder profiles (same cards as current `renderStep1ExistingUser`)
- "Register someone new" option at the bottom
- Selecting a profile → proceeds to Step 3

**B) New user (or logged-in user registering a new person):**
- Beneficiary type selector (self / family / company / gift) — radio cards
- Form fields below, dynamically shown based on type (same as current)
- OAuth prefill buttons for "self" type (Google/Apple)

This is the heaviest step, but it's unavoidable — we need the data. The improvement is that returning users skip it entirely.

#### Step 3: Your Order

- **Share class**: Dropdown if multiple, auto-selected + read-only display if only one
- **Project**: Dropdown if multiple projects, hidden if none, auto-selected if from URL
- **Quantity**: Number input with min/max from share class
- **Running total**: Prominently displayed with `primaryColor`
- **Terms checkbox**: Moved here from old step 2 — accept before proceeding to payment

If there's only 1 share class, no projects, and quantity is 1 (common case): this step is very lightweight — just confirm the amount and accept terms.

#### Step 4: Payment

This is the final screen. No more "Next" — this is the result.

- **Order summary** at top (who, what, how many, total)
- **EPC QR code** (large, centered, prominent) — "Scan with your banking app"
- **Bank details** below QR: beneficiary, IBAN, BIC, amount, OGM code
- **Registration ID** at bottom for reference

The key UX shift: instead of "Confirmation" (which implies something already happened), it's "Payment" (clear call to action — you need to pay now).

### Visual Polish

- All cards use consistent rounded corners and subtle shadows
- Buttons use `primaryColor` as background, white text
- Form inputs have focus rings in `primaryColor`
- Step indicator numbers: completed = green check, active = `primaryColor` circle, upcoming = gray
- The whole flow is max-width 640px centered, with generous padding
- Mobile: full-width cards, stacked layout for Step 1

### Step Count Display

Non-logged-in users see: `1 → 2 → 3 → 4` (Welcome, Details, Order, Payment)
Logged-in users see: `1 → 2 → 3` (Details, Order, Payment) — step numbering adjusts, they don't see "Step 2 of 4"

### What Stays The Same

- All form fields and validation logic
- API calls (`POST /coops/:slug/channels/:channelSlug/register`)
- Preselection via URL params (`?class=X&project=Y&shareholderId=Z`)
- Gift flow (beneficiary type "gift")
- EPC QR code component
- OGM code generation

### What Changes

| Aspect | Before | After |
|--------|--------|-------|
| Header bg | `primaryColor` solid fill | White/light with logo |
| Logo | Not shown | Shown in header |
| Step count | 3 fixed | 4 for new users, 3 for logged-in |
| Login prompt | Text link at bottom of form | Prominent card in Step 1 |
| Beneficiary + details | One overloaded step | Still one step, but not the first thing you see |
| Terms checkbox | Mixed into order step | Own clear moment in Step 3 |
| Final step label | "Bevestiging" (Confirmation) | "Betaling" (Payment) |
| Step indicator | Below colored header | Integrated into white header bar |

### i18n Keys Needed

New keys for all 4 locales (en, nl, fr, de):
- `registration.steps.welcome` — "Welcome" / "Welkom" / "Bienvenue" / "Willkommen"
- `registration.steps.details` — already exists
- `registration.steps.order` — already exists
- `registration.steps.payment` — "Payment" / "Betaling" / "Paiement" / "Zahlung"
- `registration.welcome.newTitle` — "I'm new"
- `registration.welcome.newDescription` — "Register as a new shareholder"
- `registration.welcome.existingTitle` — "I already have an account"
- `registration.welcome.existingDescription` — "Log in to buy shares faster"
- `registration.welcome.continue` — "Continue"

### Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/components/coop-register-content.tsx` | Rewrite: header, step logic, step 1 welcome gate, step renumbering |
| `apps/web/messages/en.json` | Add new i18n keys |
| `apps/web/messages/nl.json` | Add new i18n keys |
| `apps/web/messages/fr.json` | Add new i18n keys |
| `apps/web/messages/de.json` | Add new i18n keys |

No backend changes needed. No new API endpoints.
