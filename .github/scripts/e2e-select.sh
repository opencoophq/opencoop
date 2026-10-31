#!/usr/bin/env bash
# Picks the Playwright specs a PR runs. Reads changed paths on stdin, one per
# line. For a rename, list both the old and the new path.
#
# Prints "mode=full", or "mode=select" followed by one spec path per line
# (repo-relative, sorted). The reason for each decision goes to stderr.
#
# A select run is the union of:
#   1. every spec file that holds an @smoke test (the whole file runs),
#   2. every changed spec file that still exists,
#   3. the specs e2e-path-map.txt maps each changed path to.
#
# Fails open: shared code, a path no rule matches, an empty list, or a broken
# map all print "mode=full".
set -euo pipefail
# Map patterns must reach [[ == ]] as patterns, never as filename globs.
set -f

ROOT="${E2E_SELECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
MAP="$ROOT/.github/scripts/e2e-path-map.txt"
# GitHub's PR files API returns at most 3000 entries. A list that long may be
# cut short, so it cannot prove what did not change.
MAX_FILES=2999

full() {
  echo "e2e-select: full suite: $1" >&2
  echo "mode=full"
  exit 0
}

# Code every spec depends on. It lives here, not in the map, so that a map
# edit cannot switch it off. Changed spec files are handled before this.
always_full() {
  case "$1" in
    packages/* | pnpm-lock.yaml | pnpm-workspace.yaml | package.json | turbo.json | tsconfig.json) return 0 ;;
    .npmrc | .nvmrc | .node-version) return 0 ;;
    e2e/*) return 0 ;;
    .github/workflows/build-deploy.yml | .github/scripts/* | .github/actions/setup-workspace/*) return 0 ;;
    *) return 1 ;;
  esac
}

[ -f "$MAP" ] || full "map file missing: $MAP"

specs=$(cd "$ROOT" && find e2e/tests -type f -name '*.spec.ts' | LC_ALL=C sort)
[ -n "$specs" ] || full "no spec files under e2e/tests"

# match_specs <pattern>: the spec files a map pattern names.
match_specs() {
  local s
  for s in $specs; do
    # shellcheck disable=SC2053 # the right side is a pattern on purpose
    if [[ $s == $1 ]]; then echo "$s"; fi
  done
}

# Load the map. Each rule keeps its expanded spec list, or "-".
rule_paths=()
rule_specs=()
while read -r pattern rest || [ -n "${pattern:-}" ]; do
  case "${pattern:-}" in '' | '#'*) continue ;; esac
  [ -n "$rest" ] || full "map rule has no specs: $pattern"
  expanded="-"
  if [ "$rest" != "-" ]; then
    expanded=""
    for sp in $rest; do
      hits=$(match_specs "$sp")
      [ -n "$hits" ] || full "map pattern matches no spec file: $sp"
      expanded+="$hits"$'\n'
    done
  fi
  rule_paths+=("$pattern")
  rule_specs+=("$expanded")
done < "$MAP"
[ "${#rule_paths[@]}" -gt 0 ] || full "map has no rules"

# shellcheck disable=SC2086 # one argument per spec path
smoke=$(cd "$ROOT" && grep -l -- '@smoke' $specs || true)
[ -n "$smoke" ] || full "no spec file holds an @smoke test"

selected="$smoke"$'\n'
count=0
while IFS= read -r path || [ -n "$path" ]; do
  [ -z "$path" ] && continue
  count=$((count + 1))
  [ "$count" -le "$MAX_FILES" ] || full "more than $MAX_FILES changed files"

  case "$path" in
    e2e/tests/*.spec.ts)
      if [ -f "$ROOT/$path" ]; then
        echo "e2e-select: $path: changed spec" >&2
        selected+="$path"$'\n'
      else
        echo "e2e-select: $path: deleted spec, nothing to run" >&2
      fi
      continue
      ;;
  esac

  if always_full "$path"; then full "$path is shared by every spec"; fi

  matched=0
  for i in "${!rule_paths[@]}"; do
    # shellcheck disable=SC2053 # the right side is a pattern on purpose
    if [[ $path == ${rule_paths[$i]} ]]; then
      matched=1
      if [ "${rule_specs[$i]}" != "-" ]; then selected+="${rule_specs[$i]}"; fi
    fi
  done
  [ "$matched" -eq 1 ] || full "$path matches no rule in e2e-path-map.txt"
  echo "e2e-select: $path: mapped" >&2
done

[ "$count" -gt 0 ] || full "empty change list"

picked=$(printf '%s' "$selected" | sed '/^$/d' | LC_ALL=C sort -u)
if [ "$picked" = "$specs" ]; then full "the map selects every spec"; fi

echo "e2e-select: $(echo "$picked" | wc -l | tr -d ' ') of $(echo "$specs" | wc -l | tr -d ' ') spec files" >&2
echo "mode=select"
echo "$picked"
