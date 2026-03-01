FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/docs/package.json apps/docs/
RUN pnpm install --frozen-lockfile

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/docs/node_modules ./apps/docs/node_modules
COPY . .
RUN pnpm --filter @opencoop/docs build

# Production
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/apps/docs/.next/standalone ./
COPY --from=build /app/apps/docs/.next/static ./apps/docs/.next/static
COPY --from=build /app/apps/docs/public ./apps/docs/public

EXPOSE 3000
CMD ["node", "apps/docs/server.js"]
