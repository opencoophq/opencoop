#!/usr/bin/env bash
# Wrap deploy/remote-deploy.sh so the remote login shell can be dash.
# appleboy/ssh-action executes the file body with that shell; pipefail requires bash.
set -euo pipefail

out="${1:?output path required}"
root=$(cd "$(dirname "$0")" && pwd)
body="${root}/remote-deploy.sh"

if grep -qx 'OPENCOOP_DEPLOY_SCRIPT' "$body"; then
  echo "remote-deploy.sh contains the wrapper sentinel" >&2
  exit 1
fi

{
  printf '%s\n' "exec bash --noprofile --norc -euo pipefail -s <<'OPENCOOP_DEPLOY_SCRIPT'"
  cat "$body"
  printf '%s\n' 'OPENCOOP_DEPLOY_SCRIPT'
} > "$out"
