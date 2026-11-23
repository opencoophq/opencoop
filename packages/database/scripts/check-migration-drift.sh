#!/usr/bin/env bash
# Fails when schema.prisma and prisma/migrations disagree.
#
# Applying prisma/migrations to an empty database must produce exactly
# schema.prisma: `prisma migrate diff` must find nothing to change. A schema
# change without a migration, or a migration that does not match the schema,
# fails the check.
#
# Usage:
#   SHADOW_DATABASE_URL=postgresql://user:pass@host:port/shadow_db \
#     bash packages/database/scripts/check-migration-drift.sh
#
# Prisma WIPES the shadow database on every run. Never point it at real data.
# The script creates the database if it does not exist.
set -euo pipefail

usage() {
  echo "usage: SHADOW_DATABASE_URL=postgresql://.../<shadow_db> $0" >&2
  exit 2
}

[ "$#" -eq 0 ] || usage

if [ -z "${SHADOW_DATABASE_URL:-}" ]; then
  echo "FAIL: SHADOW_DATABASE_URL is not set." >&2
  echo "Set it to a throwaway Postgres database; Prisma wipes it on every run." >&2
  usage
fi

db_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prisma="${db_dir}/node_modules/.bin/prisma"

if [ ! -x "$prisma" ]; then
  echo "FAIL: ${prisma} not found. Run pnpm install first." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Create the shadow database if it is missing. Connect to the "postgres"
# database on the same server. Query parameters are kept.
url_no_query="${SHADOW_DATABASE_URL%%\?*}"
query=""
if [ "$url_no_query" != "$SHADOW_DATABASE_URL" ]; then
  query="?${SHADOW_DATABASE_URL#*\?}"
fi
shadow_db="${url_no_query##*/}"
admin_url="${url_no_query%/*}/postgres${query}"
case "$shadow_db" in
  "" | *[!A-Za-z0-9_]*)
    echo "FAIL: shadow database name '${shadow_db}' must match [A-Za-z0-9_]+." >&2
    exit 1
    ;;
esac

cd "$db_dir"

if ! printf 'CREATE DATABASE "%s";\n' "$shadow_db" |
  "$prisma" db execute --url "$admin_url" --stdin >"${work}/create.out" 2>&1; then
  # P1009: the database already exists. Anything else is a real failure.
  if ! grep -q 'P1009' "${work}/create.out"; then
    echo "FAIL: could not create shadow database '${shadow_db}':" >&2
    cat "${work}/create.out" >&2
    exit 1
  fi
fi

# stdout holds only SQL; Prisma writes warnings to stderr.
# --exit-code: 0 = no difference, 2 = difference, anything else = error.
rc=0
"$prisma" migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --script --exit-code >"${work}/drift.sql" 2>"${work}/diff.err" || rc=$?

case "$rc" in
  0)
    echo "OK: prisma/migrations produce exactly schema.prisma."
    exit 0
    ;;
  2) ;;
  *)
    echo "FAIL: prisma migrate diff failed (exit ${rc}):" >&2
    cat "${work}/diff.err" >&2
    exit 1
    ;;
esac

echo "FAIL: prisma/migrations do not produce schema.prisma. SQL still missing:" >&2
cat "${work}/drift.sql" >&2
cat >&2 <<'MSG'

Add a migration for your schema change (pnpm db:migrate), or fix the
migration you added until this check finds nothing.
MSG
exit 1
