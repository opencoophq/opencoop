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
