#!/usr/bin/env bash
# Cases for ops/http-alarm.sh (#2293), with fixture nginx "combined" log lines
# and a stub `gh`: a quiet window, 3 x 422 on the #2280 route, a repeat inside
# the hour, a 5xx, smoke requests, a timezone offset, the rotated file, a log
# it cannot parse, the 24 h 4xx-rate alarm and the MCP /health probes (#350).
#
#   bash ops/tests/http-alarm.sh
#
# Needs bash + awk. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ALARM="$HERE/../http-alarm.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

printf '#!/usr/bin/env bash\n{ echo "ARGS: $*"; cat; echo "--- end"; } >> "$GH_LOG"\n' > "$TMP/gh"
chmod +x "$TMP/gh"
# Stub curl for the probes: answers the code CURL_CODES maps the URL to ("<url> <code>" lines), else 000.
printf '#!/usr/bin/env bash\nfor a; do u=$a; done\nc=$(awk -v u="$u" '"'"'$1 == u { print $2 }'"'"' "$CURL_CODES" 2> /dev/null)\nprintf %%s "${c:-000}"\n' > "$TMP/curl"
chmod +x "$TMP/curl"
: > "$TMP/none.env"

# 2026-09-26T03:10:00Z, the end of every window below unless a case moves it.
T0=1790392200
UA='"Mozilla/5.0 (Macintosh) Firefox/131.0"'
SMOKE_UA='"infiniterealms-smoke/1 (ops/smoke.sh; #2293)"'
# line <HH:MM:SS> <method> <path> <status> [ua] [tz]: one combined-format line on 26/Sep/2026.
line() {
  printf '203.0.113.9 - - [26/Sep/2026:%s %s] "%s %s HTTP/1.1" %s 187 "https://infiniterealms.app/" %s\n' \
    "$1" "${6:-+0000}" "$2" "$3" "$4" "${5:-$UA}"
}
S1=/v1/sessions/e735db3c-809b-465a-8bd1-2a51c32f6b04/messages
S2=/v1/sessions/75fddc00-862c-4a8b-a8d0-4e630aae61ec/messages

# line25 <HH:MM:SS> <method> <path> <status>: the same, on 25/Sep/2026 (the day before).
line25() { line "$@" | sed 's#26/Sep/2026#25/Sep/2026#'; }

# alarm <dir> [now]: run the real script on <dir>/access.log (+ .1), state in <dir>.
# Probes are off unless the case sets PROBES; CURL_CODES feeds the stub curl.
alarm() {
  local d=$1 now=${2:-$T0}
  mkdir -p "$d/state"
  RC=0
  HTTP_ALARM_PROBES="${PROBES:-}" HTTP_ALARM_CURL="$TMP/curl" CURL_CODES="${CURL_CODES:-/dev/null}" \
    GH_LOG="$d/gh.log" HTTP_ALARM_LOGS="$d/access.log.1 $d/access.log" HTTP_ALARM_NOW="$now" \
    DEPLOY_STATE_DIR="$d/state" DEPLOY_ALERT_FILE="$d/alerts.log" DEPLOY_ALERTS_ENV="$TMP/none.env" \
    DEPLOY_GH_BIN="$TMP/gh" DEPLOY_RUN_REPO=test/repo DEPLOY_RUN_ISSUE=2093 \
    bash "$ALARM" > "$d/out" 2>&1 || RC=$?
  OUT=$(<"$d/out")
}

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n%s\n' "$1" "$OUT"; }
expect() { local n=$1; shift; if "$@"; then ok "$n"; else bad "$n"; fi; }
has() { grep -qF -- "$1" <<< "$OUT"; }
alerts() { [ -e "$1/alerts.log" ] && grep -c 'HTTP ALARM' "$1/alerts.log" || echo 0; }
comments() { [ -e "$1/gh.log" ] && grep -c '^ARGS: issue comment 2093 --repo test/repo --body-file -$' "$1/gh.log" || echo 0; }

# 1. Quiet window: 200s, two 422s (under 3), and 422s from before the window.
D="$TMP/quiet"; mkdir -p "$D"
{
  line 02:40:00 POST "$S1" 422; line 02:41:00 POST "$S1" 422; line 02:54:59 POST "$S1" 422 # outside
  line 03:01:00 POST "$S1" 200; line 03:02:00 GET "$S1?limit=50" 200
  line 03:03:00 POST "$S1" 422; line 03:04:00 POST "$S2" 422
  line 03:05:00 GET /health 200; line 03:06:00 GET /v1/campaigns 404; line 03:07:00 GET /v1/x 499
} > "$D/access.log"
alarm "$D"
expect "quiet: exit 0" test "$RC" = 0
expect "quiet: no alert" test "$(alerts "$D")" = 0
expect "quiet: no comment" test "$(comments "$D")" = 0
expect "quiet: summary line" has "http-alarm: last 15m: 7 requests, 0 route(s) alerting"

# 2. 3 x 422 on POST /v1/sessions/:id/messages (two sessions, as in #2280): one alert.
D="$TMP/fire"; mkdir -p "$D"
{
  line 03:02:17 POST "$S1" 422; line 03:02:18 POST "$S1" 422; line 03:03:35 POST "$S2" 422
  line 03:04:00 POST "$S1" 200; line 03:05:00 GET "/v1/sessions/e735db3c-809b-465a-8bd1-2a51c32f6b04?x=1" 422
} > "$D/access.log"
alarm "$D"
expect "3x422: exit 0" test "$RC" = 0
expect "3x422: one alert line" test "$(alerts "$D")" = 1
expect "3x422: alert names the route and count" \
  grep -qF "HTTP ALARM: POST /v1/sessions/:id/messages 3×422 in the last 15m" "$D/alerts.log"
expect "3x422: a route under the threshold is not named" bash -c "! grep -q 'GET /v1/sessions/:id ' '$D/alerts.log'"
expect "3x422: one comment on #2093" test "$(comments "$D")" = 1
expect "3x422: comment names the route" grep -qF -- '- `POST /v1/sessions/:id/messages`: 3×422' "$D/gh.log"
expect "3x422: no raw session id leaves the box" bash -c "! grep -q e735db3c '$D/alerts.log' '$D/gh.log'"

# 3. Fifteen minutes later, three more: no second alert inside the hour.
{
  line 03:12:00 POST "$S1" 422; line 03:13:00 POST "$S1" 422; line 03:14:00 POST "$S1" 422
} >> "$D/access.log"
alarm "$D" $((T0 + 900))
expect "repeat in the hour: no second alert" test "$(alerts "$D")" = 1
expect "repeat in the hour: no second comment" test "$(comments "$D")" = 1
expect "repeat in the hour: says it is holding back" has "quiet: POST /v1/sessions/:id/messages 3×422 (alerted 15m ago)"
# An hour after the first alert it may fire again.
{
  line 04:05:00 POST "$S1" 422; line 04:06:00 POST "$S1" 422; line 04:07:00 POST "$S1" 422
} >> "$D/access.log"
alarm "$D" $((T0 + 3660))
expect "after the hour: alerts again" test "$(alerts "$D")" = 2

# 4. One 5xx is enough; several routes go into ONE alert and ONE comment.
D="$TMP/5xx"; mkdir -p "$D"
{
  line 03:05:00 POST /v1/llm/generate 502
  line 03:06:00 POST "$S1" 422; line 03:06:01 POST "$S1" 422; line 03:06:02 POST "$S1" 422
  line 03:07:00 GET /v1/characters/42/spells 500
} > "$D/access.log"
alarm "$D"
expect "5xx: one alert line for all routes" test "$(alerts "$D")" = 1
expect "5xx: names each route" bash -c "grep -qF 'POST /v1/llm/generate 1×5xx' '$D/alerts.log' && grep -qF 'GET /v1/characters/:n/spells 1×5xx' '$D/alerts.log' && grep -qF 'POST /v1/sessions/:id/messages 3×422' '$D/alerts.log'"
expect "5xx: one comment" test "$(comments "$D")" = 1

# 5. The smoke account's own requests are not counted, and are reported.
D="$TMP/smoke"; mkdir -p "$D"
{
  line 03:05:00 POST "$S1" 422 "$SMOKE_UA"; line 03:05:01 POST "$S1" 422 "$SMOKE_UA"
  line 03:05:02 POST "$S1" 422 "$SMOKE_UA"; line 03:05:03 POST "$S1" 422
} > "$D/access.log"
alarm "$D"
expect "smoke: no alert" test "$(alerts "$D")" = 0
expect "smoke: noted" has "3 smoke request(s) not counted"

# 6. A +0200 timestamp is converted: 05:05 +0200 is 03:05Z (in), 05:40 +0200 is 03:40Z (future, out).
D="$TMP/tz"; mkdir -p "$D"
{
  line 05:05:00 POST "$S1" 422 "$UA" +0200; line 05:05:01 POST "$S1" 422 "$UA" +0200
  line 05:05:02 POST "$S1" 422 "$UA" +0200; line 05:40:00 POST "$S2" 500 "$UA" +0200
} > "$D/access.log"
alarm "$D"
expect "tz: the in-window 422s fire" grep -qF "POST /v1/sessions/:id/messages 3×422" "$D/alerts.log"
expect "tz: the out-of-window 500 does not" bash -c "! grep -qF '3×422 1×5xx' '$D/alerts.log'"
expect "tz: only 3 requests were in the window" has "last 15m: 3 requests"

# 7. Midnight rotation: the window spans access.log.1 and access.log.
D="$TMP/rotate"; mkdir -p "$D"
{ line 03:01:00 POST "$S1" 422; line 03:02:00 POST "$S1" 422; } > "$D/access.log.1"
line 03:03:00 POST "$S1" 422 > "$D/access.log"
alarm "$D"
expect "rotation: counts across both files" grep -qF "3×422" "$D/alerts.log"

# 8. A log in a format it cannot read: one "cannot parse" alert an hour, not silence.
D="$TMP/format"; mkdir -p "$D"
printf '{"time":"2026-09-26T03:05:00Z","status":422}\n%.0s' 1 2 3 > "$D/access.log"
alarm "$D"
expect "format: alerts that it is blind" grep -qF "cannot parse" "$D/alerts.log"
alarm "$D" $((T0 + 900))
expect "format: not again inside the hour" test "$(alerts "$D")" = 1

# 9. No log at all: says so, exits 0, alerts nothing.
D="$TMP/nolog"; mkdir -p "$D"
alarm "$D"
expect "no log: exit 0 and says so" test "$RC" = 0 -a -n "$(grep 'no readable log' "$D/out")"
expect "no log: no alert" test "$(alerts "$D")" = 0

# 10. 4xx rate (#350): >= 90% 4xx of >= 20 calls in 24 h fires once a day; less does not.
C1=/v1/characters/e735db3c-809b-465a-8bd1-2a51c32f6b04/spells
C2=/v1/characters/75fddc00-862c-4a8b-a8d0-4e630aae61ec/spells
D="$TMP/rate"; mkdir -p "$D"
{
  # 18 x 400 + 2 x 200 on POST /v1/characters/:id/spells, spread over the day: 90%.
  for h in 04 06 08 10 12 14 16 18 20; do line25 "$h:00:00" POST "$C1" 400; line25 "$h:30:00" POST "$C2" 400; done
  line 01:00:00 POST "$C1" 200; line 02:00:00 POST "$C2" 200
  line25 02:00:00 POST "$C1" 400 # 25h ago: outside the 24 h window
  for i in 1 2 3; do line 01:1$i:00 OPTIONS "$C1" 400; done # preflights are not counted
  # 19 calls, all 404: under the call floor.
  for i in $(seq 10 28); do line 00:$i:00 GET /v1/blog/missing 404; done
  # 20 calls, 17 x 401: 85%, under the rate.
  for i in $(seq 10 26); do line 01:$i:00 POST /v1/auth/refresh 401; done
  for i in 27 28 29; do line 01:$i:00 POST /v1/auth/refresh 200; done
  # 20 smoke calls, all 400: not counted.
  for i in $(seq 30 49); do line 02:$i:00 GET /v1/smoke-only 400 "$SMOKE_UA"; done
} > "$D/access.log"
alarm "$D"
expect "rate: exit 0" test "$RC" = 0
expect "rate: one alert line" test "$(alerts "$D")" = 1
expect "rate: names the route, ratio and period" grep -qF "HTTP ALARM: POST /v1/characters/:id/spells 18/20×4xx in 24h" "$D/alerts.log"
expect "rate: not 'in the last 15m' (no window alarm fired)" bash -c "! grep -qF 'in the last 15m' '$D/alerts.log'"
expect "rate: under the call floor is quiet" bash -c "! grep -qF '/v1/blog/missing' '$D/alerts.log'"
expect "rate: 85% is quiet" bash -c "! grep -qF '/v1/auth/refresh' '$D/alerts.log'"
expect "rate: smoke calls are not counted" bash -c "! grep -qF '/v1/smoke-only' '$D/alerts.log'"
expect "rate: one comment, names the route" grep -qF -- '- `POST /v1/characters/:id/spells`: 18/20×4xx in 24h' "$D/gh.log"
expect "rate: no raw character id leaves the box" bash -c "! grep -q e735db3c '$D/alerts.log' '$D/gh.log'"
# Half an hour later the route is still at 90%+: no second alert inside the day.
alarm "$D" $((T0 + 1800))
expect "rate: not again inside the day" test "$(alerts "$D")" = 1
expect "rate: says it is holding back" has "quiet: POST /v1/characters/:id/spells"
# The hourly window alarms' state pruning must not forget the daily one.
line 04:05:00 POST "$S1" 500 >> "$D/access.log"
alarm "$D" $((T0 + 3600 + 300))
expect "rate: a 5xx alert an hour later fires alone" grep -qF "HTTP ALARM: POST /v1/sessions/:id/messages 1×5xx in the last 15m (" "$D/alerts.log"
alarm "$D" $((T0 + 3 * 3600))
expect "rate: still remembered after the 5xx alert pruned the state" test "$(alerts "$D")" = 2

# 11. Probes (#350): an MCP /health that is not 2xx fires once an hour, named by port.
D="$TMP/probe"; mkdir -p "$D"
line 03:05:00 GET /health 200 > "$D/access.log"
printf '%s\n' 'http://127.0.0.1:8889/health 503' 'http://127.0.0.1:8890/health 200' > "$TMP/codes"
PROBES='pearls=http://127.0.0.1:8889/health cofounder=http://127.0.0.1:8890/health' CURL_CODES="$TMP/codes" alarm "$D"
expect "probe: one alert line" test "$(alerts "$D")" = 1
expect "probe: names the server, port and status" grep -qF "HTTP ALARM: MCP pearls :8889/health HTTP 503" "$D/alerts.log"
expect "probe: a 2xx probe is not named" bash -c "! grep -qF 'cofounder' '$D/alerts.log'"
expect "probe: no host or IP leaves the box" bash -c "! grep -qF '127.0.0.1' '$D/alerts.log' '$D/gh.log'"
expect "probe: summary counts probes" has "probes 1/2 ok"
PROBES='pearls=http://127.0.0.1:8889/health cofounder=http://127.0.0.1:8890/health' CURL_CODES="$TMP/codes" alarm "$D" $((T0 + 900))
expect "probe: not again inside the hour" test "$(alerts "$D")" = 1
# Nothing answering at all is "no answer"; and probes still run with no log.
D="$TMP/probe-down"; mkdir -p "$D"
PROBES='cofounder=http://127.0.0.1:8890/health' alarm "$D"
expect "probe: no log still probes, exit 0" test "$RC" = 0
expect "probe: a dead port is 'no answer'" grep -qF "MCP cofounder :8890/health no answer" "$D/alerts.log"
# All 2xx: quiet.
D="$TMP/probe-ok"; mkdir -p "$D"
line 03:05:00 GET /health 200 > "$D/access.log"
printf '%s\n' 'http://127.0.0.1:8889/health 200' 'http://127.0.0.1:8890/health 204' > "$TMP/codes-ok"
PROBES='pearls=http://127.0.0.1:8889/health cofounder=http://127.0.0.1:8890/health' CURL_CODES="$TMP/codes-ok" alarm "$D"
expect "probe: all 2xx, no alert" test "$(alerts "$D")" = 0
expect "probe: all 2xx counted" has "probes 2/2 ok"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
