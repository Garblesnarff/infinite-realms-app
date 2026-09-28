#!/usr/bin/env bash
# End-to-end cases for the post-deploy smoke in ops/auto-deploy.sh (#2293).
# Runs the real script against a scratch git repo (a bare "origin" plus a
# clone), with stub bun/bunx/pm2/node/rsync/chown and a stub `gh`, as
# ops/tests/merge-train-hold.sh does.
#
#   1. No smoke env file: log, exit status, stub calls and state files are
#      identical to the script with every "post-deploy smoke" block cut out.
#   2. Smoke configured and passing: it runs after "Deploy complete" with the
#      deployed SHA and the app dir; exit 0.
#   3. Smoke failing: exit 1 and a "DEPLOY SMOKE FAILED" line.
#   4. SMOKE_FAILED present: "hold smoke", nothing fetched/built/restarted,
#      --deploy-now refuses; no second alert inside the hour; removing the file
#      deploys again and clears the alert to RECOVERED.
#   5. Configured but smoke.sh missing: an ALERT, the deploy still completes.
#   6. The whole chain with the real smoke.sh: a 422 on the DM save holds the
#      next tick.
#
#   bash ops/tests/smoke-deploy.sh
#
# Needs bash, git and jq. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../auto-deploy.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
for b in bun bunx pm2 node rsync chown; do
  printf '#!/usr/bin/env bash\necho "stub %s $*" >> "$STUB_LOG"\n' "$b" > "$TMP/bin/$b"
done
printf '#!/usr/bin/env bash\n[ "$1" = api ] && { echo "[]"; exit 0; }\n{ echo "gh $*"; cat; } >> "$GH_LOG"\n' > "$TMP/bin/gh"
# A stand-in smoke.sh: records how it was called; exits $SMOKE_RC.
cat > "$TMP/bin/fake-smoke.sh" <<'STUB'
#!/usr/bin/env bash
echo "smoke $* app=$SMOKE_APP_DIR env=$SMOKE_ENV_FILE" >> "$STUB_LOG"
echo "fake smoke ran"
exit "${SMOKE_RC:-0}"
STUB
chmod +x "$TMP/bin"/*
: > "$TMP/smoke.env"

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_DATE=2026-09-25T00:00:00Z GIT_COMMITTER_DATE=2026-09-25T00:00:00Z

# setup <dir> <moved|still>: a clone whose origin/main is one commit ahead
# (moved) or level with it (still), and a fresh state dir.
setup() {
  local d=$1
  git init -q --bare -b main "$d/origin.git"
  git clone -q "$d/origin.git" "$d/app" 2> /dev/null
  mkdir -p "$d/app/server-bun" "$d/app/dist" "$d/state"
  touch "$d/app/server-bun/.keep" "$d/app/dist/index.html"
  git -C "$d/app" add -A && git -C "$d/app" commit -qm one && git -C "$d/app" push -q origin HEAD:main
  if [ "$2" = moved ]; then
    git clone -q "$d/origin.git" "$d/pusher" 2> /dev/null
    git -C "$d/pusher" commit -q --allow-empty -m two && git -C "$d/pusher" push -q origin HEAD:main
  fi
}

# deploy <dir> <script> [args...]: run with every host path pointed into <dir>.
# DEPLOY_SMOKE_ENV / DEPLOY_SMOKE_SCRIPT pass through from the caller; the
# smoke env defaults to a path that does not exist ("not configured").
deploy() {
  local d=$1 s=$2; shift 2
  RC=0
  STUB_LOG="$d/stub.log" GH_LOG="$d/gh.log" DEPLOY_REPO_DIR="$d/app" DEPLOY_STATE_DIR="$d/state" \
    DEPLOY_ALERT_FILE="$d/alerts.log" DEPLOY_ALERTS_ENV="$d/none.env" \
    DEPLOY_STAGING_ROOT="$d/staging" DEPLOY_BIN_PATH="$TMP/bin" DEPLOY_GH_BIN="$TMP/bin/gh" \
    DEPLOY_SMOKE_ENV="${DEPLOY_SMOKE_ENV:-$d/no-smoke.env}" \
    bash "$s" "$@" > "$d/out.raw" 2>&1 || RC=$?
  sed -e 's/^\[[0-9-]* [0-9:]*\] //' -e "s#$d#<D>#g" "$d/out.raw" > "$d/out"
  OUT=$(<"$d/out")
}

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n%s\n' "$1" "$2"; }
expect() { local n=$1; shift; if "$@"; then ok "$n"; else bad "$n" "$OUT"; fi; }
has() { grep -qF -- "$1" <<< "$OUT"; }
hasnt() { ! grep -qF -- "$1" <<< "$OUT"; }
head_of() { git -C "$1/origin.git" rev-parse main; }

# 1. Not configured: identical to the script without any smoke block.
BASE="$TMP/baseline.sh"
sed '/^# --- post-deploy smoke/,/^# --- end post-deploy smoke/d' "$SCRIPT" > "$BASE"
expect "baseline really lacks the smoke blocks" test "$(grep -c SMOKE "$BASE")" = 0
for shape in moved still; do
  A="$TMP/new-$shape" B="$TMP/old-$shape"
  setup "$A" "$shape"; setup "$B" "$shape"
  deploy "$A" "$SCRIPT"; RA=$RC; OA=$OUT
  deploy "$B" "$BASE"; RB=$RC; OB=$OUT
  OUT="new rc=$RA old rc=$RB"$'\n'"$(diff <(echo "$OA") <(echo "$OB") || true)"
  expect "not configured ($shape): identical log + rc" test "$OA" = "$OB" -a "$RA" = "$RB"
  expect "not configured ($shape): identical stub calls" \
    test "$(sed "s#$A#<D>#g" "$A/stub.log" 2> /dev/null)" = "$(sed "s#$B#<D>#g" "$B/stub.log" 2> /dev/null)"
  expect "not configured ($shape): identical state files" test "$(ls "$A/state")" = "$(ls "$B/state")"
done
expect "not configured (moved) really deployed" grep -q "Deploy complete" "$TMP/new-moved/out.raw"

export DEPLOY_SMOKE_ENV="$TMP/smoke.env" DEPLOY_SMOKE_SCRIPT="$TMP/bin/fake-smoke.sh"

# 2. Configured, passing.
D="$TMP/pass"; setup "$D" moved
deploy "$D" "$SCRIPT"
expect "pass: exit 0" test "$RC" = 0
expect "pass: smoke ran with the deployed SHA and app dir" \
  grep -qF "smoke $(head_of "$D") app=$D/app env=$TMP/smoke.env" "$D/stub.log"
expect "pass: smoke ran after 'Deploy complete'" \
  test "$(grep -n -e 'Deploy complete' -e 'fake smoke ran' "$D/out" | cut -d: -f2- | tr '\n' '|')" = \
  "Deploy complete ($(head_of "$D"))|fake smoke ran|"
expect "pass: no alert" test ! -s "$D/alerts.log"
# A tick with nothing new deploys nothing, so there is nothing to smoke.
deploy "$D" "$SCRIPT"
expect "no-change tick: smoke not run again" test "$(grep -c '^smoke ' "$D/stub.log")" = 1
# --dry-run only says it would run it.
D="$TMP/dry"; setup "$D" moved
deploy "$D" "$SCRIPT" --dry-run
expect "dry run: would run smoke, did not" \
  bash -c "grep -q '\[dry-run\] would run: env SMOKE_ENV_FILE=' '$D/out' && ! grep -qs '^smoke ' '$D/stub.log'"

# 3. Configured, failing.
D="$TMP/fail"; setup "$D" moved
SMOKE_RC=1 deploy "$D" "$SCRIPT"
expect "fail: exit 1" test "$RC" = 1
expect "fail without a hold file: says deploys are NOT held" \
  has "DEPLOY SMOKE FAILED at $(head_of "$D") — smoke.sh wrote no hold file, so deploys are NOT held"
expect "fail without a hold file: pages smoke_setup" grep -q "DEPLOY FAILED: smoke_setup — ops/smoke.sh failed" "$D/alerts.log"
expect "fail: the deploy itself completed first" has "Deploy complete ($(head_of "$D"))"
D="$TMP/fail-held"; setup "$D" moved
cat > "$TMP/bin/holding-smoke.sh" <<'STUB'
#!/usr/bin/env bash
echo "held by fake smoke" > "$DEPLOY_STATE_DIR/SMOKE_FAILED"
exit 1
STUB
chmod +x "$TMP/bin/holding-smoke.sh"
DEPLOY_SMOKE_SCRIPT="$TMP/bin/holding-smoke.sh" deploy "$D" "$SCRIPT"
expect "fail with a hold file: exit 1 and says held" \
  test "$RC" = 1 -a -n "$(grep -F "DEPLOY SMOKE FAILED at $(head_of "$D") — deploys are held by <D>/state/SMOKE_FAILED" "$D/out")"

# 4. Held by SMOKE_FAILED (as smoke.sh leaves it).
D="$TMP/held"; setup "$D" moved
echo "2026-09-27T03:00:00Z smoke failed at abc — step 3 (…): HTTP 422 — Validation failed" > "$D/state/SMOKE_FAILED"
echo "fail $(date +%s) $(date +%s)" > "$D/state/smoke.state"
deploy "$D" "$SCRIPT"
expect "held: logs 'hold smoke' with the failure" \
  has "hold smoke: <D>/state/SMOKE_FAILED present (2026-09-27T03:00:00Z smoke failed at abc — step 3 (…): HTTP 422 — Validation failed)."
expect "held: exit 0" test "$RC" = 0
expect "held: nothing ran" test ! -e "$D/stub.log"
expect "held: HEAD not advanced" test "$(git -C "$D/app" rev-parse HEAD)" != "$(head_of "$D")"
expect "held: no second alert inside the hour" test ! -s "$D/alerts.log"
deploy "$D" "$SCRIPT" --deploy-now
expect "held: --deploy-now refuses with exit 1" test "$RC" = 1
expect "held: --deploy-now says why" has "Refusing --deploy-now: the post-deploy smoke failed."
# An hour on, the cron repeats the alert once.
echo "fail $(( $(date +%s) - 4000 )) $(( $(date +%s) - 4000 ))" > "$D/state/smoke.state"
deploy "$D" "$SCRIPT"
expect "held an hour: one reminder" grep -q "DEPLOY STILL FAILING (66m): smoke — post-deploy smoke failed and deploys are HELD" "$D/alerts.log"
rm "$D/state/SMOKE_FAILED"
deploy "$D" "$SCRIPT"
expect "hold removed: deploys" has "Deploy complete ($(head_of "$D"))"
expect "hold removed: RECOVERED" grep -q "DEPLOY RECOVERED: smoke" "$D/alerts.log"

# 5. Configured but the script is missing.
D="$TMP/missing"; setup "$D" moved
DEPLOY_SMOKE_SCRIPT="$D/nope.sh" deploy "$D" "$SCRIPT"
expect "missing script: ALERT line" has "ALERT: $TMP/smoke.env exists but <D>/nope.sh does not; the post-deploy smoke did NOT run."
expect "missing script: paged" grep -q "DEPLOY FAILED: smoke_setup" "$D/alerts.log"
expect "missing script: deploy still complete, exit 0" test "$RC" = 0 -a -n "$(grep 'Deploy complete' "$D/out")"
expect "missing script: no hold" test ! -e "$D/state/SMOKE_FAILED"

# 6. The whole chain with the real smoke.sh (stub curl: /version answers the
# deployed SHA, the DM save 422s). The next tick is held.
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
out="" method=GET data="" url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out=$2; shift ;; -X) method=$2; shift ;; --data-binary) data=${2#@}; shift ;;
    -H | -w | -A | -m) shift ;; -*) ;; *) url=$1 ;; esac
  shift
done
path=/${url#*://*/}
reply() { printf '%s' "$2" > "$out"; printf '%s' "$1"; exit 0; }
case "$method $path" in
  "GET /version") reply 200 "{\"commit\":\"$(git -C "$APP" rev-parse HEAD)\"}" ;;
  "POST /v1/auth/password-login") reply 200 '{"accessToken":"t","refreshToken":"r"}' ;;
  "GET /v1/campaigns") reply 200 '[]' ;;
  "POST /v1/campaigns") reply 201 '{"id":"c1"}' ;;
  "POST /v1/sessions") reply 201 '{"id":"s1"}' ;;
  "POST /v1/sessions/s1/messages")
    jq -e '.speaker_type == "dm"' "$data" > /dev/null && reply 422 '{"error":"Validation failed"}'
    reply 200 '{"messages":[]}' ;;
esac
reply 404 '{}'
STUB
printf '#!/usr/bin/env bash\necho "{\\"playerInput\\":\\"hi\\",\\"rollRequests\\":[{\\"type\\":\\"skill_check\\",\\"formula\\":\\"1d20+6\\",\\"purpose\\":\\"Insight check\\"}],\\"wireBody\\":{\\"message\\":\\"Read him.\\",\\"speaker_type\\":\\"dm\\",\\"context\\":{\\"rollRequests\\":[{\\"formula\\":\\"1d20+6\\"}]}}}"\n' > "$TMP/bin/fixture-bun"
chmod +x "$TMP/bin/curl" "$TMP/bin/fixture-bun"
printf 'SMOKE_EMAIL=s@example.test\nSMOKE_PASSWORD=x\n' > "$TMP/real-smoke.env"
D="$TMP/chain"; setup "$D" moved; touch "$D/fixture.ts"
APP="$D/app" SMOKE_CURL="$TMP/bin/curl" SMOKE_BUN="$TMP/bin/fixture-bun" SMOKE_FIXTURE="$D/fixture.ts" \
  SMOKE_VERSION_WAIT_SECONDS=0 SMOKE_POLL_SECONDS=0 \
  DEPLOY_SMOKE_ENV="$TMP/real-smoke.env" DEPLOY_SMOKE_SCRIPT="$HERE/../smoke.sh" deploy "$D" "$SCRIPT"
expect "chain: exit 1" test "$RC" = 1
expect "chain: smoke reached step 3 on the deployed SHA" has "smoke: FAILED at $(head_of "$D" | cut -c1-8) — step 3"
expect "chain: hold file written" test -e "$D/state/SMOKE_FAILED"
expect "chain: one alert" test "$(grep -c 'DEPLOY FAILED: smoke — step 3' "$D/alerts.log")" = 1
expect "chain: one #2093 comment" test "$(grep -c '^gh issue comment 2093' "$D/gh.log")" = 1
git -C "$D/pusher" commit -q --allow-empty -m three && git -C "$D/pusher" push -q origin HEAD:main
deploy "$D" "$SCRIPT"
expect "chain: next tick is held" has "hold smoke: <D>/state/SMOKE_FAILED present"
expect "chain: next tick deploys nothing" test "$(git -C "$D/app" rev-parse HEAD)" != "$(head_of "$D")"
expect "chain: still one alert" test "$(grep -c 'smoke' "$D/alerts.log")" = 1

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
