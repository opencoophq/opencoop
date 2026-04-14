# Changelog

All notable changes to OpenCoop are documented in this file.

## [0.7.63] - 2026-04-14

### Fixed
- **MCP API key dialog config snippet background overflow** — the JSON config block in the "API key created" dialog cut off its background mid-line when the long `Authorization: Bearer ...` line overflowed horizontally. The `<pre>` now grows to its content width with `inline-block` inside a scroll wrapper, so the muted background spans the full snippet.

## [0.7.62] - 2026-04-13

### Fixed
- **Missing migration for `api_keys` table** — the `ApiKey` model was added to the schema in 0.7.61 but no Prisma migration file was generated. Prod and acc deployments use `prisma migrate deploy` which requires migration files, so the table wasn't being created. Added the missing migration.

## [0.7.61] - 2026-04-13

### Added
- **Authenticated admin MCP server** — coop admins can now connect Claude or other AI assistants to query their cooperative's data via MCP. 13 read-only tools cover shareholders, transactions, analytics, share classes, projects, and annual overviews. Date range and channel filtering support campaign attribution analysis.
- **Per-user API keys** — admins generate personal API keys in dashboard Settings → AI API Keys. Keys are SHA-256 hashed, revocable, and scoped to one cooperative. The creation dialog shows a ready-to-paste Claude MCP config snippet.
- **Key management REST API** — `GET/POST/DELETE /admin/coops/:coopId/api-keys` for creating, listing, and revoking API keys programmatically.

### Removed
- **Public MCP endpoint** — the unauthenticated `POST /mcp` endpoint that exposed coop info, bank details, and investment stats has been replaced by the authenticated version.
- **llms.txt endpoints** — `GET /llms.txt` and `GET /llms-full.txt` removed (exposed sensitive data without authentication).

## [0.7.59] - 2026-04-10

### Fixed
- **Payment dialog date picker respects user locale** — replaced native `<input type="date">` (which shows mm/dd/yyyy on US-configured systems) with the existing locale-aware DatePicker component in both the transactions and shareholder detail payment dialogs.
- **Clarified payment dialog dismiss button** — the "Confirm" button that only closed the dialog was confusing next to the "Mark as completed" action. Now shows "Cancel" when mark-complete is available, and "Close" when just viewing payment info.

## [0.7.58] - 2026-04-10

### Added
- **Participant names in admin messages overview** — the Participants column in the admin Postvak now shows actual names instead of a count. Broadcast messages display "All shareholders"; direct messages show up to 2 participant names with an ellipsis for overflow.

## [0.7.57] - 2026-04-10

### Changed
- **Removed Payconiq/Bancontact link from payment dialogs** — the link to `payconiq.com` has been removed as the site is outdated and unhelpful. The EPC QR code and copy-OGM button remain the primary payment tools.

## [0.7.56] - 2026-04-10

### Fixed
- **Payconiq/Bancontact link works on iOS Safari** — replaced the `payconiq://` custom URL scheme with `https://payconiq.com` (HTTPS universal link). iOS Safari blocks custom schemes with "address is invalid" when the app is not installed; the HTTPS link opens the Payconiq website as a fallback instead.
- **Copy OGM reference button in payment dialogs** — a clipboard icon now appears next to the structured reference (OGM) in all payment dialogs. Tapping it copies the reference and briefly shows a checkmark, making it easy to paste into any banking app on mobile.

## [0.7.55] - 2026-04-10

### Fixed
- **Message notification email deep-links to conversation** — the "View message" button in shareholder notification emails now links directly to the specific conversation (`/dashboard/inbox/{conversationId}`) instead of the generic inbox. Previously shareholders would land on the inbox list and sometimes start a new thread instead of replying in-place.

## [0.7.54] - 2026-04-10

### Added
- **Payconiq/Bancontact deep link in payment dialogs** — a "Pay via Payconiq / Bancontact" link now appears below the EPC QR code in all payment dialogs (admin transaction view and shareholder share purchase/pending-payment screens). On mobile, tapping opens the Payconiq or Bancontact app pre-filled with the amount, currency, and OGM structured reference.
- **Participant names in admin messages overview** — the Participants column in the admin Postvak now shows actual names instead of a count. Broadcast messages display "All shareholders"; direct messages show up to 2 participant names with an ellipsis for overflow.

## [0.7.53] - 2026-04-09

### Fixed
- **E2E test alignment** — updated shareholder dashboard E2E test to reflect settings being in the user dropdown instead of the sidebar.

## [0.7.52] - 2026-04-09

### Changed
- **User settings moved to user dropdown** — the "Settings" link previously shown in the sidebar under "My Account" is now accessible directly from the user dropdown at the bottom of the sidebar. This follows standard SaaS UX patterns (Linear, GitHub, Notion) and reduces sidebar clutter.

## [0.7.51] - 2026-04-09

### Added
- **Configurable notification digest time** — coop admins can now set the hour (UTC) at which their daily or weekly email digest is delivered. Previously hardcoded to 09:00 UTC; now each admin picks their preferred time in the notification settings.

### Fixed
- **Notification settings unreachable for admins** — the "Settings" link was missing from the admin sidebar, making notification preferences inaccessible for coop admins. A "My Account" section with a Settings link is now visible in the admin navigation.

## [0.7.50] - 2026-04-09

### Added
- **Cancel transactions for coop admins** — coop admins can now cancel erroneous or duplicate transactions directly from the transaction list. A cancel button (ban icon) appears for `PENDING` and `PENDING_PAYMENT` transactions. Clicking opens a confirmation dialog with an optional reason field. Cancellation is blocked for transactions that have already been completed or are in active payment processing.

## [0.7.49] - 2026-04-09

### Added
- **Email notifications for coop admins** — coop admins can now configure per-coop email notification preferences in their account settings. Choose which events trigger a notification (new shareholder registered, share purchase, share sale, payment received) and the frequency: immediate (every event), daily digest, or weekly digest. Each admin's settings are independent per cooperative.

## [0.7.43] - 2026-04-04

### Fixed
- **Sold-back shares no longer appear in Aandelenbezit table** — when a shareholder sells shares back, the sold registration was previously listed as extra "owned shares" in the Shareholdings table. The table now correctly shows only active BUY registrations with remaining share count, computed as vested shares minus sold quantity. The sell dialog also correctly limits the sellable quantity to actually-owned shares.

## [0.7.42] - 2026-04-04

### Added
- **Send message button in shareholder detail** — coop admins can now send a direct message to a shareholder directly from the shareholder detail page, without navigating to the Inbox compose page. A "New Message" button in the header opens an inline dialog with subject and body fields.
- **Multilingual message notification emails** — shareholder email notifications for new inbox messages are now sent in the shareholder's preferred language (NL/EN/FR/DE), consistent with other transactional emails.

## [0.7.41] - 2026-04-04

### Improved
- **Clickable shareholder names in admin transaction list** — shareholder names in the Transactions overview are now links that navigate directly to the shareholder detail page, making it easy to verify share age and history before processing buybacks.

## [0.7.40] - 2026-03-23

### Added
- **Payment confirmation email with share certificate** — when a share purchase payment is completed (via Ponto auto-match, admin manual complete, CSV import, or manual match), the shareholder now receives an automatic email confirmation with their share certificate PDF attached and a link to their dashboard. The email is translated in all 4 supported languages (NL/EN/FR/DE) based on the shareholder's preferred language setting.

## [0.7.39] - 2026-03-23

### Added
- **Signature image upload in admin settings** — coop admins can now upload a PNG/JPG signature image directly from the admin settings page (under Certificate Signatory). The image is stored per-coop and rendered on share certificates above the signature line.

## [0.7.37] - 2026-03-23

### Added
- **Signature image on share certificate** — coops can now configure a signature image (`certificateSignatureUrl`) that appears above the signatory name on generated share certificates. Wouter's signature has been configured for Bronsgroen.

## [0.7.35] - 2026-03-21

### Fixed
- **MFA login lockout resolved** — users who enabled 2FA (password + authenticator app) were permanently locked out after setup. The MFA verification endpoint correctly validated the TOTP code but then re-issued an mfa-pending challenge token instead of the real access token, making login impossible. Fixed for both password+MFA and magic link login flows. Also fixed coop-branded magic link pages which had no MFA step at all, silently storing undefined tokens.

## [0.7.34] - 2026-03-16

### Fixed
- **Admin transactions: "Type" column header now shows translated text** — the Type column header in the coop admin Transactions overview was displaying the raw translation key `transactions.type` instead of the label "Type". Fixed by using the correct `transactions.typeLabel` key, which is properly translated in all 4 supported languages (EN/NL/FR/DE).

## [0.7.33] - 2026-03-15

### Added
- **Multi-bank CSV import** — bank import now supports Belfius, KBC, ING, and BNP Paribas Fortis CSV formats in addition to the generic format. Select your bank from the dropdown before uploading.
- **Manual transaction matching** — clicking "Match" on an unmatched bank transaction now opens a dialog listing pending registrations (shareholder name, OGM code, amount) for one-click matching.

## [0.7.32] - 2026-03-15

### Added
- **Changelog page for coop admins** — a "What's New" page is now available in the admin sidebar (Megaphone icon). Shows all platform releases with version, date, and categorized changes (Added/Fixed/Changed etc.) in a timeline layout with color-coded badges.

## [0.7.31] - 2026-03-15

### Fixed
- **Account switcher: sidebar now updates after switching** — switching to another account in the sidebar dropdown now correctly updates the displayed name, email, role, and navigation items. Previously the sidebar kept showing the old account's info until a manual page refresh.

## [0.7.30] - 2026-03-15

### Added
- **Multi-account switching** — users can now log in with multiple accounts and switch between them from the sidebar. Clicking the user area at the bottom of the dashboard opens a dropdown showing all saved accounts, an "Add account" link, and logout. Useful for switching between coop admin and shareholder views without re-entering credentials.

## [0.7.29] - 2026-03-15

### Fixed
- **Coop admin homepage redirect** — coop admins landing on `/dashboard` are now immediately redirected to `/dashboard/admin` instead of seeing the shareholder overview (which showed all zeros). System admins are redirected to `/dashboard/system`.

## [0.7.28] - 2026-03-15

### Added
- **Referral links use coop website URL** — referral links now use the per-coop configured website URL instead of the generic opencoop.be domain.

## [0.7.27] - 2026-03-15

### Changed
- **Referral code format** — referral codes now use a `firstname1234` style format for a friendlier, more recognizable code.

## [0.7.26] - 2026-03-13

### Added
- **Favicon** — OpenCoop now has a browser favicon based on the logo: a rounded blue square with the building icon. Shows in browser tabs and bookmarks.

## [0.7.25] - 2026-03-13

### Added
- **EPC QR code: share count in description** — QR payment descriptions now include the number of shares, e.g. "Aankoop 3 aandelen" or "Terugbetaling 1 aandelen". Available in EN/NL/FR/DE.

## [0.7.24] - 2026-03-13

### Added
- **EPC QR code: payment description** — QR codes now include a human-readable description ("Share purchase" / "Share refund") in the unstructured remittance field, so banking apps display what the payment is for when scanned. The same description also appears as a label below the QR code in the UI. Available in EN/NL/FR/DE.

## [0.7.23] - 2026-03-13

### Fixed
- **EPC QR code: BIC guard in transactions page** — the admin transactions page still showed "IBAN is missing" error for shareholders with IBAN but no BIC. Missed location from the v0.7.22 fix.

## [0.7.22] - 2026-03-13

### Fixed
- **EPC QR code: BIC no longer required** — shareholders with a valid IBAN but no BIC can now generate QR codes for share transactions. Per the EPC QR standard (version 002), BIC has been optional since SEPA dropped the requirement in November 2016. The QR code renders with an empty BIC field, which is fully valid and accepted by banking apps.

## [0.7.21] - 2026-03-13

### Fixed
- **IBAN/BIC placeholder clarity** — updated placeholder text to explicit `e.g.` format and added helper copy below each field ("Example format only. Enter the shareholder's own IBAN/BIC.") so admins no longer mistake the example values for the shareholder's actual saved data. Also improved mobile layout with single-column stacking.

## [0.7.16] - 2026-03-12

### Fixed
- **Certificate dates** — certificates now show the payment date (date of registration in shareholder register) instead of the signup date
- **Certificate placement** — moved certificate download button from "Registration History" to "Shareholdings" table on the admin shareholder detail page
- **Certificates restricted to completed registrations** — certificate generation now requires COMPLETED status (payment confirmed) instead of allowing ACTIVE registrations

## [0.7.15] - 2026-03-12

### Changed
- **Transaction tables: separate date columns** — split single "Date" column into "Registration Date" and "Payment Date" in both the transactions page and shareholder detail page, so dividend-relevant payment dates are clearly visible
- **Inline payment date editing** — click the payment date on any completed registration to edit it directly in the table (replaces the previous modal approach)

## [0.7.14] - 2026-03-12

### Fixed
- **Admin: shareholder type change error display** — show actual backend error messages instead of generic "Something went wrong" when saving shareholder changes fails
- **Admin: parent/guardian warning** — show a clear warning when the selected parent/guardian has no user account, explaining they need an account before they can be linked as parent

## [0.7.13] - 2026-03-12

### Added
- **Payment confirmation on shareholder detail page** — coop admins can now mark registrations as complete and view QR payment details directly from a shareholder's detail page (previously only available on the transactions page)
- **Payment date picker** — when marking a registration as complete, admins can set the actual payment date (defaults to today) in both the transactions page and shareholder detail page
- **Edit payment date** — coop admins can edit the payment date on completed registrations via a calendar icon button, useful for correcting dates after the fact

## [0.7.12] - 2026-03-12

### Added
- **Admin: shareholder type management** — coop admins can now change shareholder type (Individual/Company/Minor) and set parent/guardian relationships directly from the admin shareholder detail page
- **Data fix script** — `fix-jasmine-maurice-email-swap.ts` corrects email swap between Maurice and Jasmine Verriet from migration

## [0.7.11] - 2026-03-12

### Added
- **Referral link system** — cooperators can share referral links to invite new shareholders, with tracking and referral success email notifications to the referrer

### Fixed
- **Code review fixes** — addressed review issues in referral system (cookie notice click blocking, E2E test stability)

## [0.7.10] - 2026-03-11

### Added
- **Data Processing Agreement (DPA)** — new `/dpa` page with full GDPR Article 28 compliant DPA content in 4 languages (EN, NL, FR, DE), covering sub-processors, data retention, breach notification, audit rights
- **Cookie notice banner** — informational cookie banner for essential cookies, dismissible via localStorage, all 4 languages
- **Legal footer links** — Terms & Conditions, Privacy Policy, and DPA links added to marketing footer

## [0.7.9] - 2026-03-10

### Added
- **Shareholder bulk import** — import shareholders from CSV or Excel (.xlsx) files via the admin dashboard
  - Two-step flow: dry-run validation first, then commit on confirmation
  - Validates required fields per shareholder type (INDIVIDUAL, COMPANY, MINOR)
  - Email uniqueness checks (per-coop), date format validation, 5000 row limit
  - Encrypts nationalId fields before storage
  - CSV template download for easy onboarding
  - Frontend import dialog with file upload, preview stats, and per-row error details
  - i18n support in all 4 languages (EN, NL, FR, DE)
  - MIME type validation on file upload
  - Audit log written atomically inside the same database transaction

## [0.7.8] - 2026-03-10

### Added
- **Token refresh mechanism** — JWT access tokens now expire after 15 minutes and are silently refreshed using 30-day refresh tokens, eliminating session loss on page navigation
- **Logout endpoint** — `POST /auth/logout` revokes all refresh tokens server-side
- **Refresh token model** — new `RefreshToken` database table with hashed tokens, expiry, and soft revocation

### Changed
- **Frontend API client** — on 401, automatically attempts token refresh and retries the original request before redirecting to login (singleton pattern prevents concurrent refresh races)
- **All auth flows** — login, register, onboarding, magic link, OAuth, passkey, MFA, and invite accept now issue and store refresh tokens

## [0.7.7] - 2026-03-10

### Fixed
- **Dashboard: parent sees only minor's shares** — sort shareholders by type priority (INDIVIDUAL > COMPANY > MINOR) so the parent's own record always appears first
- **Data fix script** — `fix-minor-shareholder.ts` corrects minor shareholders that share a userId with their parent

## [0.7.6] - 2026-03-10

### Fixed
- **Security: open redirect in OAuth callbacks** — validate `state.redirect` starts with `/` and has no `//` to prevent redirect to external domains
- **Security: Swagger docs production exposure** — restored `NODE_ENV !== 'production'` guard on Swagger setup
- **Security: permission guard bypass** — old JWTs missing `coopPermissions` claim now get `ForbiddenException` instead of full access
- **Admin: canManageMessages permission** — added to admin UI and role defaults
- **E2E: flaky sell-shares test** — added bankIban to seed data

### Changed
- `.gitignore` updated to block stale build artifacts, PII exports, and `.claire/` directory

## [0.7.3] - 2026-03-10

### Fixed
- **Ecopower card on shareholder detail** — squash merge also lost the Ecopower client checkbox and ID field on the shareholder detail page

## [0.7.2] - 2026-03-10

### Fixed
- **API key generation endpoint missing** — squash merge of Ecopower PR lost the `POST api-key/regenerate` admin endpoint
- **Ecopower shareholder filter missing** — squash merge also lost the `ecoPowerClient` query parameter on the shareholders list

## [0.7.1] - 2026-03-10

### Fixed
- **Settings save failing** — `termsUrl` (a Channel field) was sent to the coop update endpoint, rejected by `forbidNonWhitelisted` validation
- **Ecopower null enum validation** — sending `ecoPowerMinThresholdType: null` when Ecopower is disabled now passes validation
- **Payment email timing** — send payment confirmation email regardless of registration status

## [0.7.0] - 2026-03-10

### Added
- **Redesigned share certificate** — Bronsgroen-style layout with coop name, legal form, signatory, table with name+city, member number, shares, amount, registration date
- **Coop info fields** — legalForm, foundedDate, certificateSignatory, address, phone, email, website, VAT number, logo URL (admin settings)
- **Shareholder member number** — vennotennummer field on shareholder model
- **Per-registration certificate generation** — button in admin shareholder detail to generate certificate for individual transactions
- **FR/DE certificate translations** — certificate PDF template now supports all 4 languages

### Fixed
- **Tenant isolation** on new certificate endpoint — validates registrationId belongs to the coop

## [0.6.2] - 2026-03-10

### Added
- **Share purchase confirmation email** — automatically sends payment details (IBAN, BIC, OGM code, amount) to shareholders after registration when status is PENDING_PAYMENT
- **Resend payment email endpoint** — admins can resend the payment info email for any registration

## [0.6.1] - 2026-03-10

### Fixed
- **Personal data form not saving phone/IBAN correctly** — bank account (IBAN/BIC) fields were silently dropped when cleared due to falsy check; empty optional fields (phone, etc.) stored as empty strings instead of null

## [0.6.0] - 2026-03-10

### Added
- **Ecopower shareholder integration** — track which shareholders are Ecopower energy clients and enforce minimum shareholding requirements
  - Coop settings: enable/disable Ecopower integration, configure threshold type (euro or shares) and minimum value
  - Shareholder fields: Ecopower client flag and optional Ecopower ID
  - Exit guard: prevents Ecopower clients from selling shares below the configured minimum threshold (enforced on sales and transfers)
  - External API with API key authentication for batch querying shareholders and updating Ecopower client status (rate limited at 60 req/min per key)
  - API key management: generate/regenerate keys with bcrypt hashing (plaintext shown once, never stored)
  - Ecopower column and filter on shareholder list page
  - Full i18n support (EN, NL, FR, DE)

## [0.5.2] - 2026-03-10

### Fixed
- **Shareholdings not showing for COMPLETED registrations** — admin shareholder detail and shareholders list only filtered for ACTIVE status, missing COMPLETED registrations (affected Bronsgroen imports)
- **Raw status string in shareholdings table** — status column showed "COMPLETED" instead of translated "Voltooid"

## [0.5.0] - 2026-03-10

### Added
- **Platform terms & conditions** — coop admins must accept T&C during onboarding; acceptance is versioned and timestamped on the user record
- **Privacy policy acceptance** — shareholders must accept the OpenCoop privacy policy when registering via a public channel; versioned and stored on the registration record
- **Cooperative terms acceptance** — shareholders accept coop-specific terms (when a channel has a `termsUrl`); conditionally shown and stored on registration
- **Static legal pages** — `/terms` and `/privacy` pages with full i18n support (EN, NL, FR, DE)
- **Version-stamped legal consent** — `TERMS_VERSION` and `PRIVACY_VERSION` constants in shared package, set server-side (never from client)

### Fixed
- **E2E registration tests** — updated to handle conditional coop terms checkbox and new required privacy checkbox

## [0.4.0] - 2026-03-09

### Added
- **Messaging inbox** — bank-style messaging system for coop-shareholder communication
  - Coop admins can send broadcasts (all shareholders) or direct messages to individuals
  - Shareholders can start conversations and reply to messages
  - Document attachments — upload files or reference existing documents; uploads also appear in shareholder's Documents page
  - Email notifications via existing Bull queue for both shareholders and admins
  - Unread message badge in shareholder sidebar navigation
  - Full i18n support (EN, NL, FR, DE)
- **New permission** `canManageMessages` for admin role configuration

## [0.3.7] - 2026-03-09

### Fixed
- **Birthdate picker navigation** — birthdate fields now show year/month dropdowns for quick navigation (1920-present) instead of requiring month-by-month clicking
- **E2E registration test** — updated test to work with new calendar popover date picker

## [0.3.6] - 2026-03-09

### Fixed
- **Date picker locale** — replaced native `<input type="date">` (which uses OS locale) with a proper calendar popover that respects the user's app locale setting
- **Dividend period default date** — ex-dividend date now defaults to December 31 of the selected year when creating a new dividend period

## [0.3.5] - 2026-03-09

### Changed
- **Pricing page yearly display** — yearly plans now show monthly-equivalent price (€33/mo, €75/mo) with annual total in subtitle, matching common SaaS pricing patterns for better conversion

## [0.3.4] - 2026-03-09

### Fixed
- **Share sell button showing when holding period not met** — the `/auth/me` endpoint was missing `minimumHoldingPeriod` in the shareholder's coop data, causing the frontend to always show the sell button regardless of the configured holding period (e.g. 60 months for Bronsgroen)

## [0.3.3] - 2026-03-08

### Added
- **Admin audit logging** — comprehensive audit trail for all auth events (login, register, MFA, password reset) and admin CRUD actions (channels, share classes, projects, dividends, logo uploads)
- **IP + user-agent tracking** — all audit log entries now capture IP address and user-agent string for security investigations
- **Auth activity in system audit page** — system admins can filter audit logs by Auth entity to see all login attempts, including failed ones with the attempted email
- **New audit entity filters** — audit log page supports filtering by Auth, Channel, ShareClass, Project, and DividendPeriod entities

## [0.3.2] - 2026-03-08

### Added
- **ESLint CI integration** — `next lint` runs in CI pipeline to catch lint errors before deploy
- **E2E test expansion** — 10 new Playwright tests: public registration (individual, company, existing user), admin dashboard/settings/transactions/share-classes, shareholder transactions/settings
- **Public Playwright project** — new `public` project for unauthenticated E2E test scenarios
- **Demo coop seeding in CI** — E2E tests now seed demo coop data for channel-dependent tests

### Fixed
- **Flaky admin E2E tests** — tests now search shareholders by email instead of clicking by name (handles paginated data)
- **Duplicate test files** — removed stale `.js`/`.d.ts` compiled test files that caused double execution
- **Invalid ESLint disable comments** — removed `@typescript-eslint/no-explicit-any` disables in report preview files (rule not loaded)

## [0.3.1] - 2026-03-08

### Added
- **Umami analytics** — self-hosted privacy-friendly pageview analytics via analytics.armlab.com

## [0.3.0] - 2026-03-08

### Added
- **Ponto Connect integration** — automatic bank payment reconciliation via PSD2 Open Banking. Coop admins connect their bank account through OAuth, and incoming payments are automatically matched to registrations using OGM codes.
- **Webhook-driven transaction processing** — Ponto webhooks trigger Bull queue jobs that fetch new transactions and create payments for matching registrations.
- **Bank connection management** — admin settings page with connect/disconnect/reauthorize flow, auto-match toggle, and connection health status.
- **Unmatched payments tab** — transactions page shows unmatched bank payments with manual match dialog to link payments to registrations.
- **System admin Ponto controls** — system admins can enable/disable Ponto per coop.
- **Connection health monitoring** — daily cron checks for PSD2 90-day re-authorization expiry with warning emails 7 days before.
- **Encrypted token storage** — OAuth tokens stored with AES-256-GCM encryption at rest.

## [0.2.10] - 2026-03-08

### Fixed
- **Gift claim page validation** — fixed Zod schema blocking gift code validation by making step-2 fields optional (same fix as registration form)
- **Gift claim FK error** — claim endpoint was passing shareholder ID as user ID for `processedByUserId`, causing foreign key constraint violation
- **Registration form per-step validation** — made step-3 schema fields optional so `trigger()` works correctly per step

## [0.2.9] - 2026-03-08

### Added
- **Gift badge on buyer dashboard** — gift registrations show an amber badge with status (awaiting payment / awaiting claim / claimed by [name])
- **Gift certificate download** — buyers can download the gift certificate PDF from their shares page while the gift is unclaimed
- **Gift claim recipient info** — `/auth/me` now returns the claimed-by shareholder name for gift registrations

## [0.2.8] - 2026-03-08

### Added
- **Gift certificates** — buyers can purchase shares as a gift. When payment clears, a gift code (XXXX-XXXX) is generated, a PDF certificate with QR code is created, and emailed to the buyer. Recipients claim their shares at `/{coop}/{channel}/claim` by entering the code and their personal details. Shares transfer from buyer to recipient via a TRANSFER registration.
- **Gift claim page** — public page where recipients enter their gift code, see the gift details (share class, quantity, value), fill in shareholder information, and claim their shares.
- **Rate limiting on gift endpoints** — validation and claim endpoints are limited to 5 requests per IP per 15 minutes.

## [0.2.7] - 2026-03-08

### Changed
- **Registration flow redesign** — replaced dark colored header with a light/white header showing the coop logo. Registration now uses 4 steps for new users (Welcome → Details → Order → Payment) and 3 steps for logged-in users (skipping the welcome gate).

### Added
- **Welcome gate** — new users see "I'm new" and "I already have an account" cards as their first step. The login card embeds an inline email-first login so returning shareholders can authenticate without leaving the registration page.
- **Smart beneficiary filtering** — when a logged-in user registers someone else, "for myself" is hidden. Gift flow skips email collection for logged-in buyers.

### Fixed
- **Native date picker** — replaced custom date picker with native `<input type="date">` and enforced holding period in share sell UI

## [0.2.4] - 2026-03-07

### Fixed
- **Dashboard shows 0 shares** — overview now counts both ACTIVE and COMPLETED registrations
- **Status badges in English** — shares page now shows translated status (e.g., "Voltooid") instead of raw "COMPLETED"
- **"transactions.type" literal** — transaction column header now uses a dedicated translation key instead of resolving to an object
- **Email sender name** — magic link emails now show the coop name (e.g., "Bronsgroen") as sender instead of generic "OpenCoop"
- **Date picker range** — year dropdown now starts at 1920 instead of 2000, allowing selection of older birth dates

## [0.2.3] - 2026-03-07

### Fixed
- **Coop-branded magic link emails** — magic link email subject, heading, body and button text now show the coop name and use the coop's brand color instead of generic OpenCoop branding

## [0.2.2] - 2026-03-07

### Added
- **Auto-create user accounts for shareholders** — when an existing shareholder requests a magic link login but has no user account, one is automatically created and linked. Enables imported shareholders to self-service login.

## [0.2.1] - 2026-03-07

### Fixed
- **Coop login page centered** — coop-branded login page is now properly centered on screen instead of being stuck to the left
- **Coop root URL redirects to login** — `/{coopSlug}` now shows the login page instead of a combined login/register/share-classes landing page
- **Logged-in users redirected** — visiting coop login while already authenticated redirects to dashboard

## [0.2.0] - 2026-03-07

### Changed
- **Registration/Payment data model** — replaced Share + Transaction tables with a unified Registration + Payment model. Registrations are a ledger of BUY/SELL intents; Payments track actual bank activity. Data-preserving SQL migration converts all existing data in-place.

### Added
- **Daily chart filter** — admin dashboard charts now have a "Dagelijks" (Daily) period showing the last 90 days with daily granularity

### Fixed
- **SELL payment dates** — migration correctly uses payment creation date for SELL transactions instead of the original share purchase date
- **Timeline chart future dates** — timeline chart now includes future-dated payments instead of cutting off at the current month
- **COMPLETED status in shares page** — shares page and sell dialogs now correctly show COMPLETED registrations

## [0.1.78] - 2026-03-06

### Fixed
- **Capital timeline uses transaction log** — capital chart now correctly subtracts sold-back shares using the transaction log (PURCHASE adds, SALE subtracts) instead of only counting active shares
- **Shareholder growth tracks exits** — shareholder growth chart now shows exits (red bars below zero) for shareholders who sold all shares, with cumulative line adjusted accordingly
- **Dashboard charts fill gaps to current month** — charts now fill all intermediate empty months (no more jumping from Dec to Mar)
- **Reports use transaction log for historical capital** — annual overview and capital statement reports were showing flat capital because they filtered by current share status; now use transaction running balance for accurate history
- **Admin stats use purchase price** — dashboard KPI and system coop list now use `purchasePricePerShare` (actual invested amount) instead of current share class price

## [0.1.77] - 2026-03-06

### Fixed
- **Dashboard charts extend to current month** — capital timeline and shareholder growth charts no longer stop at the last month with activity; they now always include the current month

## [0.1.76] - 2026-03-06

### Added
- **Onboarding channels** — coops can now have multiple branded entry points for share registration (e.g., a partnership "Onze Energie" branding alongside the coop's own)
- **Channel management UI** — new Settings → Channels page to create, edit, and delete channels with custom logo, colors, name, description, and terms URL
- **Per-channel share class/project filtering** — each channel can show only a subset of share classes and projects
- **Acquisition tracking** — transactions and shareholders record which channel they came through
- **Backward-compatible URLs** — old `/{coopSlug}/register` URLs redirect to `/{coopSlug}/default/register`
- **Auto-linking** — new share classes and projects are automatically linked to the default channel

### Changed
- Coop branding (logo, colors, terms URL) migrated from the Coop model to the default Channel
- Public pages now use `/{coopSlug}/{channelSlug}/` URL structure

## [0.1.74] - 2026-03-06

### Added
- **Coop admin management** — admins can now invite, manage, and remove other coop admins
- **Granular permissions** — 4 default roles (Admin, Viewer, GDPR Viewer, GDPR Admin) with 10 configurable permission flags
- **Custom roles** — create custom named roles with individually toggled permissions per coop
- **Email-based admin invitations** — invite new admins via email with token-based acceptance flow
- **PII masking** — GDPR-restricted roles see masked names, emails, phone numbers, and addresses
- **Permission-gated navigation** — sidebar items hidden based on the admin's permissions
- **Report access control** — shareholder register hidden from roles without `canViewShareholderRegister`
- **Team management UI** — new Team page to manage admins, roles, and invitations
- **Role management UI** — create, edit, and delete custom roles with permission toggle grid

## [0.1.73] - 2026-04-06

### Fixed
- **PDF/CSV exports respect project filter** — exporting now includes only the selected projects, not all
- **Project type labels translated** — "SOLAR" and "WIND" now show as localized labels (e.g. "Zonne-energie", "Windenergie" in Dutch) in reports and PDFs

## [0.1.72] - 2026-04-06

### Added
- **Auto-load reports** — all reports load automatically when the tab is selected, no more "Generate" button
- **Multi-select project filter** — project investment report has a dropdown with checkboxes; typing auto-selects matching projects, manual toggle for individual projects

## [0.1.71] - 2026-04-06

### Added
- **Project investment filter** — search box to filter projects by name in the project investment report (e.g., filter by "lommel", "solar", "wind")

### Fixed
- **Coop logo broken image** — dashboard sidebar now correctly resolves logo URLs (was showing broken image for coops with uploaded logos like Bronsgroen)

## [0.1.70] - 2026-04-06

### Added
- **Coop logo in sidebar** — dashboard sidebar shows the coop's uploaded logo (or name) instead of "OpenCoop", for both admin and shareholder dashboards

## [0.1.69] - 2026-04-06

### Added
- **Bronsgroen data import** — migrated 751 shareholders, 992 shares, and 16 projects from CSV into production
- **Shared chart period filter** — all dashboard charts now sync when changing the time filter (monthly/quarterly/yearly/all)
- **Unassigned capital in reports** — shares without a project now show as "Niet toegewezen" in project investment reports

### Fixed
- Capital timeline and shareholder growth charts now start at the correct pre-period total instead of 0
- Pie chart (capital by project) legend moved below chart so it's fully visible with many projects
- Report donut chart layout: legend on the left, chart on the right for better readability
- Shareholdings section only shows active shares (sold/awaiting shares hidden, still visible in transaction history)
- Upgraded web app to Zod 4, fixing CI build failures since March 3rd

## [0.1.68] - 2026-03-05

### Added
- **Audit history** — all data changes are now logged to an append-only audit trail
  - Tracks changes to shareholders (profile, bank details, status), users (password, MFA, preferences), and coop settings (branding, email config, bank details)
  - Sensitive fields (passwords, MFA secrets, national IDs) are masked in the log
  - Shareholder detail page shows "Change History" section for coop admins
  - New system-wide audit log page at `/dashboard/system/audit` with entity filters and pagination
  - API endpoints: `GET /admin/coops/:coopId/audit-logs` (coop-scoped) and `GET /system/audit-logs` (global)
  - Translations in all 4 languages (EN/NL/FR/DE)

## [0.1.67] - 2026-03-02

### Added
- **CSV import for projects and share classes** — admins can now bulk-import projects and share classes from semicolon-delimited CSV files
- Import buttons on both admin pages (Projects and Share Classes) with uploaded/skipped count feedback
- Duplicate detection: skips projects with existing names and share classes with existing codes
- Translations for import UI in all 4 languages (EN/NL/FR/DE)

## [0.1.66] - 2026-03-02

### Added
- **Payment date tracking** — new `paymentDate` field on shares, set when bank import matches a payment or admin manually completes a transaction
- Dividend eligibility now calculated from `paymentDate` instead of `purchaseDate` (order date), ensuring only paid shares qualify
- Bank import passes the actual bank transaction date through as the payment date (both auto-match and manual match)
- Transferred shares get `paymentDate` set immediately (already paid)
- Frontend displays `paymentDate` (with `purchaseDate` fallback) in admin shareholder detail, shareholder shares page, and shareholders list "member since"

## [0.1.65] - 2026-03-01

### Fixed
- Docs sidebar no longer shows redundant section headers above each page link

## [0.1.64] - 2026-03-01

### Changed
- **Docs site theming** — aligned docs.opencoop.be color palette with the marketing site (primary blue, dark mode, brand colors)
- Added Building2 icon to docs nav title to match marketing site branding
- Fixed docs language switcher not showing available languages (EN/NL/FR/DE)

## [0.1.63] - 2026-03-01

### Added
- **Shareholder registration docs** — new documentation section covering the public share purchase flow (3-step registration, beneficiary types, gift certificates, OAuth prefill, URL parameters) in all 4 languages
- Updated README with docs app, current auth methods, and i18n languages

## [0.1.62] - 2026-03-01

### Added
- **Share buying flow** — members can purchase shares directly from their dashboard: select share class, choose quantity, and pay via EPC QR code bank transfer
- **AWAITING_PAYMENT status** — new transaction/share status for purchases waiting on bank payment
- Approval-aware flow: coops with `requiresApproval` route purchases through admin approval before payment; others go directly to awaiting payment
- Auto-complete on bank import: when a CSV import matches an OGM code, the transaction is automatically completed and shares activated
- New member API endpoints: `POST /shareholders/:id/purchase`, `GET /shareholders/:id/share-classes`, `GET /shareholders/:id/transactions`

## [0.1.61] - 2026-03-01

### Added
- **Documentation site** — new Fumadocs-based docs app (`apps/docs`) with i18n support (EN/NL/FR/DE), deployed at `docs.opencoop.be`
- Starter content: Welcome page, Getting Started guide, and Coop Administration guide in all 4 languages
- Full-text search across all documentation pages
- "Docs" link in marketing navbar and dashboard sidebar

## [0.1.60] - 2026-03-01

### Added
- **Passkeys (WebAuthn)** — passwordless login via biometrics or security keys
- **Google OAuth & Apple Sign In** — social login options on registration and login
- **MFA/TOTP** — two-factor authentication with authenticator apps
- **OAuth prefill** — registration form auto-fills name/email from OAuth profile
- **Auto-link orphan shareholders** — when a user registers with an email matching an existing shareholder, they are automatically linked

## [0.1.59] - 2026-02-28

### Added
- **Gift certificate flow** — selecting "As a gift" on registration now shows a simplified form (buyer email only) and generates a gift code + QR code on confirmation that the recipient can use to claim their shares
- **Gift claim page** — new public page at `/{coopSlug}/claim` where gift recipients enter their code and fill in their own details to claim shares
- **Beneficiary helper text** — family and company beneficiary types now show contextual guidance about whose details to enter
- **"Already a member?" link** — non-logged-in users on the registration page now see a link to the login page

## [0.1.58] - 2026-02-28

### Changed
- **Consolidated settings page** — merged shareholder links, branding (logo & colors), and general settings into a single settings page; removed separate branding nav item

## [0.1.57] - 2026-02-28

### Added
- **Shareholder links card** — admin dashboard overview now shows copyable URLs for the coop's public page, registration, and login, so admins can easily share them with shareholders

## [0.1.56] - 2026-02-28

### Changed
- **Streamlined registration flow** — compressed shareholder registration from 5 steps to 3 (Details → Order → Confirmation) for better conversion
- Step 1 now combines beneficiary type selection with the personal/company details form inline
- Step 2 merges share class selection, payment method, order summary, and terms acceptance

### Added
- **EPC QR code on confirmation** — the registration confirmation step now displays a scannable EPC QR code that banking apps can use to initiate a SEPA payment with the correct OGM reference pre-filled

## [0.1.55] - 2026-02-26

### Added
- **Free early access plan** — new "Early Access (Free)" tier on the pricing page, allowing cooperatives to sign up without payment
- **Email verification flow** — users must verify their email before accessing the dashboard; verification email sent on register and onboarding
- **Verify email page** — `/verify-email?token=...` validates the token and shows success or error
- **Dashboard verification gate** — unverified users see a "Check your email" card with resend button instead of dashboard content
- **Resend verification endpoint** — `POST /auth/resend-verification` (JWT-guarded, throttled 3/min)
- **Verification email templates** — multi-language (NL/EN/FR/DE) email with verify button

### Changed
- Onboarding accepts `plan=free`; billing period is now optional
- Free plan sets `coop.active = true` immediately (no admin review needed)
- Pricing page grid changed from 2 to 3 columns to accommodate the free tier
- Bottom CTA on pricing page links to free plan instead of essentials
- Legacy users (created before verification was required) are treated as verified

## [0.1.54] - 2026-02-26

### Added
- **SEO metadata** — localized page titles and descriptions for all marketing pages (NL/EN/FR/DE)
- **Open Graph & Twitter Cards** — social sharing meta tags on every public page
- **Hreflang alternates** — cross-language links in HTML head and sitemap for multi-language SEO
- **Canonical URLs** — proper `rel=canonical` on all marketing pages
- **robots.txt** — blocks `/dashboard/` and `/api/` from search engine crawlers
- **XML sitemap** — `/sitemap.xml` with all public pages and hreflang alternates
- **JSON-LD structured data** — `SoftwareApplication` schema on the landing page

### Changed
- Marketing pages split into server/client components to enable server-side metadata generation
- Root layout enhanced with title template (`%s | OpenCoop`), `metadataBase`, and default OG/Twitter config

## [0.1.53] - 2026-02-26

### Added
- **Personal Data page** — shareholders can view and edit their profile (name, company, address, bank details) from a dedicated page
- **PDF document downloads** — shareholders can download their certificates and statements directly from the documents page
- **Self-service certificate generation** — shareholders can generate share certificates themselves
- **Self-service dividend statement generation** — shareholders can generate dividend statements per payout period
- **Admin dividend statement endpoint** — admins can generate dividend statements for any shareholder

### Changed
- Bank details (IBAN/BIC) moved from Settings to the new Personal Data page
- Documents page now has a working download button and a "Generate Certificate" action
- Dividends page now has a "Generate Statement" action per payout row
- Navigation: added "Personal Data" item with UserCog icon before Settings

## [0.1.52] - 2026-02-26

### Fixed
- Demo coop routes (/demo/login, /demo/register, /demo/magic-link) returning 404 due to Next.js static/dynamic route conflict
- Extracted coop login, register, and magic-link page logic into shared components to avoid duplication

## [0.1.51] - 2026-02-25

### Fixed
- Reject transaction dialog now uses a proper styled modal instead of native browser prompt()
- Sell shares dialog now shows EPC QR code with payment details after confirming the sale

## [0.1.50] - 2026-02-25

### Fixed
- `shares.perUnit` i18n key was in wrong namespace (common instead of shares), causing literal key to display

## [0.1.49] - 2026-02-25

### Fixed
- Hardcoded "ea" (each) in sell shares dialog replaced with i18n translation (ea/stuk/pièce/Stück)

## [0.1.48] - 2026-02-25

### Fixed
- Dark mode on auth pages (login, register, forgot-password, reset-password, magic-link)
- Auth pages no longer show white background in dark mode

## [0.1.44] - 2026-02-25

### Fixed
- Password reset and magic link emails no longer require a coopId — works for all users regardless of coop membership or emailEnabled flag
- Password reset and magic link emails now respect user's preferred language (NL/EN/FR/DE)

### Changed
- Waitlist confirmation email consolidated through EmailService (removed raw nodemailer from auth service)

## [0.1.43] - 2026-02-25

### Fixed
- Password reset and magic link emails were silently skipped when user had no shareholder record or coop had emailEnabled=false

## [0.1.46] - 2026-02-25

### Added
- Helmet security headers on API and Next.js (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- Global rate limiting (100 req/min) with stricter limits on auth endpoints (3-5/min)
- Stronger password policy: min 8, max 128, requires uppercase + lowercase + digit
- SHA-256 hashing of password reset and email verification tokens stored in DB
- Email verification token expiry (24 hours)
- AES-256-GCM encryption for nationalId fields at rest (requires FIELD_ENCRYPTION_KEY env var)
- Input validation DTOs for profile update and user role update endpoints
- Migration script for encrypting existing nationalId data

### Fixed
- Password reset tokens now cleared when password is changed via settings
- Swagger API docs disabled in production (NODE_ENV=production)

## [0.1.45] - 2026-02-25

### Fixed
- Dividend date picker: added dropdown year/month navigation so users can quickly select dates in past years (e.g. 2024) instead of clicking arrows dozens of times
- Dividend date pickers now open to the correct month (ex-dividend → Dec of selected year, payment → Jan of next year)
- Dividend percentage input now accepts comma as decimal separator for NL/BE locale (e.g. `2,5` works alongside `2.5`)

## [0.1.41] - 2026-02-25

### Fixed
- Consolidated all email sending through EmailService (migration requests, feature requests, waitlist no longer bypass queue with raw nodemailer)
- Added 5 missing minor-related email templates used by the birthday scheduler (minor-turned-adult, parent notification, upgrade notification/reminder, email setup reminder)

### Changed
- Form notifications (migration requests, feature requests, waitlist signups) now sent to hello@opencoop.be

## [0.1.38] - 2026-02-25

### Added
- Stacked area chart showing capital growth by project in Annual Overview and Capital Statement PDF reports
- Interactive stacked area chart in on-screen report previews (Annual Overview + Capital Statement)
- Backend `computeCapitalTimelineByProject` helper generating monthly per-project capital timeline data

## [0.1.37] - 2026-02-25

### Added
- Migration service CTA section on homepage, linking to `/migration` page
- Full i18n support for migration CTA (EN, NL, FR, DE)

## [0.1.35] - 2026-02-25

### Added
- Migration service marketing page (`/migration`) with contact form for cooperatives switching to OpenCoop
- Migration request API endpoint (`POST /migration-requests`) with email notification
- Navigation link to migration page in marketing header (desktop + mobile)
- Full i18n support for migration page (EN, NL, FR, DE)

## [0.1.34] - 2026-02-25

### Added
- Charts in PDF reports: horizontal bar (capital comparison) and donut chart (share class breakdown) in annual overview PDF
- Project investment PDF report with donut chart showing capital distribution across projects
- Copy-to-clipboard for charts (PNG image) and tables (formatted HTML) for easy PowerPoint/Keynote use
- Chart action menu on report previews: copy as image, download PNG, download SVG
- Copy table button on all 5 report previews

## [0.1.33] - 2026-02-25

### Fixed
- Shareholder edit crash: updating shareholder info as admin caused client-side exception because the API returned incomplete data (missing shares, transactions)

## [0.1.28] - 2026-02-25

### Added
- Admin buy/sell on behalf of shareholders — coop admins can create purchase and sale transactions for shareholders
- Shareholder self-service sell — shareholders can request to sell shares back with bank account confirmation
- EPC QR codes for SEPA payments — purchase QR (shareholder pays coop) and refund QR (coop pays shareholder)
- Payment details dialog on admin transactions page with QR code and "Mark Complete" action
- Bank details (IBAN/BIC) on shareholder profile, editable by both admin and shareholder
- Minimum holding period setting per coop (prevents selling shares before the holding period expires)
- Double-sell prevention — checks pending sell quantities before allowing new sell requests

## [0.1.27] - 2026-02-25

### Fixed
- Shareholder counts in annual overview, shareholder growth chart, and shareholder register now use earliest share purchase date instead of DB record creation date
- Shareholder register join date reflects actual first share purchase, not account creation timestamp
- Admin shareholders list shows "Member since" (earliest share purchase) instead of DB record creation date

## [0.1.26] - 2026-02-25

### Added
- PDF export for reports (annual overview, shareholder register, capital statement)

## [0.1.25] - 2026-02-25

### Added
- Admin analytics dashboard with interactive charts (capital timeline, capital by project, shareholder growth, transaction activity)
- Reports page with 5 pre-built reports: annual overview, capital statement, shareholder register, dividend summary, project investment
- On-screen report preview with CSV export for all reports
- 3 PDF report templates (annual overview, shareholder register, capital statement)
- Period filter tabs (monthly/quarterly/yearly/all) on all chart components

## [0.1.24] - 2026-02-25

### Fixed
- Translation key references for transaction types and statuses on shareholder detail and transactions pages

## [0.1.23] - 2026-02-25

### Fixed
- Currency formatting now respects user locale across all pages — Dutch shows `€ 2.000,00` instead of `€ 2000.00`
- Date formatting respects user locale preference (was hardcoded to `nl-BE` in several admin pages)
- PDF templates (dividend statement, share certificate) now use `Intl.NumberFormat` for proper thousands separators

## [0.1.22] - 2026-02-25

### Added
- CHANGELOG.md covering all releases
- Release workflow conventions in project docs

## [0.1.21] - 2026-02-25

### Added
- Approve/reject actions on shareholder detail transaction history (admins no longer need to navigate to the transactions panel)

## [0.1.20] - 2026-02-25

### Added
- Attention badges with counters on admin sidebar nav items (pending shareholders, pending transactions, unmatched bank imports)

## [0.1.19] - 2026-02-25

### Fixed
- Pagination crash (500 Internal Server Error) on transactions and shareholders endpoints when query params are omitted (NestJS `enableImplicitConversion` converts missing params to `NaN`)

## [0.1.18] - 2026-02-24

### Added
- Language switcher and theme toggle to dashboard portal (shared components with marketing pages)

### Fixed
- Dark mode in coop portal using hardcoded colors instead of theme-aware CSS variables

## [0.1.17] - 2026-02-24

### Changed
- Hero demo button scrolls to demo section instead of navigating away

## [0.1.16] - 2026-02-24

### Changed
- Added GitHub button back to hero, demo button in the middle

## [0.1.15] - 2026-02-24

### Added
- Demo CTA section on homepage with hero button linking to it

## [0.1.14] - 2026-02-24

### Added
- Demo page with credentials for test-driving the platform

## [0.1.13] - 2026-02-23

### Improved
- User email in sidebar links to account settings

## [0.1.12] - 2026-02-23

### Changed
- Set `emailEnabled=false` for demo coop via migration

## [0.1.11] - 2026-02-23

### Added
- Per-coop email provider settings with disable toggle (allows SYSTEM_ADMIN to control email sending per tenant)

## [0.1.10] - 2026-02-23

### Changed
- Hide shareholder nav section for admin users (admins see only admin and system nav)

## [0.1.9] - 2026-02-23

### Added
- Responsive mobile hamburger menu to marketing nav

## [0.1.8] - 2026-02-23

### Changed
- Use Building2 icon as default logo on coop login page

## [0.1.7] - 2026-02-23

### Changed
- Revised pricing tiers from Starter/Growth to Essentials/Professional

## [0.1.6] - 2026-02-23

### Changed
- Replaced theme toggle button with animated slider switch

## [0.1.5] - 2026-02-23

### Added
- Dark mode support with system preference detection and manual toggle

## [0.1.4] - 2026-02-23

### Changed
- Default pricing page to monthly billing toggle

## [0.1.3] - 2026-02-23

### Fixed
- Production deploy race condition by building images on tag push

## [0.1.2] - 2026-02-23

### Added
- French and German locales with flag-based language switcher (NL, EN, FR, DE)
