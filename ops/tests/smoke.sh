#!/usr/bin/env bash
# Cases for ops/smoke.sh (#2293): pass, a 422 on step 3, a version mismatch,
# --no-hold, an existing hold, marker-shaped server text, a refused sign-in.
# Runs the real script with a stub `curl` (a tiny in-memory API: it keeps the
# posted messages and serves them back), a stub `bun` that prints the fixture
# JSON, and a stub `gh` that records the comment.
#
#   bash ops/tests/smoke.sh
#
# Needs bash + jq. Touches nothing outside a temp dir. When #2286's fixture is
# on this branch and a real `bun` is on PATH, it also checks that smoke.sh can
# read the real fixture.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SMOKE="$HERE/../smoke.sh"
REAL_FIXTURE="$HERE/../../ai-adventure-scribe-main/shared/test-fixtures/dm-roll-reply-saves.ts"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

SHA=3fa7eefe0c1d2b3a4f5e6d7c8b9a0f1e2d3c4b5a
FAKE_PW=pw-not-a-real-secret-7f3a
TOKEN=tok-not-a-real-token-91c2

# RUN_11_INSIGHT as `bun -e` prints it (shape of #2286's fixture).
cat > "$TMP/fixture.json" <<'JSON'
{"name":"run 11 (The Faithful, The Eternal Feast): Insight on turn 1",
 "dmMessageId":"0354e278-af2a-442c-9f01-dd702ae0a9ad","timestamp":"2026-09-26T03:03:05.900Z",
 "playerInput":"I study Remy's face closely while he talks. Is he hiding something?",
 "reply":{"text":"Remy's smile holds a beat too long.","narrationSegments":[],"context":{"emotion":"neutral","intent":"response","combat_transition":"none"}},
 "rollRequests":[{"type":"skill_check","formula":"1d20+6","purpose":"Insight check to read Remy's motives","dc":15}],
 "wireBody":{"id":"0354e278-af2a-442c-9f01-dd702ae0a9ad","message":"Remy's smile holds a beat too long.","speaker_type":"dm",
   "context":{"location":null,"emotion":"neutral","intent":"response","handouts":null,"combat_transition":"none","scene_spec":false,
     "combat_engine_blocks":null,"combat_ended":false,"narration_segments":[{"type":"dm","text":"Remy's smile holds a beat too long."}],
     "rollRequests":[{"type":"skill_check","formula":"1d20+6","purpose":"Insight check to read Remy's motives","dc":15}]},
   "timestamp":"2026-09-26T03:03:05.900Z"}}
JSON
touch "$TMP/fixture.ts" # smoke.sh checks the .ts exists; the stub bun reads the JSON

mkdir -p "$TMP/bin"
cat > "$TMP/bin/bun" <<'STUB'
#!/usr/bin/env bash
cat "$FIXTURE_JSON"
STUB
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
{ echo "ARGS: $*"; cat; echo; echo "--- end"; } >> "$GH_LOG"
STUB
# #2286's server answer to the text-less #2250 body.
export DM_422_BODY='{"error":"Validation failed","issues":[{"path":"/message","message":"Expected string length greater or equal to 1"}]}'
# A stub API. Scenario knobs: VERSION_COMMIT, FAIL_DM_STATUS (+ FAIL_DM_BODY),
# LOGIN_STATUS. Every call's argv goes to $CURL_LOG; messages live in $DB.
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "ARGV: $*" >> "$CURL_LOG"
out="" method=GET data="" hdr="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift ;;
    -X) method=$2; shift ;;
    --data-binary) data=${2#@}; shift ;;
    -H) case "$2" in @*) hdr=${2#@} ;; esac; shift ;;
    -w | -A | -m) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
path=/${url#*://*/}
authed=no; [ -n "$hdr" ] && grep -q "Bearer $EXPECT_TOKEN" "$hdr" && authed=yes
echo "$method $path auth=$authed" >> "$CALLS"
reply() { printf '%s' "$2" > "$out"; printf '%s' "$1"; exit 0; }
case "$method $path" in
  "GET /version") reply 200 "{\"commit\":\"$VERSION_COMMIT\",\"short\":\"${VERSION_COMMIT:0:8}\"}" ;;
  "POST /v1/auth/password-login")
    cp "$data" "$STUB_DIR/login-body.json"
    [ "${LOGIN_STATUS:-200}" = 200 ] || reply "$LOGIN_STATUS" '{"error":"Invalid email or password"}'
    reply 200 "{\"accessToken\":\"$EXPECT_TOKEN\",\"refreshToken\":\"r-$EXPECT_TOKEN\"}" ;;
esac
[ "$authed" = yes ] || reply 401 '{"error":"Unauthorized"}'
case "$method $path" in
  "GET /v1/campaigns") reply 200 "$(cat "$STUB_DIR/campaigns.json" 2> /dev/null || echo '[]')" ;;
  "POST /v1/campaigns") reply 201 '{"id":"c-new","name":"x"}' ;;
  "DELETE /v1/campaigns/c-new") touch "$STUB_DIR/deleted"; reply 200 '{"ok":true}' ;;
  "DELETE /v1/campaigns/"*) echo "${path##*/}" >> "$STUB_DIR/swept"; reply 200 '{"ok":true}' ;;
  "POST /v1/sessions") reply 201 '{"id":"s-new"}' ;;
  "POST /v1/sessions/s-new/messages")
    if [ -n "${FAIL_DM_STATUS:-}" ] && jq -e '.speaker_type == "dm"' "$data" > /dev/null; then
      reply "$FAIL_DM_STATUS" "${FAIL_DM_BODY:-$DM_422_BODY}"
    fi
    jq -c . "$data" >> "$STUB_DIR/db.jsonl"
    reply 200 "{\"messages\":[$(jq -c . "$data")]}" ;;
  "GET /v1/sessions/s-new/messages?limit=10")
    reply 200 "$(jq -s '{messages: ., total: length, hasMore: false}' "$STUB_DIR/db.jsonl")" ;;
  "GET /v1/sessions/s-new/messages?limit=1")
    [ -e "$STUB_DIR/deleted" ] && reply 404 '{"error":"Session not found"}'
    reply 200 '{"messages":[]}' ;;
esac
reply 404 '{"error":"Not Found"}'
STUB
chmod +x "$TMP/bin"/*
printf 'SMOKE_EMAIL=smoke@example.test\nSMOKE_PASSWORD=%s\n' "$FAKE_PW" > "$TMP/smoke.env"
: > "$TMP/none.env"

# smoke <dir> [args…]: run the real script with everything pointed into <dir>.
# Leaves the output in <dir>/out and sets RC.
smoke() {
  local d=$1; shift
  mkdir -p "$d/state"
  RC=0
  STUB_DIR="$d" CALLS="$d/calls" CURL_LOG="$d/curl.log" GH_LOG="$d/gh.log" \
    FIXTURE_JSON="$TMP/fixture.json" EXPECT_TOKEN="$TOKEN" \
    VERSION_COMMIT="${VERSION_COMMIT:-$SHA}" \
    SMOKE_CURL="$TMP/bin/curl" SMOKE_BUN="$TMP/bin/bun" SMOKE_FIXTURE="$TMP/fixture.ts" \
    SMOKE_ENV_FILE="$TMP/smoke.env" SMOKE_API_BASE=https://api.test \
    SMOKE_VERSION_WAIT_SECONDS=0 SMOKE_POLL_SECONDS=0 \
    DEPLOY_STATE_DIR="$d/state" DEPLOY_ALERT_FILE="$d/alerts.log" DEPLOY_ALERTS_ENV="$TMP/none.env" \
    DEPLOY_GH_BIN="$TMP/bin/gh" DEPLOY_RUN_REPO=test/repo DEPLOY_RUN_ISSUE=2093 \
    bash "$SMOKE" "$@" > "$d/out" 2>&1 || RC=$?
  OUT=$(<"$d/out")
}

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n%s\n' "$1" "$OUT"; }
expect() { local n=$1; shift; if "$@" > /dev/null; then ok "$n"; else bad "$n"; fi; }
has() { grep -qF -- "$1" <<< "$OUT"; }
in_file() { [ -e "$2" ] && grep -qF -- "$1" "$2"; }
nowhere() { # <secret> <dir>: not in the output, curl argv, alerts, gh comment, hold
  ! grep -rqF -- "$1" "$2/out" "$2/curl.log" "$2/alerts.log" "$2/gh.log" "$2/state" 2> /dev/null
}

# 1. Pass: no hold, no alert, no comment; the DM row is the fixture's wire body.
D="$TMP/pass"; smoke "$D" "$SHA"
expect "pass: exit 0" test "$RC" = 0
expect "pass: says PASS" has "smoke: PASS at 3fa7eefe"
expect "pass: no hold file" test ! -e "$D/state/SMOKE_FAILED"
expect "pass: no alert" test ! -s "$D/alerts.log"
expect "pass: no #2093 comment" test ! -e "$D/gh.log"
expect "pass: 3 rows saved (player, dm, player)" \
  test "$(jq -rs 'map(.speaker_type) | join(",")' "$D/db.jsonl")" = "player,dm,player"
expect "pass: DM row is the fixture wireBody (only id/timestamp differ)" \
  jq -es --slurpfile f "$TMP/fixture.json" \
  '(.[1] | del(.id, .timestamp)) == ($f[0].wireBody | del(.id, .timestamp)) and .[1].id != $f[0].wireBody.id' "$D/db.jsonl"
expect "pass: rows get fresh ids and ascending timestamps" \
  jq -es '(map(.id) | unique | length) == 3 and (map(.timestamp) == (map(.timestamp) | sort))' "$D/db.jsonl"
expect "pass: roll row is a dice_roll for the fixture's formula" \
  jq -es '.[2].context.intent == "dice_roll" and .[2].context.diceRoll.formula == "1d20+6"' "$D/db.jsonl"
expect "pass: every call after sign-in is authenticated" \
  bash -c "! grep -v -e '^GET /version' -e '^POST /v1/auth/password-login' '$D/calls' | grep -q 'auth=no'"
expect "pass: campaign deleted and session checked gone" \
  grep -q "GET /v1/sessions/s-new/messages?limit=1 auth=yes" "$D/calls"
expect "pass: sign-in body built from the env file" \
  jq -e --arg p "$FAKE_PW" '.email == "smoke@example.test" and .password == $p' "$D/login-body.json"
expect "pass: password and token never printed or on a command line" nowhere "$FAKE_PW" "$D"
expect "pass: token not printed" nowhere "$TOKEN" "$D"
expect "pass: sends the smoke user agent (http-alarm.sh skips it)" grep -q -- "-A infiniterealms-smoke/1" "$D/curl.log"

# Leftover smoke campaigns from a failed run are swept; others are not.
D="$TMP/sweep"; mkdir -p "$D"
echo '[{"id":"c-old","name":"ops smoke 11111111 2026-09-26T00:00:00Z"},{"id":"c-keep","name":"Real campaign"}]' > "$D/campaigns.json"
smoke "$D" "$SHA"
expect "sweep: leftover smoke campaign deleted, other kept" test "$(cat "$D/swept")" = "c-old"

# 2. A 422 on step 3 (the #2280 shape): hold file + one alert + one comment, all naming step 3.
D="$TMP/dm422"; FAIL_DM_STATUS=422 smoke "$D" "$SHA"
expect "dm 422: exit 1" test "$RC" = 1
expect "dm 422: hold file names step 3" in_file "step 3 (save the DM reply with rollRequests" "$D/state/SMOKE_FAILED"
expect "dm 422: hold file names the commit" in_file "$SHA" "$D/state/SMOKE_FAILED"
expect "dm 422: alert line names step 3 and the status" \
  in_file "DEPLOY FAILED: smoke — step 3 (save the DM reply with rollRequests — the #2280 wire body): HTTP 422" "$D/alerts.log"
expect "dm 422: exactly one alert line" test "$(wc -l < "$D/alerts.log")" -eq 1
expect "dm 422: alert carries the server's reason" in_file "/message Expected string length greater or equal to 1" "$D/alerts.log"
expect "dm 422: one comment on #2093" test "$(grep -c '^ARGS: issue comment 2093 --repo test/repo --body-file -$' "$D/gh.log")" = 1
expect "dm 422: comment names step 3 and HTTP 422" \
  bash -c "grep -q -- '- Step: 3 (save the DM reply' '$D/gh.log' && grep -q -- '- HTTP status: 422' '$D/gh.log'"
expect "dm 422: cron state seeded as just-notified" grep -q '^fail ' "$D/state/smoke.state"
expect "dm 422: stopped before step 4" test "$(jq -s length "$D/db.jsonl")" = 1
expect "dm 422: failed campaign left for inspection" test ! -e "$D/deleted"
expect "dm 422: no secrets anywhere" nowhere "$FAKE_PW" "$D"

# Run again while held: no second alert or comment.
FAIL_DM_STATUS=422 smoke "$D" "$SHA"
expect "already held: exit 1" test "$RC" = 1
expect "already held: no second alert" test "$(wc -l < "$D/alerts.log")" -eq 1
expect "already held: no second comment" test "$(grep -c '^ARGS:' "$D/gh.log")" = 1

# 3. /version still reports the old commit: a hold naming step 1.
D="$TMP/mismatch"; VERSION_COMMIT=00000000aaaabbbbccccddddeeeeffff00001111 smoke "$D" "$SHA"
expect "version mismatch: exit 1" test "$RC" = 1
expect "version mismatch: hold file" test -e "$D/state/SMOKE_FAILED"
expect "version mismatch: alert names step 1" \
  in_file "step 1 (GET /version reports the deployed commit): HTTP 200 — version mismatch: live 00000000aaaabbbbccccddddeeeeffff00001111, expected $SHA" "$D/alerts.log"
expect "version mismatch: nothing written" test ! -e "$D/db.jsonl"

# 4. --no-hold: reports and fails, but no hold, alert or comment.
D="$TMP/nohold"; FAIL_DM_STATUS=422 smoke "$D" --no-hold "$SHA"
expect "--no-hold: exit 1" test "$RC" = 1
expect "--no-hold: says why it failed" has "FAILED at 3fa7eefe — step 3"
expect "--no-hold: no hold file" test ! -e "$D/state/SMOKE_FAILED"
expect "--no-hold: no alert, no comment" test ! -e "$D/alerts.log" -a ! -e "$D/gh.log"

# 5. Server text shaped like a #2093 run marker can't open a run hold.
D="$TMP/marker"
# Built at runtime so this file never contains a live marker itself.
S=start E=end
FAIL_DM_STATUS=500 FAIL_DM_BODY="{\"error\":\"boom: run 9 ${S}ed, Run M3 ${E}ed\"}" smoke "$D" "$SHA"
expect "marker: comment still carries the text" grep -q "boom: run- 9 ${S}ed, Run- M3 ${E}ed" "$D/gh.log"
expect "marker: no run marker in the comment" \
  bash -c "! grep -qiE '\\brun\\s+#?[a-z]?[0-9]+\\s+(started|ended)\\b' '$D/gh.log'"

# 6. Refused sign-in: a hold naming the sign-in; the response is never echoed.
D="$TMP/login"; LOGIN_STATUS=401 smoke "$D" "$SHA"
expect "sign-in refused: exit 1 + hold" test "$RC" = 1 -a -e "$D/state/SMOKE_FAILED"
expect "sign-in refused: alert names sign-in" in_file "step 2 (sign in as the smoke account): HTTP 401" "$D/alerts.log"

# 7. No env file: a hold, not a crash, and it says what is missing.
D="$TMP/noenv"
mkdir -p "$D/state"; RC=0
STUB_DIR="$D" CALLS="$D/calls" CURL_LOG="$D/curl.log" GH_LOG="$D/gh.log" FIXTURE_JSON="$TMP/fixture.json" \
  EXPECT_TOKEN="$TOKEN" VERSION_COMMIT="$SHA" SMOKE_CURL="$TMP/bin/curl" SMOKE_BUN="$TMP/bin/bun" \
  SMOKE_FIXTURE="$TMP/fixture.ts" SMOKE_ENV_FILE="$D/missing.env" SMOKE_VERSION_WAIT_SECONDS=0 \
  DEPLOY_STATE_DIR="$D/state" DEPLOY_ALERT_FILE="$D/alerts.log" DEPLOY_ALERTS_ENV="$TMP/none.env" \
  DEPLOY_GH_BIN="$TMP/bin/gh" bash "$SMOKE" "$SHA" > "$D/out" 2>&1 || RC=$?
OUT=$(<"$D/out")
expect "no env file: exit 1 + hold" test "$RC" = 1 -a -e "$D/state/SMOKE_FAILED"
expect "no env file: says which file" has "cannot read $D/missing.env"

# 8. The real fixture, when #2286 is on this branch and bun is installed.
if [ -r "$REAL_FIXTURE" ] && command -v bun > /dev/null; then
  D="$TMP/real"; mkdir -p "$D/state"; RC=0
  STUB_DIR="$D" CALLS="$D/calls" CURL_LOG="$D/curl.log" GH_LOG="$D/gh.log" EXPECT_TOKEN="$TOKEN" \
    VERSION_COMMIT="$SHA" SMOKE_CURL="$TMP/bin/curl" SMOKE_FIXTURE="$REAL_FIXTURE" \
    SMOKE_ENV_FILE="$TMP/smoke.env" SMOKE_VERSION_WAIT_SECONDS=0 \
    DEPLOY_STATE_DIR="$D/state" DEPLOY_ALERT_FILE="$D/alerts.log" DEPLOY_ALERTS_ENV="$TMP/none.env" \
    DEPLOY_GH_BIN="$TMP/bin/gh" bash "$SMOKE" "$SHA" > "$D/out" 2>&1 || RC=$?
  OUT=$(<"$D/out")
  expect "real fixture: smoke passes with #2286's RUN_11_INSIGHT" test "$RC" = 0
  expect "real fixture: DM row carries its rollRequests" \
    jq -es '.[1].context.rollRequests[0].formula == "1d20+6" and (.[1].message | length > 0)' "$D/db.jsonl"
else
  echo "note real fixture: not checked (needs #2286's $REAL_FIXTURE and bun)"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
