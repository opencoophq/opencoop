# AGM (Algemene Vergadering) & Voting Feature — Design Spec

**Date:** 2026-04-14
**Target delivery:** 2026-04-24 (convocation deadline for Bronsgroen AGM on 2026-05-09)
**Scope:** Approach B — full data model, physical-meeting UI
**Owner:** Wouter

---

## 1. Context & Motivation

OpenCoop currently has no support for Algemene Vergaderingen (annual general meetings) — a core governance workflow for Belgian cooperatives. Bronsgroen cv has its statutorily-mandated AGM on **Saturday 9 May 2026** at 10:00 at its seat (Theresiastraat 29, 3500 Hasselt), per Art. 22 of its bylaws.

Belgian coop law (WVV art. 6:70) requires convocation to be sent at least 15 days before the meeting, so the **real deadline is 2026-04-24** for the convocation blast.

This spec designs a feature that:
1. Ships end-to-end AGM administration for Bronsgroen's May 9 meeting (physical-only).
2. Uses a data model that supports future hybrid and fully-digital AGMs without migrations.
3. Enforces Bronsgroen's statuten rules (1-person-1-vote, max 1 proxy per delegate, etc.) while keeping them configurable per-coop.

### Out of scope (Phase 1)
- Digital voting for remote attendees (future Tier 3 work)
- Live-streamed AGMs
- eIDAS-compliant digitally-signed volmachten (future eIDAS feature)
- Written-decision AGMs (Art. 22bis — unanimous off-meeting decisions)
- Pre-meeting electronic vote-by-mail (Art. 22ter §2)

---

## 2. Legal Basis — Bronsgroen Statuten (18 Oct 2023)

Source: [Bronsgroen-cv_Statuten-20231018.pdf](https://bronsgroen.be/documents/Bronsgroen-cv_Statuten-20231018.pdf)

| Rule | Article | Applies to data model |
|------|---------|-----------------------|
| AGM on 2nd Saturday of May, 10:00, at seat | 22 | `Meeting.scheduledAt`, `Meeting.location` |
| Convocation ≥15 days before, via email | 22 | Soft warning in convocation service |
| Agenda docs ≥1 week before | 22 | Reminder in admin UI |
| One-person-one-vote (capital ignored) | 24 | `Meeting.votingWeight = PER_SHAREHOLDER` |
| Proxy to another shareholder only, max 1 held | 23 | `Proxy` model + service-layer validation |
| No quorum for ordinary AGM | 25 | `Resolution.quorumRequired` nullable |
| 3/4 majority for statuten changes, abstentions excluded | 25 | `MajorityType.THREE_QUARTERS` tally logic |
| Written AGM allowed (unanimous, non-notarial) | 22bis | Out of scope Phase 1 |
| Electronic AGM allowed per intern reglement | 22ter | Future Tier 3 — no blocker |
| Board members: ≥3, 3-year renewable mandate | 15 | Standard agenda items |

Full rules extracted to `~/.claude/projects/-Users-wouterhermans-Developer-opencoop/memory/bronsgroen-agm-rules.md`.

---

## 3. Data Model (Prisma)

### New models

```prisma
model Meeting {
  id                    String   @id @default(cuid())
  coopId                String
  coop                  Coop     @relation(fields: [coopId], references: [id])

  type                  MeetingType                 // ANNUAL, EXTRAORDINARY, WRITTEN
  title                 String
  scheduledAt           DateTime
  durationMinutes       Int       @default(120)    // default 2h
  location              String?
  format                MeetingFormat               // PHYSICAL, HYBRID, DIGITAL

  votingWeight          VotingWeight @default(PER_SHAREHOLDER)
  maxProxiesPerPerson   Int          @default(1)

  convocationSentAt     DateTime?
  convocationDocUrl     String?
  convocationFailures   Json?        // per-shareholder send errors
  reminderDaysBefore    Int[]        @default([3])
  remindersSent         Json?        @default("{}")

  status                MeetingStatus @default(DRAFT)

  agendaItems           AgendaItem[]
  attendances           MeetingAttendance[]
  proxies               Proxy[]
  minutes               MeetingMinutes?
  kioskSessions         MeetingKioskSession[]

  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([coopId, scheduledAt])
}

model AgendaItem {
  id              String      @id @default(cuid())
  meetingId       String
  meeting         Meeting     @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  order           Int
  title           String
  description     String?     @db.Text
  type            AgendaType  // INFORMATIONAL | RESOLUTION | ELECTION

  resolution      Resolution?
  attachments     AgendaAttachment[]

  @@unique([meetingId, order])
}

model AgendaAttachment {
  id            String     @id @default(cuid())
  agendaItemId  String
  agendaItem    AgendaItem @relation(fields: [agendaItemId], references: [id], onDelete: Cascade)
  fileName      String
  fileUrl       String
  uploadedAt    DateTime   @default(now())
}

model Resolution {
  id              String     @id @default(cuid())
  agendaItemId    String     @unique
  agendaItem      AgendaItem @relation(fields: [agendaItemId], references: [id], onDelete: Cascade)

  proposedText    String     @db.Text
  majorityType    MajorityType               // SIMPLE | TWO_THIRDS | THREE_QUARTERS
  quorumRequired  Decimal?                    // e.g. 0.5 for 50% capital represented

  votesFor        Int        @default(0)
  votesAgainst    Int        @default(0)
  votesAbstain    Int        @default(0)
  passed          Boolean?
  closedAt        DateTime?

  votes           Vote[]
}

model Vote {
  id              String     @id @default(cuid())
  resolutionId    String
  resolution      Resolution @relation(fields: [resolutionId], references: [id], onDelete: Cascade)
  shareholderId   String
  shareholder     Shareholder @relation(fields: [shareholderId], references: [id])

  choice          VoteChoice  // FOR | AGAINST | ABSTAIN
  castViaProxyId  String?
  weight          Int         @default(1)
  castAt          DateTime    @default(now())

  @@unique([resolutionId, shareholderId])
}

model Proxy {
  id                    String      @id @default(cuid())
  meetingId             String
  meeting               Meeting     @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  grantorShareholderId  String
  grantor               Shareholder @relation("ProxyGrantor", fields: [grantorShareholderId], references: [id])

  delegateShareholderId String
  delegate              Shareholder @relation("ProxyDelegate", fields: [delegateShareholderId], references: [id])

  signedFormUrl         String?
  grantedAt             DateTime    @default(now())
  revokedAt             DateTime?

  @@unique([meetingId, grantorShareholderId])
}

model MeetingAttendance {
  id                 String   @id @default(cuid())
  meetingId          String
  meeting            Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  shareholderId      String
  shareholder        Shareholder @relation(fields: [shareholderId], references: [id])

  rsvpStatus         RSVPStatus @default(UNKNOWN)
  rsvpAt             DateTime?
  rsvpToken          String     @unique
  rsvpTokenExpires   DateTime

  checkedInAt        DateTime?
  checkedInBy        String?    // userId (admin) OR 'kiosk:<sessionId>'
  checkInMethod      CheckInMethod?
  signatureImageUrl  String?

  @@unique([meetingId, shareholderId])
}

model MeetingMinutes {
  id              String   @id @default(cuid())
  meetingId       String   @unique
  meeting         Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  content         String   @db.Text
  generatedPdfUrl String?
  signedPdfUrl    String?
  signedAt        DateTime?
  signedByName    String?
}

model MeetingKioskSession {
  id         String   @id @default(cuid())
  meetingId  String
  meeting    Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  token      String   @unique
  startedBy  String
  startedAt  DateTime @default(now())
  endedAt    DateTime?
  active     Boolean  @default(true)

  @@index([meetingId, active])
}

// Enums
enum MeetingType     { ANNUAL EXTRAORDINARY WRITTEN }
enum MeetingFormat   { PHYSICAL HYBRID DIGITAL }
enum MeetingStatus   { DRAFT CONVOKED HELD CLOSED CANCELLED }
enum VotingWeight    { PER_SHAREHOLDER PER_SHARE }
enum AgendaType      { INFORMATIONAL RESOLUTION ELECTION }
enum MajorityType    { SIMPLE TWO_THIRDS THREE_QUARTERS }
enum VoteChoice      { FOR AGAINST ABSTAIN }
enum RSVPStatus      { ATTENDING PROXY ABSENT UNKNOWN }
enum CheckInMethod   { ADMIN KIOSK PAPER_RECONCILED }
```

### Additions to existing `Shareholder` model

```prisma
model Shareholder {
  // ... existing fields
  proxiesGranted      Proxy[]            @relation("ProxyGrantor")
  proxiesHeld         Proxy[]            @relation("ProxyDelegate")
  meetingAttendances  MeetingAttendance[]
  votes               Vote[]
}
```

### Migration notes
- 9 new tables, 0 altered existing tables (only new relations added to `Shareholder`).
- Single Prisma migration, additive only → safe rollback.
- No backfill needed — existing coops have no meetings yet.

---

## 4. Backend (NestJS)

New module at `apps/api/src/modules/meetings/`.

### File layout

```
apps/api/src/modules/meetings/
├── meetings.module.ts
├── meetings.controller.ts
├── meeting-rsvp.controller.ts         # PUBLIC (token-auth)
├── meeting-kiosk.controller.ts        # PUBLIC (token-auth)
├── shareholder-meetings.controller.ts # shareholder-scope read
├── meetings.service.ts
├── proxies.service.ts
├── votes.service.ts
├── convocation.service.ts
├── minutes.service.ts
├── ics.service.ts
├── reminder.job.ts                    # Bull queue job
└── dto/
    ├── create-meeting.dto.ts
    ├── update-meeting.dto.ts
    ├── create-agenda-item.dto.ts
    ├── create-proxy.dto.ts
    ├── record-vote.dto.ts
    ├── check-in.dto.ts
    ├── rsvp-update.dto.ts
    └── kiosk-search.dto.ts
```

### Admin controller surface

```
Base: /admin/coops/:coopId/meetings  [JwtAuth + CoopGuard + Roles(COOP_ADMIN)]

Meeting CRUD:
  POST   /                                        createMeeting
  GET    /                                        listMeetings
  GET    /:id                                     getMeeting
  PATCH  /:id                                     updateMeeting
  DELETE /:id                                     deleteMeeting (DRAFT only)
  POST   /:id/cancel                              cancelMeeting

Agenda:
  POST   /:id/agenda-items                        addAgendaItem
  PATCH  /:id/agenda-items/:itemId                updateAgendaItem
  DELETE /:id/agenda-items/:itemId                removeAgendaItem
  POST   /:id/agenda-items/:itemId/attachments    uploadAttachment

Convocation:
  POST   /:id/convocation/preview                 previewConvocationPdf
  POST   /:id/convocation/send                    sendConvocation
  POST   /:id/convocation/reminder                sendReminderNow
  GET    /:id/convocation/status                  listDeliveryStatus

Proxies:
  POST   /:id/proxies                             createProxy (admin)
  GET    /:id/proxies                             listProxies
  DELETE /:id/proxies/:proxyId                    revokeProxy

Attendance / day-of:
  GET    /:id/attendance-sheet                    downloadAttendanceSheetPdf
  POST   /:id/attendance/:shareholderId/check-in  checkInShareholder
  POST   /:id/attendance/:shareholderId/undo      undoCheckIn
  GET    /:id/live-attendance                     currentAttendanceState
  POST   /:id/kiosk/start                         startKioskSession
  POST   /:id/kiosk/:sessionId/end                endKioskSession

Voting:
  POST   /:id/resolutions/:resId/votes            recordVotes (bulk)
  POST   /:id/resolutions/:resId/close            closeResolution

Minutes:
  POST   /:id/minutes/generate                    generateMinutesDraft
  PATCH  /:id/minutes                             editMinutes
  POST   /:id/minutes/finalize                    finalizeAndGeneratePdf
  POST   /:id/minutes/upload-signed               uploadSignedMinutes
```

### Public controller surface (token-auth, no JWT)

```
RSVP:
  GET    /public/meetings/rsvp/:token                     getRsvpDetails
  PATCH  /public/meetings/rsvp/:token                     updateRsvp
  GET    /public/meetings/rsvp/:token/ics                 downloadIcs
  GET    /public/meetings/rsvp/:token/eligible-delegates  listDelegates
  POST   /public/meetings/rsvp/:token/proxy/upload        uploadSignedVolmacht

Kiosk:
  GET    /public/meetings/kiosk/:kioskToken               validateKiosk
  POST   /public/meetings/kiosk/:kioskToken/search        searchShareholder
  POST   /public/meetings/kiosk/:kioskToken/check-in      selfCheckIn
```

### Shareholder controller surface

```
Base: /meetings  [JwtAuth]

  GET /upcoming              listUpcomingMeetings
  GET /:id                   getMeetingForShareholder
  GET /:id/proxy-form        downloadProxyForm
```

### Service-layer business rules

**`ProxiesService.createProxy(meetingId, grantorId, delegateId)`**
- Grantor and delegate must both be active shareholders of the meeting's coop.
- Grantor ≠ delegate.
- Count active (non-revoked) proxies where `delegateShareholderId = delegateId` for this meeting — must be `< meeting.maxProxiesPerPerson`.
- Create proxy; generate pre-filled volmacht PDF; store URL.

**`VotesService.recordVotes(resolutionId, votes[])`**
- Admin-provided array: `[{ shareholderId, choice, weight? }]`.
- For each: resolve weight (1 if `votingWeight = PER_SHAREHOLDER`, else current share count).
- Check for active proxy on grantor — if present, attach `castViaProxyId`.
- Upsert `Vote` (unique on `(resolutionId, shareholderId)`).
- In same transaction: recompute `Resolution.votesFor/Against/Abstain` from vote rows.

**`VotesService.closeResolution(resolutionId)`**
- Load resolution + votes.
- If `quorumRequired` set: verify attendance + proxies represent ≥ threshold of capital; reject if not.
- Compute `passed` by `majorityType`:
  - `SIMPLE`: `votesFor > votesAgainst` (strict; tie → rejected)
  - `TWO_THIRDS`: `votesFor * 3 >= (votesFor + votesAgainst) * 2`
  - `THREE_QUARTERS`: `votesFor * 4 >= (votesFor + votesAgainst) * 3` (Art. 25 excludes abstentions from both sides)
- Set `closedAt`.

**`ConvocationService.sendConvocation(meetingId, opts)`**
- Validate: `meeting.scheduledAt - now >= 15 days`. If not, require `opts.confirmShortNotice = true`.
- For each shareholder in the coop:
  - Upsert `MeetingAttendance` with `rsvpToken` (cuid2) + `rsvpTokenExpires = meeting.scheduledAt`.
  - Render personalized convocation PDF.
  - Send email (convocation.hbs template) via existing email module; include RSVP link + convocation PDF + blank volmacht PDF.
- Collect failures into `Meeting.convocationFailures`.
- Set `Meeting.status = CONVOKED`, `convocationSentAt = now`.

**`ReminderJob` (Bull)**
- Runs daily 09:00 CET.
- For each `CONVOKED` meeting: compute `daysUntil`. For each day in `reminderDaysBefore` matching `daysUntil`, send reminder email to all `UNKNOWN` respondents. Record in `remindersSent`.
- Idempotent via `remindersSent` JSON.

### Multi-tenancy & authorization
- All admin endpoints scoped by `:coopId` via existing `CoopGuard`.
- Public endpoints (RSVP, kiosk) validate token → derive scope from token → no cross-coop leakage.
- Every state transition + vote + proxy action logged via existing `audit` module.

---

## 5. PDF Templates

Four new templates in `packages/pdf-templates/src/templates/`, following the existing `@react-pdf/renderer` + coop-branding pattern.

### 1. `convocation.tsx`
Per-shareholder personalized oproepingsbrief.
- Coop branding (logo, name, address, ondernemingsnummer)
- Shareholder name + address
- Meeting type, date, time, location
- Full agenda (numbered list with descriptions)
- Notice of rights: vote, delegate (Art. 23), pre-submit questions (Art. 22ter)
- Reference to attachments (sent separately ≤1 week before)
- Board signatory

### 2. `volmacht-form.tsx`
Pre-filled proxy form.
- Coop header
- Pre-filled grantor fields
- Blank delegate field
- Legal text quoting Art. 23
- Signature block (place, date, signature)
- Return instructions (email upload endpoint)

### 3. `attendance-sheet.tsx`
Filtered by RSVP. Only includes shareholders with `rsvpStatus = ATTENDING` or `rsvpStatus = PROXY` (whose delegate is attending).
- Coop header + meeting title/date
- Main table: `# | Shareholder | Shareholder # | Attending via | Signature`
- 20 blank rows for walk-ins
- Chairman signature line
- Footer: quorum note (or "Geen quorum vereist")

### 4. `meeting-minutes.tsx`
Generated from meeting data post-meeting.
- Coop header
- Date/time/location/bureau
- Attendance summary (X present, Y via proxy)
- Per agenda item: title, discussion summary (editable), resolution text + vote counts + outcome
- Chair + secretary signature lines
- Appendix: attendee list + proxy list

### i18n
PDFs consume new `meetings` namespace in `apps/web/messages/{en,nl,fr,de}.json`. Language determined by `Coop.preferredLanguage`.

---

## 6. Frontend — Admin Dashboard

New route tree at `apps/web/src/app/[locale]/dashboard/admin/meetings/`.

### Page tree
```
meetings/
├── page.tsx                            # List + filters
├── new/page.tsx                        # Create wizard
└── [meetingId]/
    ├── page.tsx                        # Overview + next-action checklist
    ├── agenda/page.tsx                 # Agenda builder (drag-reorder)
    ├── convocation/page.tsx            # Preview + send + reminders config
    ├── rsvp/page.tsx                   # RSVP tracker + manual override
    ├── proxies/page.tsx                # Proxy assignment + validation
    ├── check-in/page.tsx               # ⭐ Day-of live check-in
    ├── voting/page.tsx                 # Paper-ballot entry per resolution
    └── minutes/page.tsx                # Edit + finalize + upload signed
```

### Key screen — Live Check-in
Tablet- and laptop-friendly. Search + tap-to-check-in UI with live totals (RSVP'd count, checked-in count, via-proxy count, quorum indicator). Auto-refreshes via React Query polling (5s). Includes "Start kiosk session" button that generates a per-session kioskToken + QR code for the self-service tablet.

### Reminder configuration
Checkbox array `[7, 3, 1]` days-before; "Send reminder now" button for ad-hoc sends; history of sent reminders.

---

## 7. Frontend — Public & Shareholder Pages

### Public RSVP flow (no login)
- `apps/web/src/app/[locale]/meetings/rsvp/[token]/page.tsx` — RSVP landing page with 3 CTAs (attending / absent / delegate).
- `apps/web/src/app/[locale]/meetings/rsvp/[token]/thanks/page.tsx` — confirmation + `.ics` download + volmacht PDF link.

### Kiosk (no login, token-scoped)
- `apps/web/src/app/[locale]/meetings/kiosk/[kioskToken]/page.tsx` — 4 states: search → confirm → signature capture → welcome.
- Signature via `react-signature-canvas`, stored as PNG in uploads module.
- Auto-resets to search 3s after check-in.

### Shareholder dashboard
- `apps/web/src/app/[locale]/dashboard/meetings/page.tsx` — list of upcoming meetings.
- `apps/web/src/app/[locale]/dashboard/meetings/[id]/page.tsx` — detail + download proxy form.

No vote-casting UI for shareholders in Phase 1.

---

## 8. Email Flows

Three new templates under existing `email` module:

1. **convocation.hbs** — PDF attachments (convocation + blank volmacht) + "RSVP hier" button linking to magic URL.
2. **rsvp-confirmation.hbs** — summary + `.ics` attachment + volmacht link (if delegate chosen) + "change RSVP" link.
3. **reminder.hbs** — sent to `UNKNOWN` respondents at configured `reminderDaysBefore` offsets.

`.ics` generation via `ics` npm package. Event: title = meeting title, start = scheduledAt, duration = 2h (configurable), location, description = agenda summary, organizer = coop contact email.

---

## 9. Error Handling & Edge Cases

| Scenario | Handling |
|----------|----------|
| Email send fails for a shareholder | Collect into `Meeting.convocationFailures`, admin UI shows retry button |
| RSVP token expired | Friendly "link expired" page, not 404 |
| Proxy delegate limit exceeded | Reject with `DelegateProxyLimitExceeded`, UI explains |
| Self-delegation attempt | Client filter + server validation |
| Concurrent check-in (2 admins) | Unique `(meetingId, shareholderId)` makes 2nd insert idempotent |
| Tie vote on simple majority | Per WVV default → rejected (strict majority, not plurality) |
| Closing resolution with 0 votes | Confirmation modal before close |
| Admin edits agenda after convocation | Warning: "may require re-convocation" (non-blocking) |
| Convocation < 15 days before | Warning banner, requires explicit `confirmShortNotice: true` |
| Meeting state transitions | `DRAFT → CONVOKED → HELD → CLOSED` or `→ CANCELLED` (soft-delete after CONVOKED) |

All RSVP + vote + state-transition events logged via existing `audit` module with IP + user-agent where applicable.

Rate limits on public endpoints: 10 req/min per IP (reuse existing rate-limit guard).

---

## 10. Testing

### Must-have unit tests
1. `ProxiesService.createProxy` — Art. 23 rule enforcement (self-delegation, max-1-per-delegate, cross-coop rejection).
2. `VotesService.closeResolution` — majority math for `SIMPLE` / `TWO_THIRDS` / `THREE_QUARTERS` including abstention handling.
3. `VotesService.recordVotes` — proxy vote attribution logic.
4. `ConvocationService` — 15-day notice warning, idempotency on re-send.
5. `IcsService.generateIcs` — output parses as valid iCalendar.

### Integration tests
6. Full happy-path meeting lifecycle via admin controller.
7. RSVP token lifecycle (create → use → update → expire).

### Out of scope for Phase 1
- Playwright E2E on admin UI (manual QA instead).
- PDF visual regression.
- Kiosk mode automation (manual QA on iPad).

### Manual QA checklist (pre-prod, on acc environment)
1. Create test meeting with 5 test shareholders.
2. Full dry-run: convocation → RSVPs → kiosk check-in → voting → minutes.
3. Visually inspect all 4 PDFs.
4. Test email: verify attachments, verify RSVP link works across devices.
5. Test RSVP link on mobile (responsive check).
6. Run kiosk on actual iPad; verify signature capture quality.

---

## 11. Deployment Plan

1. Ship feature branch via PR to `main` → auto-deploys to `acc.opencoop.be`.
2. Manual QA on acc (2-3 days).
3. Tag for prod: `v0.7.64` (or next sequential). Update `CHANGELOG.md`.
4. After prod deploy: admin creates the May 9 meeting in production, sends convocation by April 24.
5. Monitor Sentry + audit logs during the first reminder/RSVP wave.

### Rollback
- Additive schema → safe to revert frontend while leaving tables.
- If critical bug found day-of: meeting data persists; fall back to paper (attendance sheet already printed, signed volmachten already on paper).

---

## 12. Summary

| Artifact | Count |
|----------|-------|
| New Prisma models | 9 |
| Altered existing tables | 0 (only relation adds) |
| Backend controllers | 5 |
| Backend services | 6 |
| DTOs | 8 |
| PDF templates | 4 |
| Admin dashboard pages | 8 |
| Public pages | 3 (RSVP, thanks, kiosk) |
| Shareholder dashboard pages | 2 |
| Email templates | 3 |
| Unit tests | 5 |
| Integration tests | 2 |
| Target delivery | 2 days |

**Convocation must be sent by 2026-04-24** — 10 days from spec date.
