#!/usr/bin/env bash
# Cases for the pure helpers in ops/foreman/pulse.sh: lanes, durations, the
# :00/:30 pulse slot and the once-an-hour alert repeat.
#
#   bash ops/tests/foreman-pulse.sh
#
# Needs only bash + awk. No network: pulse.sh runs main only when executed.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GH_TOKEN=x
# shellcheck source=ops/foreman/pulse.sh
. "$HERE/../foreman/pulse.sh" --dry-run
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0 fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass + 1)); echo "ok   $1"; else fail=$((fail + 1)); echo "FAIL $1 (want '$3', got '$2')"; fi; }

check "lane: catjam/" "$(lane_of catjam/640-cleanup)" catjam
check "lane: jules/ prefix" "$(lane_of jules/server-dead-exports-3-10528163643105612220)" jules
check "lane: jules- prefix" "$(lane_of jules-14840482024995241673-09d9d594)" jules
check "lane: Jules long numeric suffix" "$(lane_of chore/vtt-cleanup-616-5490047820006626122)" jules
check "lane: lane-* is Muse" "$(lane_of lane-b/campaign-art)" muse
check "lane: codex/" "$(lane_of codex/fix-463)" codex
check "lane: hand-made" "$(lane_of fix/463-inventory-sheet-mirror)" other
check "lane: release-please" "$(lane_of release-please--branches--main--components--infinite-realms-app)" other

check "mins: under an hour" "$(mins 2820)" 47m
check "mins: over an hour" "$(mins 7500)" "2h 05m"

for m in 00 03 04 30 34; do pulse_due "$m" && r=yes || r=no; check "pulse_due :$m" "$r" yes; done
for m in 05 15 29 35 55; do pulse_due "$m" && r=yes || r=no; check "pulse_due :$m" "$r" no; done

f=$TMP/alerts.state
alert_due main-ci-red "$f" 1000 && r=yes || r=no; check "alert: first sighting posts" "$r" yes
alert_mark main-ci-red "$f" 1000
alert_due main-ci-red "$f" 4599 && r=yes || r=no; check "alert: not again within the hour" "$r" no
alert_due main-ci-red "$f" 4600 && r=yes || r=no; check "alert: repeats after an hour" "$r" yes
alert_due pass-wait "$f" 1001 && r=yes || r=no; check "alert: keys are independent" "$r" yes
alert_mark pass-wait "$f" 1001
alert_mark main-ci-red "$f" 4600
check "alert: one row per key" "$(wc -l < "$f" | tr -d ' ')" 2
alert_clear main-ci-red "$f"
alert_due main-ci-red "$f" 4601 && r=yes || r=no; check "alert: cleared key posts at once next time" "$r" yes
alert_due pass-wait "$f" 1500 && r=yes || r=no; check "alert: clearing one key keeps the other" "$r" no

# post_and_mark: an alert counts as sent only after the post succeeds
g=$TMP/post.state
POST=1
post() { cat > /dev/null; return 1; }
echo x | post_and_mark "$g" 1000 main-ci-red && r=ok || r=failed
check "post_and_mark: failed post returns 1" "$r" failed
alert_due main-ci-red "$g" 1060 && r=yes || r=no; check "post_and_mark: failed post leaves the alert due" "$r" yes
post() { cat > /dev/null; }
echo x | post_and_mark "$g" 1000 main-ci-red cap-hit && r=ok || r=failed
check "post_and_mark: good post returns 0" "$r" ok
alert_due cap-hit "$g" 1060 && r=yes || r=no; check "post_and_mark: good post marks every key" "$r" no
POST=0
# main end to end: GitHub down (every gh call fails), /version 503, then the post fails or works
run_main() { # run_main <post rc>: exit status of main; state in $TMP/main
  (
    STATE=$TMP/main POST=1 MODE=now PULSE_WEBHOOK_URL=http://127.0.0.1:9/ LEDGER=$TMP/none TRIAGE_LOG=$TMP/none
    gh() { echo '{"message":"Server Error"}'; return 1; }
    curl() { printf '{}\n503'; }
    post() { cat > /dev/null; return "$POST_RC"; }
    POST_RC=$1 main
  ) 2> "$TMP/main.err"
}
rm -rf "$TMP/main"; run_main 1 && r=0 || r=$?
check "main: GitHub down + failed post exits 1" "$r" 1
grep -q 'version-down' "$TMP/main/alerts.state" 2> /dev/null && r=marked || r=unmarked
check "main: failed post leaves version-down unmarked" "$r" unmarked
grep -q 'PR checks skipped' "$TMP/main.err" && r=yes || r=no; check "main: owner lookup failure skips only the PR checks" "$r" yes
run_main 0 && r=0 || r=$?
check "main: GitHub down + good post exits 0" "$r" 0
grep -q 'version-down' "$TMP/main/alerts.state" 2> /dev/null && r=marked || r=unmarked
check "main: good post marks version-down" "$r" marked
# user lookup works, the open PR list fails: the tick goes on and /version still alerts
rm -rf "$TMP/main"
(
  STATE=$TMP/main POST=1 MODE=now PULSE_WEBHOOK_URL=http://127.0.0.1:9/ LEDGER=$TMP/none TRIAGE_LOG=$TMP/none
  gh() { case "$*" in "api user"*) echo someone ;; *) echo '{"message":"Server Error"}'; return 1 ;; esac; }
  curl() { printf '{}\n503'; }
  post() { cat > /dev/null; }
  main
) 2> "$TMP/main.err" && r=0 || r=$?
check "main: failed PR list + good post exits 0" "$r" 0
grep -q 'open PR list failed' "$TMP/main.err" && r=yes || r=no; check "main: failed PR list is logged" "$r" yes
grep -q 'PR checks skipped' "$TMP/main.err" && r=yes || r=no; check "main: user lookup worked, so no owner-skip line" "$r" no
grep -q 'version-down' "$TMP/main/alerts.state" 2> /dev/null && r=marked || r=unmarked
check "main: failed PR list still posts the /version alert" "$r" marked

# credit stop: ledger past $94 since the credit start -> credit-stop alert posts and is marked
rm -rf "$TMP/main"; : > "$TMP/posted.txt"
printf '%s\n' "2026-10-15T01:00:00Z 2026-10-15 pr=1 60 sha=aaaaaaaa posted models=x" \
  "2026-10-16T01:00:00Z 2026-10-16 issue=2 34.5 triage=crew decided models=x" > "$TMP/credit-ledger"
(
  STATE=$TMP/main POST=1 MODE=now PULSE_WEBHOOK_URL=http://127.0.0.1:9/ LEDGER=$TMP/credit-ledger TRIAGE_LOG=$TMP/none CREDIT_START=2026-10-14
  gh() { case "$*" in "api user"*) echo someone ;; *) : ;; esac; }
  curl() { printf '{}\n200'; }
  post() { cat >> "$TMP/posted.txt"; }
  main
) 2> "$TMP/main.err" && r=0 || r=$?
check "main: credit stop run exits 0" "$r" 0
grep -q '🔴 foreman credit stop: ledger since 2026-10-14 94.5000, stop at \$94' "$TMP/posted.txt" 2> /dev/null && r=yes || r=no
check "main: credit stop posts the credit-stop alert" "$r" yes
grep -q 'credit-stop' "$TMP/main/alerts.state" 2> /dev/null && r=marked || r=unmarked
check "main: credit-stop alert is marked" "$r" marked
# unreadable ledger: the alert fires too (fail closed)
rm -rf "$TMP/main"; : > "$TMP/posted.txt"; mkdir -p "$TMP/ledger-dir"
(
  STATE=$TMP/main POST=1 MODE=now PULSE_WEBHOOK_URL=http://127.0.0.1:9/ LEDGER=$TMP/ledger-dir TRIAGE_LOG=$TMP/none
  gh() { case "$*" in "api user"*) echo someone ;; *) : ;; esac; }
  curl() { printf '{}\n200'; }
  post() { cat >> "$TMP/posted.txt"; }
  main
) 2> "$TMP/main.err" || true
grep -q 'foreman credit stop: ledger since [0-9-]* unreadable' "$TMP/posted.txt" 2> /dev/null && r=yes || r=no
check "main: unreadable ledger posts the credit-stop alert" "$r" yes
# below the stop: no credit-stop alert
rm -rf "$TMP/main"; : > "$TMP/posted.txt"
printf '%s\n' "2026-10-15T01:00:00Z 2026-10-15 pr=1 11.81 sha=aaaaaaaa posted models=x" > "$TMP/credit-low"
(
  STATE=$TMP/main POST=1 MODE=now PULSE_WEBHOOK_URL=http://127.0.0.1:9/ LEDGER=$TMP/credit-low TRIAGE_LOG=$TMP/none CREDIT_START=2026-10-14
  gh() { case "$*" in "api user"*) echo someone ;; *) : ;; esac; }
  curl() { printf '{}\n200'; }
  post() { cat >> "$TMP/posted.txt"; }
  main
) 2> "$TMP/main.err" || true
grep -q 'credit stop' "$TMP/posted.txt" 2> /dev/null && r=yes || r=no
check "main: \$11.81 of credit spent posts no credit-stop alert" "$r" no
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
