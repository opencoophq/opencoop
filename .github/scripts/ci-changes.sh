#!/usr/bin/env bash
# Decides whether a PR needs the expensive jobs (e2e, Docker build).
# Reads changed paths on stdin, one per line. Prints "app=true" or "app=false".
#
# Allowlist of paths that can never change what e2e or the images test.
# Any path not listed here counts as app code, so a new directory is safe
# by default. CHANGELOG.md is NOT listed: the API serves it at runtime.
set -euo pipefail

skippable() {
  case "$1" in
    docs/* | apps/docs/* | tasks/* | agents/* | .claude/*) return 0 ;;
    README.md | LICENSE | NOTICE | lefthook.yml | .prettierrc) return 0 ;;
    deploy/remote-deploy.sh | deploy/remote-deploy.test.sh | deploy/wrap-remote-deploy.sh) return 0 ;;
    .github/actions/remote-deploy/*) return 0 ;;
    .github/workflows/auto-merge.yml | .github/workflows/docs-deploy.yml) return 0 ;;
    .github/dependabot.yml | .github/ISSUE_TEMPLATE/* | .github/pull_request_template.md) return 0 ;;
    *) return 1 ;;
  esac
}

seen=0
while IFS= read -r path || [ -n "$path" ]; do
  [ -z "$path" ] && continue
  seen=1
  if ! skippable "$path"; then
    echo "app=true"
    exit 0
  fi
done

# An empty list means we could not tell what changed: run everything.
if [ "$seen" -eq 0 ]; then
  echo "app=true"
else
  echo "app=false"
fi
