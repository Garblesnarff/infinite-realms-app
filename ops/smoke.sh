#!/usr/bin/env bash
# Post-deploy smoke test that holds deploys (#2293).
#
# #2250 shipped a client save that the server refused (422) on every narrative
# roll, and nothing on prod noticed for a day (#2280): no step after a deploy
# ever wrote a message. This does, as a dedicated smoke account, with no LLM
# call — so it is free and deterministic:
#
#   1. GET /version reports the commit just deployed (polled while pm2 starts).
#   2. Sign in, create a throwaway campaign + session, save a player message.
#   3. Save a DM reply with rollRequests in context and non-empty text — the
#      exact #2280 wire body, taken from #2286's shared fixture
#      shared/test-fixtures/dm-roll-reply-saves.ts (RUN_11_INSIGHT.wireBody),
#      so the smoke and the route tests share one source.
#   4. Save the player's roll-result message.
#   5. Read the history back: 3 rows, in order, text intact, rollRequests kept.
#   6. Delete the campaign (cascades to the session and its messages) and check
#      the session is gone.
#
# On any failure: one alert line (alerts.log + Slack, the auto-deploy format),
# one comment on #2093 naming the step and HTTP status, and the hold file
# $STATE_DIR/SMOKE_FAILED, which makes auto-deploy.sh deploy nothing more until
# a human removes it. It never rolls back. The failed campaign is left in place
# for inspection; the next passing run sweeps it.
#
#   smoke.sh [--no-hold] [<expected commit>]
#
# auto-deploy.sh runs it right after "Deploy complete", only when the env file
# exists. <expected commit> defaults to HEAD of the app checkout. --no-hold is
# for an operator trying it by hand: it reports and exits 1 on failure, but
# writes no hold, alert or comment.
#
# The env file ($SMOKE_ENV_FILE, default /etc/infiniterealms/smoke.env, root
# 0600) holds SMOKE_EMAIL and SMOKE_PASSWORD for the dedicated smoke account.
# Neither they nor the access token are ever printed, put on a command line
# (visible in ps) or written anywhere but a 0600 temp dir removed on exit.
#
# ts, post_slack and emit, and the DEPLOY_* alert/state/#2093 defaults, are read
# out of the sibling auto-deploy.sh (as run-status.sh does), so the alert format
# and the overrides are the cron's own. Overrides: SMOKE_DEPLOY_SCRIPT,
# SMOKE_ENV_FILE, SMOKE_API_BASE, SMOKE_APP_DIR, SMOKE_FIXTURE, SMOKE_BUN,
# SMOKE_CURL, SMOKE_VERSION_WAIT_SECONDS, SMOKE_POLL_SECONDS,
# DEPLOY_SMOKE_HOLD_FILE, plus the cron's DEPLOY_STATE_DIR, DEPLOY_ALERT_FILE,
# DEPLOY_ALERTS_ENV, DEPLOY_NOTIFY, DEPLOY_RUN_REPO, DEPLOY_RUN_ISSUE, DEPLOY_GH_BIN.
# Cases: bash ops/tests/smoke.sh
set -euo pipefail

NO_HOLD=0
EXPECTED=""
for arg in "$@"; do
  case "$arg" in
    --no-hold) NO_HOLD=1 ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "smoke.sh: unknown option: $arg" >&2
      exit 2
      ;;
    *) EXPECTED=$arg ;;
  esac
done

DEPLOY_SCRIPT=${SMOKE_DEPLOY_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auto-deploy.sh}
[ -r "$DEPLOY_SCRIPT" ] || { echo "smoke.sh: cannot read $DEPLOY_SCRIPT" >&2; exit 2; }
eval "$(sed -n '/^ALERTS_ENV=/,/^NOTIFY=/p' "$DEPLOY_SCRIPT")"
eval "$(sed -n '/^RUN_ISSUE=/,/^GH_BIN=/p' "$DEPLOY_SCRIPT")"
# A function body runs from "name() {" to the next line starting "}", or is the
# one line itself ("ts() { …; }").
fn_src() {
  awk -v start="$1() {" 'index($0, start) == 1 { p = 1; print; if ($0 ~ /}[[:space:]]*$/) exit; next }
    p { print; if ($0 ~ /^}/) exit }' "$DEPLOY_SCRIPT"
}
for f in ts post_slack emit; do
  eval "$(fn_src "$f")"
  declare -F "$f" > /dev/null || { echo "smoke.sh: $f not found in $DEPLOY_SCRIPT" >&2; exit 2; }
done

ENV_FILE=${SMOKE_ENV_FILE:-/etc/infiniterealms/smoke.env}
API=${SMOKE_API_BASE:-https://api.infiniterealms.app}
APP_DIR=${SMOKE_APP_DIR:-/var/www/infiniterealms/ai-adventure-scribe-main}
FIXTURE=${SMOKE_FIXTURE:-$APP_DIR/shared/test-fixtures/dm-roll-reply-saves.ts}
BUN=${SMOKE_BUN:-bun}
CURL=${SMOKE_CURL:-curl}
VERSION_WAIT=${SMOKE_VERSION_WAIT_SECONDS:-120}
POLL=${SMOKE_POLL_SECONDS:-5}
HOLD_FILE=${DEPLOY_SMOKE_HOLD_FILE:-$STATE_DIR/SMOKE_FAILED}
# ops/http-alarm.sh drops requests with this user agent from its counts.
UA="infiniterealms-smoke/1 (ops/smoke.sh; #2293)"
# Campaigns this script owns carry this prefix; a passing run deletes any left over.
NAME_PREFIX="ops smoke"

[ -n "$EXPECTED" ] || EXPECTED=$(git -C "$APP_DIR" rev-parse HEAD 2> /dev/null || echo "")
SHORT=${EXPECTED:0:8}

WORK=$(mktemp -d)
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
AUTH="$WORK/auth.hdr" # "Authorization: Bearer …", passed to curl as -H @file
: > "$AUTH"

say() { echo "$(ts) smoke: $*"; }

# fail <step label> <http status or -> <detail>. Reports once, holds, exits 1.
fail() {
  local step=$1 status=$2 detail=$3 when line
  when=$(date -u +%FT%TZ)
  line="step $step: ${status:+HTTP $status — }$detail"
  say "FAILED at ${SHORT:-?} — $line"
  if [ "$NO_HOLD" = 1 ]; then
    say "--no-hold: no hold file, alert or comment."
    exit 1
  fi
  if [ -e "$HOLD_FILE" ]; then
    say "$HOLD_FILE already exists; not alerting again."
    exit 1
  fi
  mkdir -p "$(dirname "$HOLD_FILE")"
  echo "$when smoke failed at ${EXPECTED:-unknown} — $line" > "$HOLD_FILE"
  # auto-deploy.sh's hold block calls `record_state smoke fail` every tick while
  # the file exists. Seed its state as "just notified", so the alert below is
  # the only one now and the cron's hourly reminder takes over from here.
  local now; now=$(date +%s)
  echo "fail $now $now" > "$STATE_DIR/smoke.state" 2> /dev/null || true
  emit "🔴 DEPLOY FAILED: smoke — $line (at ${SHORT:-unknown}). Deploys are HELD by $HOLD_FILE until a human removes it; nothing was rolled back."
  # One comment on the ops issue. The body is built only from fixed text, the
  # step, the status and the server's short error string, and marker-shaped
  # words are stripped from the latter: #2093's comments drive the run hold.
  local body
  body=$(printf '%s\n\n- Step: %s\n- HTTP status: %s\n- Detail: %s\n\n%s\n' \
    "🔴 Post-deploy smoke **FAILED** at \`${EXPECTED:-unknown}\` ($when)." \
    "$step" "${status:-n/a}" "$(printf '%s' "$detail" | defuse_markers)" \
    "Deploys are held: \`$HOLD_FILE\` exists, and ops/auto-deploy.sh will deploy nothing until a human removes it. Nothing was rolled back. (ops/smoke.sh, #2293)")
  if ! printf '%s' "$body" | "$GH_BIN" issue comment "$RUN_ISSUE" --repo "$RUN_REPO" --body-file - > /dev/null 2>&1; then
    say "WARNING: could not comment on #$RUN_ISSUE (the hold file and alert line are in place)."
  fi
  exit 1
}

# A #2093 run marker ("run", an id, then the start/end word) gets a hyphen after
# "run": still readable, but no longer a marker to auto-deploy.sh's open_run
# regex, which needs whitespace straight after "run".
defuse_markers() { sed -E 's/([Rr][Uu][Nn])([[:space:]]+#?[A-Za-z]?[0-9]+[[:space:]]+[A-Za-z]+)/\1-\2/g'; }

# api <method> <path> [<request body file>]: sets STATUS, response in $WORK/res.
# A connection failure is status 000.
api() {
  local method=$1 path=$2 data=${3:-}
  local args=(-sS -m 20 -o "$WORK/res" -w '%{http_code}' -X "$method" -A "$UA"
    -H 'Accept: application/json' -H @"$AUTH")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data-binary @"$data")
  : > "$WORK/res"
  STATUS=$("$CURL" "${args[@]}" "$API$path" 2> "$WORK/curl.err") || true
  STATUS=${STATUS:-000}
}

# The server's own short reason (#2286 makes a 422 say which rule failed), never
# the request or the whole body.
reason() {
  jq -r '[.error // empty, ((.issues // [])[] | "\(.path // "") \(.message // "")")] | join("; ")' \
    < "$WORK/res" 2> /dev/null | head -c 300 || true
}

expect_status() { # <step> <wanted…>
  local step=$1; shift
  local w
  for w in "$@"; do [ "$STATUS" = "$w" ] && return 0; done
  local r; r=$(reason)
  [ "$STATUS" = 000 ] && r="no response ($(head -c 200 "$WORK/curl.err" | tr '\n' ' '))"
  fail "$step" "$STATUS" "${r:-unexpected status (wanted $*)}"
}

uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid; else uuidgen | tr 'A-F' 'a-f'; fi
}

S1="1 (GET /version reports the deployed commit)"
S2="2 (save the player message)"
S2A="2 (sign in as the smoke account)"
S2B="2 (create the smoke campaign and session)"
S3="3 (save the DM reply with rollRequests — the #2280 wire body)"
S4="4 (save the roll-result message)"
S5="5 (read the history back: 3 rows, in order, text intact)"
S6="6 (delete the smoke campaign and session)"

[ -n "$EXPECTED" ] || fail "$S1" "" "no expected commit (pass one, or SMOKE_APP_DIR must be a git checkout)"
say "checking ${SHORT} against $API"

# --- fixture ---------------------------------------------------------------
# One source for the smoke and the route tests. A missing or changed fixture is
# a failure: without it this cannot check the shape that broke.
[ -r "$FIXTURE" ] || fail "3" "" "fixture $FIXTURE not found (#2286 must be merged before this runs)"
if ! SMOKE_FIXTURE_PATH="$FIXTURE" "$BUN" -e \
  'const m = await import(process.env.SMOKE_FIXTURE_PATH); process.stdout.write(JSON.stringify(m.RUN_11_INSIGHT ?? null))' \
  > "$WORK/fixture.json" 2> "$WORK/bun.err" ||
  ! jq -e '(.playerInput | length > 0) and (.wireBody.message | length > 0)
           and (.wireBody.speaker_type == "dm") and (.wireBody.context.rollRequests | length > 0)' \
    "$WORK/fixture.json" > /dev/null 2>&1; then
  fail "3" "" "could not read RUN_11_INSIGHT from $FIXTURE"
fi

# --- 1. /version --------------------------------------------------------------
deadline=$(( $(date +%s) + VERSION_WAIT ))
while :; do
  api GET /version
  LIVE=""
  [ "$STATUS" = 200 ] && LIVE=$(jq -r '.commit // empty' < "$WORK/res" 2> /dev/null || true)
  [ "$LIVE" = "$EXPECTED" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    if [ "$STATUS" = 200 ]; then
      fail "$S1" 200 "version mismatch: live ${LIVE:-none}, expected $EXPECTED"
    fi
    expect_status "$S1" 200
  fi
  sleep "$POLL"
done
say "step 1 ok: /version is ${SHORT}"

# --- 2. sign in, campaign, session, player message ---------------------------
[ -r "$ENV_FILE" ] || fail "$S2A" "" "cannot read $ENV_FILE"
# Sourced in a subshell that writes only the request body (0600, in $WORK).
(
  umask 077
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ] || exit 1
  SMOKE_EMAIL=$SMOKE_EMAIL SMOKE_PASSWORD=$SMOKE_PASSWORD \
    jq -n '{email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD}' > "$WORK/login.json"
) || fail "$S2A" "" "$ENV_FILE must set SMOKE_EMAIL and SMOKE_PASSWORD"
api POST /v1/auth/password-login "$WORK/login.json"
rm -f "$WORK/login.json"
# The response carries the tokens: never echo it, only its status.
[ "$STATUS" = 200 ] || { : > "$WORK/res"; fail "$S2A" "$STATUS" "sign-in refused"; }
(umask 077; jq -r '"Authorization: Bearer " + (.accessToken // "")' < "$WORK/res" > "$AUTH")
: > "$WORK/res"
grep -q 'Bearer .' "$AUTH" || fail "$S2A" 200 "no access token in the sign-in response"

# Sweep campaigns an earlier failed run left for inspection. Best-effort.
api GET /v1/campaigns
if [ "$STATUS" = 200 ]; then
  jq -r --arg p "$NAME_PREFIX" '.[]? | select((.name // "") | startswith($p)) | .id' < "$WORK/res" |
    while read -r old; do
      api DELETE "/v1/campaigns/$old"
      say "swept leftover smoke campaign $old (HTTP $STATUS)"
    done
fi

jq -n --arg n "$NAME_PREFIX ${SHORT} $(date -u +%FT%TZ)" \
  '{name: $n, description: "Post-deploy smoke (#2293). Deleted by ops/smoke.sh."}' > "$WORK/req.json"
api POST /v1/campaigns "$WORK/req.json"
expect_status "$S2B" 200 201
CAMPAIGN=$(jq -r '.id // empty' < "$WORK/res")
[ -n "$CAMPAIGN" ] || fail "$S2B" "$STATUS" "campaign response has no id"
jq -n --arg c "$CAMPAIGN" '{campaign_id: $c}' > "$WORK/req.json"
api POST /v1/sessions "$WORK/req.json"
expect_status "$S2B" 200 201
SESSION=$(jq -r '.id // empty' < "$WORK/res")
[ -n "$SESSION" ] || fail "$S2B" "$STATUS" "session response has no id"
say "campaign $CAMPAIGN, session $SESSION"

P_ID=$(uuid) D_ID=$(uuid) R_ID=$(uuid)
T0=$(date +%s)
at() { jq -nr --argjson e "$((T0 + $1))" '$e | todate'; }
jq --arg id "$P_ID" --arg ts "$(at 0)" \
  '{id: $id, speaker_type: "player", message: .playerInput, context: {}, timestamp: $ts}' \
  "$WORK/fixture.json" > "$WORK/player.json"
api POST "/v1/sessions/$SESSION/messages" "$WORK/player.json"
expect_status "$S2" 200 201
say "step 2 ok: player message saved"

# --- 3. the DM reply with rollRequests (#2280) ------------------------------
# Only the id and timestamp change, so every run writes a fresh row.
jq --arg id "$D_ID" --arg ts "$(at 1)" '.wireBody + {id: $id, timestamp: $ts}' \
  "$WORK/fixture.json" > "$WORK/dm.json"
api POST "/v1/sessions/$SESSION/messages" "$WORK/dm.json"
expect_status "$S3" 200 201
say "step 3 ok: DM reply with rollRequests saved"

# --- 4. the roll result ---------------------------------------------------
jq --arg id "$R_ID" --arg ts "$(at 2)" '
  .rollRequests[0] as $r
  | {id: $id, speaker_type: "player", timestamp: $ts,
     message: "\($r.purpose | split(" ")[0]) check: \($r.formula) = 17\(if $r.dc then " vs DC \($r.dc)" else "" end)",
     context: {intent: "dice_roll",
               diceRoll: {formula: $r.formula, total: 17, naturalRoll: 11, requestType: $r.type,
                          description: $r.purpose, dc: $r.dc, timestamp: $ts}}}' \
  "$WORK/fixture.json" > "$WORK/roll.json"
api POST "/v1/sessions/$SESSION/messages" "$WORK/roll.json"
expect_status "$S4" 200 201
say "step 4 ok: roll result saved"

# --- 5. read back ----------------------------------------------------------
api GET "/v1/sessions/$SESSION/messages?limit=10"
expect_status "$S5" 200
if ! GOT=$(jq -r --slurpfile p "$WORK/player.json" --slurpfile d "$WORK/dm.json" --slurpfile r "$WORK/roll.json" '
  (.messages // []) as $m
  | if ($m | length) != 3 then "\($m | length) rows, wanted 3"
    elif ([$m[].id] != [$p[0].id, $d[0].id, $r[0].id]) then "rows out of order or ids changed"
    elif ([$m[].message] != [$p[0].message, $d[0].message, $r[0].message]) then "message text changed on the way back"
    elif ($m[1].context.rollRequests != $d[0].context.rollRequests) then "the DM row lost its rollRequests"
    else "ok" end' < "$WORK/res" 2> /dev/null); then
  GOT="response is not the expected JSON"
fi
[ "$GOT" = ok ] || fail "$S5" 200 "$GOT"
say "step 5 ok: 3 rows read back in order"

# --- 6. clean up -------------------------------------------------------------
api DELETE "/v1/campaigns/$CAMPAIGN"
expect_status "$S6" 200 204
api GET "/v1/sessions/$SESSION/messages?limit=1"
[ "$STATUS" = 404 ] || fail "$S6" "$STATUS" "session $SESSION still readable after deleting its campaign"
say "step 6 ok: campaign and session deleted"

say "PASS at ${SHORT}"
