#!/usr/bin/env bash
# Fixture cases for newest_run() / newest_run_detail() in ops/auto-deploy.sh
# (#2201). Extracts both functions, points them at a stub `gh` that serves a
# fixture comment list, and checks the text --dry-run appends to
# "run_check ok" (for example "newest: run 9 ended").
#
#   bash ops/tests/newest-run-marker.sh
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
[ -n "${GH_FAIL:-}" ] && exit 1
cat "$FIXTURE"
STUB
chmod +x "$GH_BIN"

eval "$(sed -n '/^newest_run() {/,/^}/p' "$SCRIPT")"
eval "$(sed -n '/^newest_run_detail() {/,/^}/p' "$SCRIPT")"

pass=0 fail=0
# check <name> <expected detail> <fixture JSON>
check() {
  local name=$1 want=$2
  export FIXTURE="$TMP/fixture.json"
  printf '%s' "$3" > "$FIXTURE"
  local got
  got=$(newest_run_detail)
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); echo "FAIL $name: want '${want}', got '${got}'"
  fi
}

c() { printf '{"created_at":"%s","body":%s}' "$1" "$(jq -Rn --arg b "$2" '$b')"; }

check "closed run: newest is its ended" "newest: run 9 ended" \
  "[$(c 2026-09-21T03:55:46Z 'run 9 started'),$(c 2026-09-21T04:07:40Z 'run 9 ended')]"

check "open run: newest is its started" "newest: run 9 started" \
  "[$(c 2026-09-21T03:55:46Z 'run 8 ended'),$(c 2026-09-21T04:07:40Z 'run 9 started')]"

check "comments out of order are sorted by time" "newest: run 9 ended" \
  "[$(c 2026-09-21T04:07:40Z 'run 9 ended'),$(c 2026-09-21T03:55:46Z 'run 9 started')]"

check "later marker in one comment wins" "newest: run 9 started" \
  "[$(c 2026-09-22T05:00:00Z 'run 8 ended; run 9 started')]"

check "Muse id upper-cased: run m2 ended" "newest: run M2 ended" \
  "[$(c 2026-09-21T03:22:21Z 'run M2 started'),$(c 2026-09-21T03:32:09Z 'run m2 ended')]"

check "bold markdown marker" "newest: run 9 started" \
  "[$(c 2026-09-22T05:00:00Z '**Run 9 started** — session s-123')]"

check "comments without markers are ignored" "newest: run 9 ended" \
  "[$(c 2026-09-21T04:07:40Z 'run 9 ended'),$(c 2026-09-21T05:00:00Z 'looks good'),$(c 2026-09-21T06:00:00Z 'run MX2 started')]"

check "null body tolerated" "newest: no run markers on #2093" \
  '[{"created_at":"2026-09-22T05:00:00Z","body":null}]'

check "no comments" "newest: no run markers on #2093" "[]"

GH_FAIL=1 check "gh failure is not reported as 'no markers'" \
  "newest: unknown (second read of #2093 failed)" "[]"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
