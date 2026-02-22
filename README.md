# OpenCoop

Multi-tenant SaaS platform for managing cooperative shareholding. Enables cooperatives to manage shareholders, share classes, transactions, dividends, and document generation.

## Tech Stack

- **Monorepo**: pnpm workspaces + Turbo
- **Backend**: NestJS 10, Prisma 6, PostgreSQL 16
- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS
- **Auth**: JWT (Passport.js)
- **Queue**: Bull + Redis
- **i18n**: next-intl (NL/EN)

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker

# 1. Install dependencies
pnpm install

# 2. Start database and Redis
docker compose -f docker-compose.dev.yml up -d

# 3. Copy environment file
cp .env.example .env

# 4. Generate Prisma client and push schema
pnpm db:generate
pnpm db:push

# 5. Seed demo data (optional)
pnpm db:seed

# 6. Start dev servers
pnpm dev
```

The API runs on http://localhost:3001 (Swagger: http://localhost:3001/api/docs).
The web app runs on http://localhost:3002.

## Project Structure

```
opencoop/
├── apps/
│   ├── api/           # NestJS backend
│   └── web/           # Next.js frontend
├── packages/
│   ├── database/      # Prisma schema & client
│   ├── shared/        # Shared types & utils
│   └── pdf-templates/ # React PDF components
└── docker-compose.yml # Production stack
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Push schema to database |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:seed` | Seed demo data |

## Production

```bash
docker compose up -d
docker compose exec api npx prisma migrate deploy
```

## Demo Credentials

After running `pnpm db:seed`:
- **Email**: admin@opencoop.be
- **Password**: admin123
