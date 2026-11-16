# OpenCoop Migration One-Pager (Federation Brief)

*For Rescoop Vlaanderen / Rescoop Wallonie and member cooperatives*

---

## Goal

Help a cooperative move from spreadsheets or legacy tooling to OpenCoop with low risk, full data continuity, and clear accountability.

## What gets migrated

- Shareholder profiles (individuals, companies, minors)
- Share register history (subscriptions, transfers, exits)
- Project and share-class structure
- Dividend history and tax-relevant fields
- Core documents and communication metadata (where available)

## Migration principles

- **No black box**: migration mapping is documented and shared before import.
- **Validation first**: totals and record counts are checked before go-live.
- **Cooperative-safe cutover**: old files remain available during verification.
- **No lock-in**: OpenCoop is AGPL-3.0 and export-friendly.

## 4-step process

### 1) Discovery (Week 1)
- Source inventory (Excel files, exports, document folders)
- Field mapping workshop (OpenCoop fields vs. legacy fields)
- Risk scan (duplicates, missing IBAN, household emails, legacy edge cases)

### 2) Pilot import (Week 2)
- Import into a staging environment
- Run quality checks:
  - shareholder count
  - total shares per class
  - historical transaction totals
  - dividend totals (gross/tax/net)
- Share a discrepancy report and resolve exceptions

### 3) Final migration + cutover (Week 3)
- Freeze legacy updates for agreed cutover window
- Execute final import
- Board sign-off checklist:
  - totals match
  - random sampling completed
  - portal access confirmed
  - key documents visible

### 4) Hypercare (Weeks 4-6)
- Weekly check-ins with board members
- Priority support for data questions
- Minor configuration and communication template tuning

## Roles and responsibilities

| Party | Responsibility |
|------|----------------|
| Cooperative board | Provides source files, confirms data rules, signs off validation |
| OpenCoop team | Mapping, import scripts, quality checks, go-live support |
| Federation (optional) | Coordinates pilot cohort and shares lessons between coops |

## Typical timeline

- **Small coop (up to 500 shareholders):** 2-3 weeks
- **Mid-size coop (500-2,000 shareholders):** 3-5 weeks
- **Complex history / multiple legacy sources:** 5+ weeks

## Success criteria

- 100% shareholder records transferred
- Share totals match legacy source at cutover
- Dividend history validated for agreed years
- Board can operate daily workflows without spreadsheets
- Members can self-serve via portal (transactions, dividends, documents)

## Common concerns (and controls)

- **"What if data is inconsistent?"**  
  We flag anomalies in staging and resolve them before production import.
- **"What if we need to roll back?"**  
  Legacy files remain untouched; cutover only after board sign-off.
- **"What about privacy and control?"**  
  Belgian cooperative-specific data handling, role-based access, and open-source transparency.

## Next step

Nominate one pilot cooperative and schedule a 60-minute migration discovery call.
