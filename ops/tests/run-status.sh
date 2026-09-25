#!/usr/bin/env bash
# Cases for ops/run-status.sh (#2224): open / closed / stale-open / gh failure.
# Runs the real script against a stub `gh` serving a fixture comment list and
# checks both its output and its exit status (0 closed, 1 open, 2 unknown).
#
#   bash ops/tests/run-status.sh
#
# Needs only bash + jq. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATUS="$HERE/../run-status.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

export DEPLOY_RUN_REPO=test/repo DEPLOY_RUN_ISSUE=2093
export DEPLOY_GH_BIN="$TMP/gh"
cat > "$DEPLOY_GH_BIN" <<'STUB'
#!/usr/bin/env bash
[ -n "${GH_FAIL:-}" ] && exit 1
cat "$FIXTURE"
STUB
chmod +x "$DEPLOY_GH_BIN"

pass=0 fail=0
# check <name> <expected exit> <expected output> <fixture JSON>
check() {
  local name=$1 want_rc=$2 want=$3
  export FIXTURE="$TMP/fixture.json"
  printf '%s' "$4" > "$FIXTURE"
  local got rc=0
  got=$(bash "$STATUS" 2> /dev/null) || rc=$?
  if [ "$rc" = "$want_rc" ] && [ "$got" = "$want" ]; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); printf 'FAIL %s: want rc %s\n%s\n--- got rc %s\n%s\n' "$name" "$want_rc" "$want" "$rc" "$got"
  fi
}

c() { printf '{"created_at":"%s","body":%s}' "$1" "$(jq -Rn --arg b "$2" '$b')"; }
iso() { date -u -d "@$(( $(date +%s) - $1 ))" +%FT%TZ; }

check "open run" 1 \
  "run: open — run 9 started 10m ago (#2093: run 9 started — session s-1)
newest: run 9 started" \
  "[$(c "$(iso 1200)" 'run 8 ended'),$(c "$(iso 600)" 'run 9 started — session s-1')]"

check "closed run" 0 \
  "run: closed
newest: run 9 ended" \
  "[$(c "$(iso 1200)" 'run 9 started'),$(c "$(iso 600)" 'run 9 ended')]"

check "no markers" 0 \
  "run: closed
newest: no run markers on #2093" "[]"

check "open run past the cron's 3h cut-off is reported closed" 0 \
  "run: closed — run M3 started 240m ago with no \"ended\"; older than 10800s, so auto-deploy ignores it
newest: run M3 started" \
  "[$(c "$(iso 14400)" 'run M3 started')]"

DEPLOY_RUN_HOLD_MAX_AGE_SECONDS=20000 check "cut-off honours DEPLOY_RUN_HOLD_MAX_AGE_SECONDS" 1 \
  "run: open — run M3 started 240m ago (#2093: run M3 started)
newest: run M3 started" \
  "[$(c "$(iso 14400)" 'run M3 started')]"

GH_FAIL=1 check "gh failure is 'unknown', not 'closed'" 2 \
  "run: unknown — could not read #2093 comments via gh" "[]"

RUN_STATUS_DEPLOY_SCRIPT="$TMP/missing.sh" check "missing auto-deploy.sh is exit 2" 2 "" "[]"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
