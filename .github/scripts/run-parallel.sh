#!/usr/bin/env bash
# Runs commands at the same time and fails if any of them fails.
# Usage: run-parallel.sh "label=command" ["label=command" ...]
# Each command's output is printed as one collapsed group when it finishes.
set -uo pipefail

dir=$(mktemp -d)
labels=()
pids=()
start=$(date +%s)

for spec in "$@"; do
  label=${spec%%=*}
  cmd=${spec#*=}
  labels+=("$label")
  bash -c "$cmd" >"$dir/$label.log" 2>&1 &
  pids+=($!)
done

failed=()
for i in "${!pids[@]}"; do
  label=${labels[$i]}
  if wait "${pids[$i]}"; then
    status="ok"
  else
    status="FAILED"
    failed+=("$label")
  fi
  echo "::group::$label ($status, $(($(date +%s) - start))s since start)"
  cat "$dir/$label.log"
  echo "::endgroup::"
done

if [ "${#failed[@]}" -gt 0 ]; then
  for label in "${failed[@]}"; do
    echo "::error::$label failed"
  done
  exit 1
fi
