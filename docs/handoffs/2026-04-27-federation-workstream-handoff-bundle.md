# Federation Workstream Design Handoff Bundle

Date: 2026-04-27  
Issue: OPE-67  
Owner: Head of Design

## Scope

This handoff package consolidates reviewer-facing outputs from `OPE-62`, `OPE-63`, `OPE-64`, `OPE-65`, and `OPE-66` for federation readiness.

## Bundle Index

### OPE-62 — Federation trust assets

- `docs/case-studies/bronsgroen-en.md`
- `docs/case-studies/bronsgroen-nl.md`
- `docs/case-studies/bronsgroen-fr.md`
- `docs/pitch-deck/federation-pitch-en.md`
- `docs/pitch-deck/federation-pitch-nl.md`
- `docs/pitch-deck/federation-pitch-fr.md`
- `docs/migrations/federation-migration-one-pager-en.md`
- `docs/migrations/federation-migration-one-pager-nl.md`
- `docs/migrations/federation-migration-one-pager-fr.md`

Design intent:
- Build federation trust with proof-based narrative (Bronsgroen), multilingual pitch framing, and low-risk migration framing.

### OPE-66 — NL/FR copy blocks (v2)

Primary packaged files:
- `docs/case-studies/bronsgroen-nl.md`
- `docs/case-studies/bronsgroen-fr.md`
- `docs/pitch-deck/federation-pitch-nl.md`
- `docs/pitch-deck/federation-pitch-fr.md`
- `docs/migrations/federation-migration-one-pager-nl.md`
- `docs/migrations/federation-migration-one-pager-fr.md`

Design intent:
- Ensure federation-facing trust assets have robust Dutch/French copy with localized persuasion structure.

### OPE-63 — Conversion-critical product UX pack

Reference docs:
- `docs/plans/2026-03-08-registration-flow-ux-redesign.md`
- `docs/plans/2026-03-01-share-buying-flow-redesign.md`
- `docs/plans/2026-03-06-onboarding-channels-design.md`

Design intent:
- Reduce onboarding conversion loss through clearer registration flows, explicit payment-state UX (`AWAITING_PAYMENT`), and channel information architecture.

### OPE-64 — Admin confidence patterns

Reference docs:
- `docs/plans/2026-03-04-audit-history-design.md`
- `docs/plans/2026-03-06-coop-admin-management-design.md`
- `docs/plans/2026-03-08-admin-audit-logging-design.md`

Design intent:
- Increase admin trust and governance confidence through auditability, permission clarity, and activity visibility patterns.

### OPE-65 — Migration-at-scale toolkit UX

Reference docs:
- `docs/migrations/federation-migration-one-pager-en.md`
- `docs/migrations/federation-migration-one-pager-nl.md`
- `docs/migrations/federation-migration-one-pager-fr.md`

Design intent:
- Standardize migration onboarding checklists and validation controls to reduce rollout risk for federated cooperative cohorts.

Current gap flag:
- No dedicated UI specification exists yet for import progress/error states and post-migration validation dashboard flows.

## Cross-Issue Dependency Map

- `OPE-62/66` copy quality and trust evidence are prerequisites for federation outreach.
- `OPE-63` onboarding/payment UX quality directly affects activation outcomes for pilot cooperatives introduced via federation channels.
- `OPE-64` admin confidence patterns are prerequisites for board-level buy-in and compliance sign-off.
- `OPE-65` migration toolkit depth determines ability to scale from single-pilot to cohort rollout.

## Decision Checkpoints

1. Messaging readiness
- Decision: approve federation narrative stack (case study + pitch + migration one-pager) across EN/NL/FR.
- Gate: all three artifact families reviewed for factual consistency and locale correctness.

2. Pilot activation readiness
- Decision: confirm whether `OPE-63` references are sufficient for first pilot onboarding or require narrowed pilot UX brief.
- Gate: explicit reviewer sign-off on registration and payment-state UX paths.

3. Governance confidence readiness
- Decision: confirm `OPE-64` patterns cover minimum required trust controls for federation recommendations.
- Gate: reviewer agreement on audit visibility and permissions comprehension for coop admins.

4. Scale-readiness depth
- Decision: either accept current `OPE-65` migration guidance as phase-1 sufficient, or require a follow-up UI spec for import states/dashboard.
- Gate: go/no-go call on dedicated migration operations UI deliverable.

## Reviewer Handoff Notes

- This package is structured for decision efficiency, not only document completeness.
- Reviewers should prioritize unresolved risk: migration-at-scale operational UI depth (import errors/progress/dashboard).
- If this risk is accepted for phase 1, federation pilot outreach can proceed with current assets.

## Recommended Next Actions

1. Approve and lock `OPE-62/66` trust assets as the federation outreach baseline.
2. Mark `OPE-63/64` references as accepted architectural inputs for pilot onboarding/admin confidence.
3. Decide whether to spawn a focused follow-up for `OPE-65` UI depth (import state machine + validation dashboard screen spec).
