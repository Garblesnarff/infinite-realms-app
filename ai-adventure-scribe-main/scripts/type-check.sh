#!/usr/bin/env bash
# Root typecheck runner (#2313). Executes BOTH halves and reports BOTH, even
# if one fails (the old `cmd1 && cmd2` chain hid the server result whenever
# the client half failed). Exits nonzero if either half failed.
set -u

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR" || exit 1

client_status="PASS"
server_status="PASS"

echo "=== client typecheck: scripts/client-typecheck-gate.sh ==="
# The client typecheck gate (#2664 step 0) runs tsc against the real client
# program (tsconfig.app.json) with the pre-existing errors quarantined
# per-file in client-typecheck-known-errors.txt. The old `bun x tsc --noEmit`
# checked zero files (root tsconfig.json has "files": [] plus references,
# and tsc without -b typechecks nothing).
if bash scripts/client-typecheck-gate.sh; then
  echo "client typecheck: PASS"
else
  client_status="FAIL"
  echo "client typecheck: FAIL"
fi

echo ""
echo "=== server typecheck: scripts/server-typecheck-gate.sh ==="
if bash scripts/server-typecheck-gate.sh; then
  echo "server typecheck: PASS"
else
  server_status="FAIL"
  echo "server typecheck: FAIL"
fi

echo ""
echo "=== type-check summary: client=$client_status server=$server_status ==="
if [ "$client_status" = "FAIL" ] || [ "$server_status" = "FAIL" ]; then
  exit 1
fi
exit 0
