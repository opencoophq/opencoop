# OpenCoop - Claude Code Configuration

## Project Overview

OpenCoop is a **multi-tenant SaaS platform** for managing cooperative shareholding. It enables cooperatives to manage shareholders, share classes, transactions, dividends, and document generation.

**Key domain concepts:**
- **Coop**: A cooperative organization (tenant) with its own branding, settings, and shareholders
- **Shareholder**: Member of a coop (INDIVIDUAL, COMPANY, or MINOR type)
- **Share**: Equity unit owned by shareholders, organized by ShareClass
- **Transaction**: Purchase, sale, or transfer of shares
- **OGM**: Belgian structured communication code for payment matching

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Monorepo** | pnpm workspaces + Turbo |
| **Backend** | NestJS 10, Prisma 6, PostgreSQL 16 |
| **Frontend** | Next.js 14 (App Router), React 18, Tailwind CSS |
| **Auth** | JWT (Passport.js), next-auth |
| **Queue** | Bull + Redis |
| **i18n** | next-intl (NL/EN) |
| **PDF** | @react-pdf/renderer |

## Project Structure

```
opencoop/
├── apps/
│   ├── api/                 # NestJS backend (port 3001)
│   │   └── src/modules/     # Feature modules (auth, coops, shareholders, etc.)
│   └── web/                 # Next.js frontend (port 3002)
│       └── src/app/[locale]/# i18n routes
├── packages/
│   ├── database/            # Prisma schema & client
│   ├── shared/              # Types, utils, i18n keys
│   └── pdf-templates/       # React PDF components
├── docker-compose.yml       # Production stack
└── turbo.json               # Build pipeline
```

## Essential Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm dev              # Start all dev servers
pnpm build            # Build all packages

# Database
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Push schema changes
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Prisma Studio

# Docker (dev)
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Architecture Patterns

### Backend (NestJS)

- **Module structure**: `modules/<feature>/` contains controller, service, DTOs, guards
- **Multi-tenancy**: `CoopGuard` ensures tenant isolation via `coopId` parameter
- **Auth flow**: JWT tokens, role-based access (SYSTEM_ADMIN, COOP_ADMIN, SHAREHOLDER)
- **Decorators**: `@CurrentUser()`, `@Roles()`, `@Public()`

```typescript
// Typical controller pattern
@Controller('admin/coops/:coopId/shareholders')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles(Role.COOP_ADMIN)
export class ShareholdersController {
  @Get()
  findAll(@Param('coopId') coopId: string) {}
}
```

### Frontend (Next.js)

- **Routing**: App Router with `[locale]` dynamic segment for i18n
- **Auth**: next-auth with JWT strategy
- **State**: React Query for server state, React Context for UI state
- **Components**: Radix UI primitives wrapped in `components/ui/`

```
app/[locale]/
├── [coopSlug]/        # Public coop pages
├── (auth)/            # Login, register
└── dashboard/         # Protected routes
```

### Database (Prisma)

- **Schema location**: `packages/database/prisma/schema.prisma`
- **27 models** with multi-tenant isolation via `coopId` foreign key
- **Key enums**: `Role`, `ShareholderType`, `TransactionStatus`, `PaymentStatus`

## Key Files Reference

| Purpose | Location |
|---------|----------|
| Prisma schema | `packages/database/prisma/schema.prisma` |
| API entry | `apps/api/src/main.ts` |
| API modules | `apps/api/src/modules/` |
| Auth guards | `apps/api/src/common/guards/` |
| Web routes | `apps/web/src/app/[locale]/` |
| UI components | `apps/web/src/components/ui/` |
| Translations | `apps/web/src/i18n/` |
| PDF templates | `packages/pdf-templates/src/templates/` |
| Shared types | `packages/shared/src/types.ts` |

## Environment Variables

Required in `.env`:
```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=<secret>
NEXTAUTH_SECRET=<secret>
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Optional:
```
LAUNCH_MODE=waitlist    # Set on prod to show waitlist dialog instead of onboarding links
```

## Feature Flags

### `LAUNCH_MODE` (server-side, runtime)
Controls whether the pricing page CTAs link to `/onboarding` or open a waitlist email collection dialog.

- **Not set / `live`**: CTAs link to `/onboarding` (full signup flow)
- **`waitlist`**: CTAs open a dialog that collects email + plan via `POST /auth/waitlist`

**Important**: This is a server-side env var (not `NEXT_PUBLIC_*`) because acc and prod share the same Docker image. The pricing page uses a server/client component split (`page.tsx` reads the env at runtime, passes it as a prop to `pricing-page.tsx`).

## API Documentation

Swagger UI available at: `http://localhost:3001/api/docs`

## Testing

```bash
cd apps/api
pnpm test             # Run tests
pnpm test:watch       # Watch mode
pnpm test:cov         # Coverage
```

Test files use `*.spec.ts` naming convention.

## Code Style

- **Prettier**: 2-space indent, single quotes, semicolons, 100 char width
- **Imports**: Use workspace aliases (`@opencoop/database`, `@opencoop/shared`)
- **Types**: Full TypeScript, avoid `any`

## Belgian-Specific Features

- **OGM codes**: Structured communication for payment matching (+++XXX/XXXX/XXXXX+++)
- **Withholding tax**: 30% on dividends (roerende voorheffing)
- **IBAN/BIC**: Belgian bank account validation
- **KBO/BCE**: Company registration number (ondernemingsnummer) stored in `companyId`

## Localization System

The app has two separate localization concepts:

1. **UI Language** (`preferredLanguage`): Controls which translation file is used (nl, en, fr, de)
2. **Formatting Locale** (`locale`): Controls date/number formatting (nl-BE, en-US, etc.)

### Key Files
- `apps/web/src/contexts/locale-context.tsx` - Locale provider with `useLocale()` hook
- `apps/web/src/app/[locale]/dashboard/settings/page.tsx` - User settings page

### Date Formatting
Use `toLocaleDateString()` with the user's locale from `useLocale()`:
```typescript
const { locale } = useLocale();
const formatted = new Date(dateString).toLocaleDateString(locale);
```

### Known Limitation
HTML5 `<input type="date">` ignores JavaScript locale settings and displays dates according to the browser's OS locale. To properly respect user locale preferences for date inputs, use a custom date picker component instead of native `<input type="date">`.

## Common Tasks

### Adding a new API endpoint
1. Add route in controller (`apps/api/src/modules/<feature>/<feature>.controller.ts`)
2. Implement logic in service (`<feature>.service.ts`)
3. Create DTOs for request/response validation
4. Add guards/decorators as needed

### Adding a new frontend page
1. Create route in `apps/web/src/app/[locale]/dashboard/<route>/page.tsx`
2. Add translations in `apps/web/src/i18n/messages/<locale>.json`
3. Use existing UI components from `components/ui/`

### Database schema changes
1. Edit `packages/database/prisma/schema.prisma`
2. Run `pnpm db:generate` to update client
3. Run `pnpm db:push` (dev) or create migration (prod)

## Deployment

Production uses Docker Compose with:
- PostgreSQL 16
- Redis 7
- NestJS API (multi-stage build)
- Next.js Web (standalone output)
- Nginx reverse proxy

```bash
docker-compose up -d
docker-compose exec api npx prisma migrate deploy
```

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
