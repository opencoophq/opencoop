FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/docs/package.json apps/docs/
COPY apps/docs/source.config.ts apps/docs/
COPY apps/docs/content apps/docs/content
RUN pnpm install --frozen-lockfile

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/docs/node_modules ./apps/docs/node_modules
COPY . .
RUN echo "=== CONTENT ===" && ls apps/docs/content/docs/ && echo "=== .SOURCE BEFORE ===" && cat apps/docs/.source/index.ts 2>/dev/null || echo "no .source yet" && pnpm --filter @opencoop/docs build && echo "=== .SOURCE AFTER ===" && head -5 apps/docs/.source/index.ts

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
