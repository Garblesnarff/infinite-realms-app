#!/usr/bin/env bash
# realms-pulse: the hands-off pipeline on Rob's phone. No model calls, $0.
#
# Runs INSIDE the realms-foreman container, started by realms-pulse.timer every
# 5 min from 12:00Z to 05:00Z (Rob's 7 AM to midnight). Reads only the GitHub
# API, prod /version and the foreman ledger (reviewer state, mounted read-only).
# Posts to PULSE_WEBHOOK_URL (Slack-style {"text": ...}):
#   - the pulse, at most 12 lines, on the :00 and :30 ticks
#   - alerts, as soon as a tick sees them, repeated at most once an hour while
#     they last: main CI red, prod /version not 200, a PASS-at-head PR waiting
#     more than 45 min, no merge in 2 h while PASS PRs wait, the foreman daily
#     cap hit. A PASS waiting more than 1 h is named as such in its alert.
#
#   pulse.sh             # tick: alerts now, the pulse on :00 / :30
#   pulse.sh --now       # post the pulse now (and alerts)
#   pulse.sh --dry-run   # print the pulse and the alerts that would post; post and record nothing
set -euo pipefail
# shellcheck source=ops/foreman/lib.sh
. "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib.sh"

REPO=${PULSE_REPO:-Garblesnarff/infinite-realms-app}
VERSION_URL=${PULSE_VERSION_URL:-https://api.infiniterealms.app/version}
OPS_ISSUE=${PULSE_DEPLOY_ISSUE:-229} # ops/smoke.sh comments "Post-deploy smoke **FAILED**" here
REVIEWER_STATE=${PULSE_REVIEWER_STATE:-/reviewer-state}
LEDGER=$REVIEWER_STATE/spend.log
TRIAGE_LOG=$REVIEWER_STATE/triage.log
DAILY_CAP_USD=${REVIEW_DAILY_CAP_USD:-5.00}
CREDIT_USD=${REVIEW_CREDIT_USD:-99}
CREDIT_START=${REVIEW_CREDIT_START:-2026-10-14}
CREDIT_END=${REVIEW_CREDIT_END:-2026-11-02}
TARGET_PER_HOUR=${REVIEW_MERGE_TARGET_PER_HOUR:-20}
PASS_WAIT_MIN=${PULSE_PASS_WAIT_MIN:-45}
NO_MERGE_MIN=${PULSE_NO_MERGE_MIN:-120}
ALERT_REPEAT_SEC=3600
STATE=${FOREMAN_WORK:-/work}/state

MODE=tick
POST=1
while [ $# -gt 0 ]; do
  case $1 in
    --now) MODE=now ;;
    --dry-run) POST=0 MODE=now ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
: "${GH_TOKEN:?GH_TOKEN missing from /etc/realms-foreman/env}"
[ "$POST" = 0 ] || : "${PULSE_WEBHOOK_URL:?PULSE_WEBHOOK_URL missing from /etc/realms-foreman/env}"
export GH_TOKEN GH_REPO=$REPO GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1

say() { echo "$(date -u +%FT%TZ) $*" >&2; }
NOW=$(date -u +%s)

# ---- pure helpers (tested by ops/tests/foreman-pulse.sh) -------------------
# lane_of <head ref>: catjam, jules, muse, codex or other
lane_of() {
  case $1 in
    catjam/*) echo catjam ;;
    lane-*) echo muse ;;
    codex/*) echo codex ;;
    jules*) echo jules ;;
    *) if [[ $1 =~ -[0-9]{15,}$ ]]; then echo jules; else echo other; fi ;;
  esac
}
# mins <seconds>: "47m" or "2h 05m"
mins() { local m=$(($1 / 60)); if [ "$m" -lt 60 ]; then echo "${m}m"; else printf '%dh %02dm\n' $((m / 60)) $((m % 60)); fi; }
# nums: "#1 #2 ..." from numbers on stdin, capped at 6, then "+N"
nums() { awk 'NF { n++; if (n <= 6) printf "%s#%s", (n > 1 ? " " : ""), $1 } END { if (n > 6) printf " +%d", n - 6 }'; }
# alert_due <key> <state file> <now>: 0 when the alert has not posted in the last hour
alert_due() {
  local last
  last=$(awk -v k="$1" '$1 == k { print $2 }' "$2" 2> /dev/null | tail -1)
  [ -z "$last" ] || [ $(($3 - last)) -ge "$ALERT_REPEAT_SEC" ]
}
# alert_mark <key> <state file> <now>: record a post; alert_clear <key> <file>: forget it
alert_mark() { { awk -v k="$1" '$1 != k' "$2" 2> /dev/null || true; echo "$1 $3"; } > "$2.new" && mv "$2.new" "$2"; }
alert_clear() { [ -e "$2" ] || return 0; awk -v k="$1" '$1 != k' "$2" > "$2.new" && mv "$2.new" "$2"; }
# pulse_due <minute>: the :00 and :30 ticks (the timer fires every 5 min)
pulse_due() { [ $((10#$1 % 30)) -lt 5 ]; }

# ---- GitHub ----------------------------------------------------------------
OWNER_LOGIN=""
# open_prs > tsv: number, head sha, head ref, verdict line at head (PASS/FIX/CLOSE/-), verdict epoch
open_prs() {
  local n sha ref verdict none=$'-\t0'
  gh api "repos/$REPO/pulls?state=open&per_page=100" --paginate \
    --jq '.[] | "\(.number)\t\(.head.sha)\t\(.head.ref)"' |
    while IFS=$'\t' read -r n sha ref; do
      verdict=$(gh api "repos/$REPO/issues/$n/comments?per_page=100" --paginate | jq -s 'add // []' |
        jq -r --arg me "$OWNER_LOGIN" --arg s8 "${sha:0:8}" "$TRUSTED_REVIEWS_JQ"' | last // empty
          | ((.body | split("\n")[0]) as $l | ($l | capture("— (?<v>PASS|FIX|CLOSE) at (?<s>[0-9a-f]{8})") // null)) as $m
          | select($m != null and $m.s == $s8) | "\($m.v)\t\(.created_at | fromdate)"')
      printf '%s\t%s\t%s\t%s\n' "$n" "$sha" "$ref" "${verdict:-$none}"
    done
}
# merged_rows: "number<TAB>merged epoch<TAB>open→merge seconds" for PRs merged in 24 h
merged_rows() {
  gh api -X GET search/issues -f q="repo:$REPO is:pr is:merged merged:>=$(date -u -d '24 hours ago' +%FT%TZ)" -f per_page=100 --paginate \
    --jq '.items[] | (.pull_request.merged_at | fromdate) as $m | [.number, $m, $m - (.created_at | fromdate)] | @tsv'
}
# queued_no_pr <label>: open issues with the label and no open PR referencing them
queued_no_pr() {
  local n
  for n in $(gh api "repos/$REPO/issues?state=open&labels=$1&per_page=50" \
    --jq '.[] | select(.pull_request | not) | select([.labels[].name] | any(IN("catjam-done","catjam-wip","needs-human","jules-stuck")) | not) | .number'); do
    [[ $n =~ ^[0-9]+$ ]] || return 1 # gh prints the error body on stdout when a call fails
    if [ -z "$(gh api "repos/$REPO/issues/$n/timeline?per_page=100" --paginate \
      --jq '.[] | select(.event == "cross-referenced" and .source.issue.pull_request != null and .source.issue.state == "open") | .source.issue.number')" ]; then
      echo "$n"
    fi
  done
}
# main_ci: "green|red|running|none <sha8> [failed workflow names]" for the push runs at main's head
main_ci() {
  local sha
  sha=$(gh api "repos/$REPO/commits/main" --jq .sha) || return 1
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || return 1
  gh api "repos/$REPO/actions/runs?head_sha=$sha&event=push&per_page=50" --jq '.workflow_runs' |
    jq -r --arg s8 "${sha:0:8}" '
      [.[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "startup_failure") | .name] as $red
      | if ($red | length) > 0 then "red \($s8) \($red | unique | join(", "))"
        elif any(.[]; .status != "completed") then "running \($s8)"
        elif length == 0 then "none \($s8)"
        else "green \($s8)" end'
}
# last_smoke_fail: "<epoch> <first line>" of the newest smoke FAILED comment on the ops issue in 7 days
last_smoke_fail() {
  gh api "repos/$REPO/issues/$OPS_ISSUE/comments?per_page=100&since=$(date -u -d '7 days ago' +%FT%TZ)" --paginate \
    --jq '.[] | select(.body | test("Post-deploy smoke \\*\\*FAILED\\*\\*")) | "\(.created_at | fromdate) \(.body | split("\n")[0])"' | tail -1
}

# ---- ledger ----------------------------------------------------------------
spent_today() { awk -v d="$(date -u +%F)" '$2 == d { s += $4 } END { printf "%.2f", s + 0 }' "$LEDGER" 2> /dev/null || echo "?"; }
credit_line() {
  awk -v cs="$CREDIT_START" -v credit="$CREDIT_USD" -v ce="$CREDIT_END" \
    -v days="$(( ($(date -u -d "$CREDIT_END" +%s) - $(date -u -d "$(date -u +%F)" +%s)) / 86400 ))" \
    '$2 >= cs { c += $4 } END { printf "credit $%.2f left, %d days to %s", credit - c, days, ce }' "$LEDGER" 2> /dev/null || echo "ledger unreadable"
}
triage_line() {
  [ -r "$TRIAGE_LOG" ] || { echo "Triage: no runs yet"; return 0; }
  awk -v s="$(date -u -d '24 hours ago' +%FT%TZ)" '$1 >= s && $2 == "run" && !/ dry-run/ {
      for (i = 3; i <= NF; i++) { split($i, kv, "="); v[kv[1]] += kv[2] } runs++ }
    END { printf "Triage 24 h: triaged %d → catjam %d, jules %d, crew %d (%d runs)\n", v["triaged"], v["catjam"], v["jules"], v["crew"], runs }' "$TRIAGE_LOG"
}

# ---- post ------------------------------------------------------------------
post() { # text on stdin; the webhook URL never appears on a command line
  if [ "$POST" = 0 ]; then cat; echo; return 0; fi
  jq -Rs '{text: .}' | curl -fsS -m 20 -o /dev/null -H 'Content-Type: application/json' \
    --data-binary @- -K <(printf 'url = "%s"\n' "$PULSE_WEBHOOK_URL")
}
# post_and_mark <state file> <now> <key>...: post stdin; mark the keys as sent only
# when the post succeeded, so a failed post retries on the next tick
post_and_mark() {
  local afile=$1 now=$2 k; shift 2
  post || return 1
  [ "$POST" = 0 ] && return 0
  for k in "$@"; do alert_mark "$k" "$afile" "$now"; done
}

main() {
  mkdir -p "$STATE"
  exec 9> "$STATE/pulse.lock"
  if ! flock -n 9; then say "another pulse.sh holds the lock; exiting"; exit 0; fi
  local prs="" prs_ok=1 merged ci vstatus vjson vshort vbuilt smoke spent post_failed=0
  # A GitHub failure here must not stop the tick: the /version, CI and cap alerts
  # still run, and only the PR-based checks are skipped.
  if OWNER_LOGIN=$(gh api user --jq .login) && [ -n "$OWNER_LOGIN" ]; then
    prs=$(open_prs) || { prs=""; prs_ok=0; say "open PR list failed"; }
  else
    OWNER_LOGIN=""; prs_ok=0; say "GitHub user lookup failed; PR checks skipped"
  fi
  merged=$(merged_rows) || merged=FAILED
  ci=$(main_ci) || ci="unknown"
  vjson=$(curl -sS -m 10 -w '\n%{http_code}' "$VERSION_URL" 2> /dev/null) || true
  vstatus=$(tail -1 <<< "$vjson"); [[ $vstatus =~ ^[0-9]{3}$ ]] || vstatus=000
  vshort=$(sed '$d' <<< "$vjson" | jq -r '.short // "?"' 2> /dev/null || echo "?")
  vbuilt=$(sed '$d' <<< "$vjson" | jq -r '(.builtAt // "") | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601? // empty' 2> /dev/null || true)
  smoke=$(last_smoke_fail) && [[ -z $smoke || $smoke =~ ^[0-9]+\  ]] || smoke=FAILED
  spent=$(spent_today)

  # Waiting: verdicts at head, release-please left out (it needs only green CI).
  local work pass_rows pass_n oldest=0 nov fix
  work=$(awk -F'\t' '$3 !~ /^release-please--/' <<< "$prs")
  pass_rows=$(awk -F'\t' -v now="$NOW" '$4 == "PASS" { print $1 "\t" now - $5 }' <<< "$work" | sort -t$'\t' -k2,2nr)
  pass_n=$(awk 'NF' <<< "$pass_rows" | wc -l)
  [ "$pass_n" = 0 ] || oldest=$(awk -F'\t' 'NR == 1 { print $2 }' <<< "$pass_rows")
  nov=$(awk -F'\t' '$4 == "-" { print $1 }' <<< "$work")
  fix=$(awk -F'\t' '$4 == "FIX" { print $1 }' <<< "$work")

  local last_merge=0 m1=0 m24=0 med=n/a
  if [ "$merged" != FAILED ]; then
    m24=$(awk 'NF' <<< "$merged" | wc -l)
    m1=$(awk -F'\t' -v t=$((NOW - 3600)) 'NF && $2 >= t' <<< "$merged" | wc -l)
    last_merge=$(awk -F'\t' 'NF && $2 > m { m = $2 } END { print m + 0 }' <<< "$merged")
    med=$(awk -F'\t' 'NF { print $3 }' <<< "$merged" | sort -n | awk '{ a[NR] = $1 } END { if (NR == 0) print "n/a"; else { m = (NR % 2) ? a[(NR + 1) / 2] : (a[NR / 2] + a[NR / 2 + 1]) / 2; print int(m) } }')
    [ "$med" = n/a ] || med=$(mins "$med")
  fi

  # ---- alerts ----
  local alerts=() keys=() k
  if [[ $ci == red* ]]; then keys+=(main-ci-red); alerts+=("🔴 main CI red at ${ci#red }"); fi
  if [ "$vstatus" != 200 ]; then keys+=(version-down); alerts+=("🔴 prod /version returned HTTP $vstatus"); fi
  if [ "$pass_n" -gt 0 ] && [ "$oldest" -ge $((PASS_WAIT_MIN * 60)) ]; then
    keys+=(pass-wait)
    alerts+=("🟠 merger idle: PASS waiting $(awk -F'\t' -v l=$((PASS_WAIT_MIN * 60)) '$2 >= l { printf "%s#%s %s%s", (n++ ? ", " : ""), $1, int($2 / 60) "m", ($2 >= 3600 ? " (over 1 h)" : "") }' <<< "$pass_rows")")
  fi
  if [ "$pass_n" -gt 0 ] && [ "$merged" != FAILED ] && [ $((NOW - last_merge)) -ge $((NO_MERGE_MIN * 60)) ]; then
    keys+=(no-merge); alerts+=("🟠 no merge in $(mins $((NOW - last_merge < 86400 ? NOW - last_merge : 86400)))+ while $pass_n PASS PR(s) wait")
  fi
  if [ "$spent" != "?" ] && awk -v a="$spent" -v b="$DAILY_CAP_USD" 'BEGIN { exit !(a >= b) }'; then
    keys+=(cap-hit); alerts+=("🟠 foreman daily cap hit: \$$spent of \$$DAILY_CAP_USD")
  fi
  local afile=$STATE/alerts.state i out=() due=()
  for k in main-ci-red version-down pass-wait no-merge cap-hit; do
    # Without the PR list the PASS alerts are unknown, not cleared.
    if [ "$prs_ok" = 0 ] && { [ "$k" = pass-wait ] || [ "$k" = no-merge ]; }; then continue; fi
    [[ " ${keys[*]} " == *" $k "* ]] || { [ "$POST" = 0 ] || alert_clear "$k" "$afile"; }
  done
  for i in "${!keys[@]}"; do
    if alert_due "${keys[$i]}" "$afile" "$NOW"; then
      out+=("${alerts[$i]}"); due+=("${keys[$i]}")
    fi
  done
  if [ "${#out[@]}" -gt 0 ]; then
    if { echo "Realms ALERT $(date -u +%H:%MZ)"; printf '%s\n' "${out[@]}"; } | head -12 | post_and_mark "$afile" "$NOW" "${due[@]}"; then
      [ "$POST" = 0 ] || say "alerts posted: ${due[*]}"
    else
      say "alert post failed: ${due[*]}"; post_failed=1
    fi
  fi

  # ---- pulse ----
  if [ "$MODE" = tick ] && ! pulse_due "$(date -u +%M)"; then return "$post_failed"; fi
  local lanes l ln queued_c queued_j smoke_txt built_txt
  lanes=$(for l in catjam jules muse codex other; do
    ln=$(awk -F'\t' '{ print $1 "\t" $3 }' <<< "$prs" | while IFS=$'\t' read -r n ref; do [ -n "$n" ] && [ "$(lane_of "$ref")" = "$l" ] && echo "$n"; done || true)
    printf '%s %d' "$l" "$(awk 'NF' <<< "$ln" | wc -l)"
    [ -z "$ln" ] || printf ' (%s)' "$(nums <<< "$ln")"
    printf ' · '
  done | sed 's/ · $//')
  queued_c=$(queued_no_pr catjam || true)
  queued_j=$(queued_no_pr jules || true)
  if [ "$smoke" = FAILED ]; then smoke_txt="smoke check failed (GitHub)"; elif [ -n "$smoke" ]; then smoke_txt="last smoke FAILED comment $(mins $((NOW - ${smoke%% *}))) ago on #$OPS_ISSUE"; else smoke_txt="no smoke FAILED on #$OPS_ISSUE in 7 d"; fi
  if [ -n "$vbuilt" ]; then built_txt=", built $(mins $((NOW - vbuilt))) ago"; else built_txt=""; fi
  {
    echo "Realms pulse $(date -u +%H:%MZ)"
    if [ "$merged" = FAILED ]; then echo "Merged: GitHub search failed"; else
      echo "Merged: $m1 last hour / $m24 in 24 h (target $TARGET_PER_HOUR/hour); median open→merge $med"; fi
    if [ "$prs_ok" = 0 ]; then echo "Open PRs: GitHub PR list failed"; else
    echo "PASS at head, not merged: $pass_n$([ "$pass_n" = 0 ] || echo " ($(awk -F'\t' '{ print $1 }' <<< "$pass_rows" | nums); oldest $(mins "$oldest"))")"
    echo "No verdict at head: $(awk 'NF' <<< "$nov" | wc -l)$([ -z "$nov" ] || echo " ($(nums <<< "$nov"))") · FIX on authors: $(awk 'NF' <<< "$fix" | wc -l)$([ -z "$fix" ] || echo " ($(nums <<< "$fix"))")"
    echo "Open PRs: $lanes"; fi
    echo "Queued, no PR: catjam $(awk 'NF' <<< "$queued_c" | wc -l)$([ -z "$queued_c" ] || echo " ($(nums <<< "$queued_c"))") · jules $(awk 'NF' <<< "$queued_j" | wc -l)$([ -z "$queued_j" ] || echo " ($(nums <<< "$queued_j"))")"
    echo "Main CI: $ci"
    echo "Prod: /version $vstatus, build $vshort$built_txt; $smoke_txt"
    echo "Foreman: \$$spent of \$$DAILY_CAP_USD today; $(credit_line)"
    triage_line
    if [ "${#keys[@]}" -gt 0 ]; then echo "Alerts open: ${keys[*]}"; else echo "Alerts open: none"; fi
  } | head -12 | post || { say "pulse post failed"; post_failed=1; }
  [ "$POST" = 0 ] || [ "$post_failed" = 1 ] || say "pulse posted"
  return "$post_failed" # a failed post marks the unit failed; --dry-run never posts
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main; fi
