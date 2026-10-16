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
grep -q 'return "$post_failed" # a failed post' "$HERE/../foreman/pulse.sh" && grep -q 'post_failed=1; }' "$HERE/../foreman/pulse.sh" \
  && r=yes || r=no; check "main: a failed post makes the run exit 1" "$r" yes
grep -q 'prs=$(open_prs) || { prs=""; prs_ok=0;' "$HERE/../foreman/pulse.sh" && r=yes || r=no
check "main: a failed PR list does not stop the tick" "$r" yes

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
