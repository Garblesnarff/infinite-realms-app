#!/usr/bin/env bash
# 422 / 5xx alarm over nginx's api-access.log (#2293). Cron: every 15 minutes.
#
# #2280's 422s were in nginx's api-access.log and nowhere else: Elysia's
# validation errors never reach the bun request log, so the one record of a
# client save the server refused on every narrative roll sat unread for a day.
#
# Each run reads the requests of the last WINDOW seconds and counts, per route
# (method + path with ids folded to :id, query dropped), 422s and 5xx. A route
# with >= 3 x 422 or >= 1 x 5xx fires. All firing routes go into ONE alert line
# (alerts.log + Slack, the auto-deploy format) and ONE comment on #2093. A route
# that fired is quiet for the next hour. It never changes anything on the box.
#
# Requests from ops/smoke.sh (user agent "infiniterealms-smoke") are left out
# of the counts and reported separately: a failing smoke already alerts and
# holds deploys itself. That needs the user agent in the log line, which the
# nginx default "combined" format has. The parser expects that format:
#   <ip> - <user> [26/Sep/2026:03:02:17 +0000] "POST /v1/... HTTP/1.1" 422 <bytes> "<referer>" "<ua>"
# If the log has lines but none parse, it alerts once an hour rather than going
# quietly blind.
#
#   http-alarm.sh
#
# Install (only on Rob's install line), e.g. /etc/cron.d/infiniterealms-http-alarm:
#   */15 * * * * root /path/to/ops/http-alarm.sh >> /var/log/infiniterealms/http-alarm.log 2>&1
# It reads ts/post_slack/emit and the DEPLOY_* alert/state/#2093 defaults out of
# the sibling auto-deploy.sh, as run-status.sh does. Overrides:
# HTTP_ALARM_DEPLOY_SCRIPT, HTTP_ALARM_LOGS, HTTP_ALARM_WINDOW_SECONDS,
# HTTP_ALARM_422_MIN, HTTP_ALARM_5XX_MIN, HTTP_ALARM_REPEAT_SECONDS,
# HTTP_ALARM_NOW (epoch; tests), plus DEPLOY_STATE_DIR, DEPLOY_ALERT_FILE,
# DEPLOY_ALERTS_ENV, DEPLOY_NOTIFY, DEPLOY_RUN_REPO, DEPLOY_RUN_ISSUE,
# DEPLOY_GH_BIN. Cases: bash ops/tests/http-alarm.sh
set -euo pipefail

DEPLOY_SCRIPT=${HTTP_ALARM_DEPLOY_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auto-deploy.sh}
[ -r "$DEPLOY_SCRIPT" ] || { echo "http-alarm.sh: cannot read $DEPLOY_SCRIPT" >&2; exit 2; }
eval "$(sed -n '/^ALERTS_ENV=/,/^NOTIFY=/p' "$DEPLOY_SCRIPT")"
eval "$(sed -n '/^RUN_ISSUE=/,/^GH_BIN=/p' "$DEPLOY_SCRIPT")"
fn_src() {
  awk -v start="$1() {" 'index($0, start) == 1 { p = 1; print; if ($0 ~ /}[[:space:]]*$/) exit; next }
    p { print; if ($0 ~ /^}/) exit }' "$DEPLOY_SCRIPT"
}
for f in ts post_slack emit; do
  eval "$(fn_src "$f")"
  declare -F "$f" > /dev/null || { echo "http-alarm.sh: $f not found in $DEPLOY_SCRIPT" >&2; exit 2; }
done

# The rotated file first: at midnight the window spans both.
LOGS=${HTTP_ALARM_LOGS:-/var/log/nginx/api-access.log.1 /var/log/nginx/api-access.log}
WINDOW=${HTTP_ALARM_WINDOW_SECONDS:-900}
MIN_422=${HTTP_ALARM_422_MIN:-3}
MIN_5XX=${HTTP_ALARM_5XX_MIN:-1}
REPEAT=${HTTP_ALARM_REPEAT_SECONDS:-3600}
NOW=${HTTP_ALARM_NOW:-$(date +%s)}
STATE="$STATE_DIR/http-alarm.state" # "<epoch last alerted>\t<route>" per line
mkdir -p "$STATE_DIR"
touch "$STATE"

files=()
for f in $LOGS; do [ -r "$f" ] && files+=("$f"); done
if [ "${#files[@]}" = 0 ]; then
  echo "$(ts) http-alarm: no readable log in: $LOGS"
  exit 0
fi

# One pass over the logs. Prints "R\t<route>\t<422s>\t<5xxs>" per route with
# either, then "T\t<in window>\t<smoke skipped>\t<parsed>\t<unparsed>".
# Plain POSIX awk (the box's is mawk): no mktime, no {n} intervals.
# shellcheck disable=SC2016
summary=$(awk -v now="$NOW" -v window="$WINDOW" '
  function days(y, m, d,   era, yoe, doy) { # days since 1970-01-01 (proleptic Gregorian)
    y -= (m <= 2); era = int(y / 400); yoe = y - era * 400
    doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
    return era * 146097 + yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy - 719468
  }
  BEGIN { split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", mn, " "); for (i = 1; i <= 12; i++) mon[mn[i]] = i }
  NF == 0 { next }
  {
    # [26/Sep/2026:03:02:17 +0000]
    if (!match($0, /\[[0-9][0-9]?\/[A-Z][a-z][a-z]\/[0-9]+:[0-9][0-9]:[0-9][0-9]:[0-9][0-9] [-+][0-9][0-9][0-9][0-9]\]/)) { bad++; next }
    t = substr($0, RSTART + 1, RLENGTH - 2)
    split(t, p, /[\/: ]/)
    if (!(p[2] in mon)) { bad++; next }
    tz = substr(p[7], 2, 2) * 3600 + substr(p[7], 4, 2) * 60
    if (substr(p[7], 1, 1) == "+") tz = -tz
    epoch = days(p[3] + 0, mon[p[2]], p[1] + 0) * 86400 + p[4] * 3600 + p[5] * 60 + p[6] + tz
    # "POST /v1/sessions/<id>/messages HTTP/1.1" 422
    rest = substr($0, RSTART + RLENGTH)
    if (!match(rest, /"[A-Z]+ [^ "]+( [^"]*)?" [0-9][0-9][0-9] /)) { bad++; next }
    req = substr(rest, RSTART + 1, RLENGTH - 1)
    parsed++
    if (epoch <= now - window || epoch > now) next
    seen++
    if (index($0, "infiniterealms-smoke") > 0) { smoke++; next }
    n = split(req, q, " ")
    status = q[n] + 0
    if (status != 422 && (status < 500 || status > 599)) next
    path = q[2]; sub(/\?.*/, "", path)
    gsub(/[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9A-Fa-f]+/, ":id", path)
    gsub(/\/[0-9]+\//, "/:n/", path); sub(/\/[0-9]+$/, "/:n", path)
    route = q[1] " " path
    if (status == 422) c422[route]++; else c5xx[route]++
    routes[route] = 1
  }
  END {
    for (r in routes) printf "R\t%s\t%d\t%d\n", r, c422[r], c5xx[r]
    printf "T\t%d\t%d\t%d\t%d\n", seen, smoke, parsed, bad
  }' "${files[@]}")

IFS=$'\t' read -r _ SEEN SMOKE PARSED BAD < <(grep '^T' <<< "$summary")

last_alert() { awk -F'\t' -v r="$1" '$2 == r { t = $1 } END { print t + 0 }' "$STATE"; }
remember() { # <route>: record an alert now, dropping lines older than REPEAT
  awk -F'\t' -v now="$NOW" -v rep="$REPEAT" -v r="$1" '$2 != r && now - $1 < rep' "$STATE" > "$STATE.tmp" || true
  printf '%s\t%s\n' "$NOW" "$1" >> "$STATE.tmp"
  mv "$STATE.tmp" "$STATE"
}

# A #2093 run marker ("run", an id, then the start/end word) gets a hyphen after
# "run": still readable, but never a marker to auto-deploy.sh's run hold.
defuse_markers() { sed -E 's/([Rr][Uu][Nn])([[:space:]]+#?[A-Za-z]?[0-9]+[[:space:]]+[A-Za-z]+)/\1-\2/g'; }

firing=() counts=() quiet=()
while IFS=$'\t' read -r kind route n422 n5xx; do
  [ "$kind" = R ] || continue
  what=()
  [ "$n422" -ge "$MIN_422" ] && what+=("${n422}×422")
  [ "$n5xx" -ge "$MIN_5XX" ] && what+=("${n5xx}×5xx")
  [ "${#what[@]}" = 0 ] && continue
  since=$(( NOW - $(last_alert "$route") ))
  if [ "$since" -lt "$REPEAT" ]; then
    quiet+=("$route ${what[*]} (alerted $(( since / 60 ))m ago)")
  else
    firing+=("$route")
    counts+=("${what[*]}")
  fi
done < <(grep '^R' <<< "$summary" | sort)

# A log that is being written but can't be read is an alarm that has gone blind.
if [ "$PARSED" = 0 ] && [ "$BAD" -gt 0 ]; then
  if [ $(( NOW - $(last_alert "(log format)") )) -ge "$REPEAT" ]; then
    emit "🔴 HTTP ALARM: cannot parse ${files[*]} ($BAD lines, none in nginx combined format); 422/5xx are NOT being watched. See ops/http-alarm.sh."
    remember "(log format)"
  fi
fi

mins=$(( WINDOW / 60 ))
echo "$(ts) http-alarm: last ${mins}m: $SEEN requests, ${#firing[@]} route(s) alerting, ${#quiet[@]} already alerted within $(( REPEAT / 60 ))m, $SMOKE smoke request(s) not counted."
for q in ${quiet[@]+"${quiet[@]}"}; do echo "$(ts) http-alarm: quiet: $q"; done
[ "${#firing[@]}" = 0 ] && exit 0

joined=""
for i in "${!firing[@]}"; do joined+="${joined:+; }${firing[$i]} ${counts[$i]}"; done
emit "🔴 HTTP ALARM: $joined in the last ${mins}m (nginx api-access.log; thresholds ${MIN_422}×422 / ${MIN_5XX}×5xx per route)."
for r in "${firing[@]}"; do remember "$r"; done

body=$( {
  echo "🔴 **HTTP alarm** — nginx \`api-access.log\`, last ${mins}m (to $(date -u -d "@$NOW" +%FT%TZ 2> /dev/null || date -u -r "$NOW" +%FT%TZ)):"
  echo
  for i in "${!firing[@]}"; do echo "- \`${firing[$i]}\`: ${counts[$i]}"; done
  echo
  echo "Thresholds: ≥${MIN_422} × 422 or ≥${MIN_5XX} × 5xx per route; each route alerts at most once an hour. ${SMOKE} smoke request(s) not counted. Nothing was changed on the box. (ops/http-alarm.sh, #2293)"
} | defuse_markers)
if ! printf '%s\n' "$body" | "$GH_BIN" issue comment "$RUN_ISSUE" --repo "$RUN_REPO" --body-file - > /dev/null 2>&1; then
  echo "$(ts) http-alarm: WARNING: could not comment on #$RUN_ISSUE (the alert line was written)."
fi
