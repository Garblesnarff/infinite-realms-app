#!/usr/bin/env bash
# Fixture cases for open_run() in ops/auto-deploy.sh (#2093, #2152).
# Extracts the function from the script, points it at a stub `gh` that serves
# a fixture comment list, and checks the "<N>\t..." line it prints (or nothing).
#
#   bash ops/tests/open-run-markers.sh
#
# Needs only bash + jq. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../auto-deploy.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

RUN_REPO=test/repo
RUN_ISSUE=2093
GH_BIN="$TMP/gh"
cat > "$GH_BIN" <<'STUB'
#!/usr/bin/env bash
cat "$FIXTURE"
STUB
chmod +x "$GH_BIN"

eval "$(sed -n '/^open_run() {/,/^}/p' "$SCRIPT")"

pass=0 fail=0
# check <name> <expected run id, or "" for none> <fixture JSON>
check() {
  local name=$1 want=$2
  export FIXTURE="$TMP/fixture.json"
  printf '%s' "$3" > "$FIXTURE"
  local got
  got=$(open_run | cut -f1)
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); echo "FAIL $name: want '${want}', got '${got}'"
  fi
}

c() { printf '{"created_at":"%s","body":%s}' "$1" "$(jq -Rn --arg b "$2" '$b')"; }

check "numeric run closed" "" \
  "[$(c 2026-09-21T03:55:46Z 'run 8 started'),$(c 2026-09-21T04:07:40Z 'run 8 ended')]"

check "numeric run open" "9" \
  "[$(c 2026-09-21T03:55:46Z 'run 9 started')]"

check "Muse letter-prefixed run open: run M3 started" "M3" \
  "[$(c 2026-09-22T05:00:00Z 'run M3 started')]"

check "Muse run closed with different case (real #2093: M2 / m2)" "" \
  "[$(c 2026-09-21T03:22:21Z 'run M2 started'),$(c 2026-09-21T03:32:09Z 'run m2 ended')]"

check "Terra format: run 9 started — session <id>, bundle main-….js" "9" \
  "[$(c 2026-09-22T05:00:00Z 'run 9 started — session 3f2a9c1e-0b7d-4e55-9a61-2c8d4f1b7e90, bundle main-Bx7Qk2Lm.js')]"

check "one comment closes one run and opens another" "9" \
  "[$(c 2026-09-22T05:00:00Z 'run 8 ended; run 9 started')]"

check "bold markdown marker" "9" \
  "[$(c 2026-09-22T05:00:00Z '**Run 9 started** — session s-123')]"

check "re-used run number reopened after ended" "9" \
  "[$(c 2026-09-22T04:00:00Z 'run 9 started'),$(c 2026-09-22T04:10:00Z 'run 9 ended'),$(c 2026-09-22T04:20:00Z 'run 9 started (retry)')]"

check "null body tolerated" "" \
  '[{"created_at":"2026-09-22T05:00:00Z","body":null}]'

check "no comments" "" "[]"

check "two-letter prefix is not a marker" "" \
  "[$(c 2026-09-22T05:00:00Z 'run MX2 started')]"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
