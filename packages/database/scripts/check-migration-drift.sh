#!/usr/bin/env bash
# Fails when schema.prisma and prisma/migrations disagree in a new way.
#
# The SQL that turns prisma/migrations into schema.prisma must match
# prisma/migration-drift.baseline.sql byte for byte. The baseline holds the
# drift that already exists; it may only shrink. A schema change without a
# migration adds SQL to the diff, so the check fails.
#
# Usage:
#   SHADOW_DATABASE_URL=postgresql://user:pass@host:port/shadow_db \
#     bash packages/database/scripts/check-migration-drift.sh [--update]
#
# Prisma WIPES the shadow database on every run. Never point it at real data.
# The script creates the database if it does not exist.
# --update rewrites the baseline from the current tree.
set -euo pipefail

usage() {
  echo "usage: SHADOW_DATABASE_URL=postgresql://.../<shadow_db> $0 [--update]" >&2
  exit 2
}

update=0
case "${1:-}" in
  "") ;;
  --update) update=1 ;;
  *) usage ;;
esac
[ "$#" -le 1 ] || usage

if [ -z "${SHADOW_DATABASE_URL:-}" ]; then
  echo "FAIL: SHADOW_DATABASE_URL is not set." >&2
  echo "Set it to a throwaway Postgres database; Prisma wipes it on every run." >&2
  usage
fi

db_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prisma="${db_dir}/node_modules/.bin/prisma"
baseline="${db_dir}/prisma/migration-drift.baseline.sql"
header_lines=3

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
if ! "$prisma" migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --script >"${work}/actual.sql" 2>"${work}/diff.err"; then
  echo "FAIL: prisma migrate diff failed:" >&2
  cat "${work}/diff.err" >&2
  exit 1
fi

regen_cmd="SHADOW_DATABASE_URL=<shadow url> bash packages/database/scripts/check-migration-drift.sh --update"

if [ "$update" -eq 1 ]; then
  {
    echo "-- Known drift between prisma/migrations and schema.prisma as of $(date -u +%Y-%m-%d)."
    echo "-- CI fails when this changes. It may only shrink; never add to it."
    echo "-- Regenerate: ${regen_cmd}"
    cat "${work}/actual.sql"
  } >"$baseline"
  echo "Wrote ${baseline}"
  exit 0
fi

if [ ! -f "$baseline" ]; then
  echo "FAIL: ${baseline} is missing. Create it with: ${regen_cmd}" >&2
  exit 1
fi

tail -n "+$((header_lines + 1))" "$baseline" >"${work}/expected.sql"

if cmp -s "${work}/expected.sql" "${work}/actual.sql"; then
  echo "OK: migration drift matches the baseline."
  exit 0
fi

echo "FAIL: migration drift differs from the baseline (- baseline, + now):" >&2
diff -u --label baseline --label current "${work}/expected.sql" "${work}/actual.sql" >&2 || true
cat >&2 <<EOF

schema.prisma and prisma/migrations disagree in a new way.
Add a migration for your schema change (pnpm db:migrate).
If you deliberately fixed existing drift, regenerate the baseline with:
  ${regen_cmd}
EOF
exit 1
