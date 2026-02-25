# Changelog

All notable changes to OpenCoop are documented in this file.

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
