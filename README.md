# OpenCoop

Multi-tenant SaaS platform for managing cooperative shareholding. Enables cooperatives to manage shareholders, share classes, transactions, dividends, and document generation.

## Tech Stack

- **Monorepo**: pnpm workspaces + Turbo
- **Backend**: NestJS 10, Prisma 6, PostgreSQL 16
- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS
- **Auth**: JWT (Passport.js), Passkeys (WebAuthn), Google/Apple OAuth, MFA/TOTP
- **Queue**: Bull + Redis
- **i18n**: next-intl (EN/NL/FR/DE)
- **Docs**: Fumadocs (deployed at [docs.opencoop.be](https://docs.opencoop.be))

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

The API runs on http://localhost:3001 (Swagger: http://localhost:3001/docs, disabled when `NODE_ENV=production`).
The web app runs on http://localhost:3002.
The docs app runs on http://localhost:3003.

## Project Structure

```
opencoop/
├── apps/
│   ├── api/           # NestJS backend
│   ├── web/           # Next.js frontend
│   └── docs/          # Fumadocs documentation
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

Deploys are automated: GitHub Actions builds GHCR Docker images and ships them over SSH
to fsn1 (push to `main` → acc, tag `v*` → prod). A dedicated one-shot migrate container
runs `prisma migrate deploy` before the API starts, and Caddy handles the reverse proxy —
there is no manual migrate step.

## Demo Credentials

After running `pnpm db:seed`:
- **Email**: admin@opencoop.be
- **Password**: admin123
