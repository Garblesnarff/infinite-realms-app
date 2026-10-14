#!/usr/bin/env bash
# realms-reviewer (#586): headless Sonnet reviewer + daily summary.
#
# Runs INSIDE the realms-foreman container (ops/foreman/Dockerfile), started by
# realms-reviewer.service hourly at :50 UTC. For each open same-repo PR whose
# newest "Strategist review" comment is not at the current head and whose CI
# has finished (max 8 per run), it runs `claude -p` with docs/ops/review_prompt.md
# from origin/main, validates the verdict JSON, and posts:
#   - a comment whose first line is exactly "Strategist review — <V> at <sha8>"
#   - a COMMENT review pinned to that head
#   - on Jules PRs (FIX/CLOSE only) the "@jules" comment
#   - on FIX for a catjam/ branch, label catjam-fix on its issue
# It never closes, merges, approves or marks a PR ready. If the head moved
# while the model was reviewing, the verdict is dropped.
#
# The 11:50Z run also posts "Realms strategist — last 24h" to Slack #last-24
# (SLACK_WEBHOOK_URL) and as a comment on #230.
#
#   review.sh                    # normal tick
#   review.sh --dry-run [--pr N] # review, post nothing; verdicts in state/dry-run/
#   review.sh --summary-dry-run  # print the summary, post nothing
#   review.sh --summary-now      # post the summary now (once per UTC day)
#   review.sh --slack-test       # send one test line to the webhook
#
# Spend cap: stops for the UTC day once the ledger reaches REVIEW_DAILY_USD
# (default $3). Set the hard $90/month limit in the Anthropic console too.
set -euo pipefail

REPO=${REVIEW_REPO:-Garblesnarff/infinite-realms-app}
MODEL=${REVIEW_MODEL:-sonnet}
MAX_PRS=${REVIEW_MAX_PRS:-8}
DAILY_USD=${REVIEW_DAILY_USD:-3.00}
PER_PR_USD=${REVIEW_PER_PR_USD:-0.75}
SUMMARY_HOUR=${REVIEW_SUMMARY_HOUR_UTC:-11}
OPS_LOG_ISSUE=${REVIEW_OPS_LOG_ISSUE:-230}
WORK=${FOREMAN_WORK:-/work}
STATE=$WORK/state
RUNNER_LOG=${RUNNER_STATE:-/runner-state}/catjam-runner.log
LEDGER=$STATE/spend.log
LOG=$STATE/review.log
# Secret-shaped strings. Built from pieces so the repo's own pre-commit secret
# hook (.husky/check-secrets.sh) does not flag this line.
SK=sk
SECRET_RE="${SK}_live_|${SK}_test_|${SK}-ant-|ghp_[A-Za-z0-9]{20}|github_pat_|hooks\.slack\.com/services|-----BEGIN [A-Z ]*PRIVATE K""EY"

MODE=tick
POST=1
ONLY_PR=""
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) POST=0 ;;
    --pr) ONLY_PR=${2:?--pr needs a number}; shift ;;
    --summary-now) MODE=summary ;;
    --summary-dry-run) MODE=summary; POST=0 ;;
    --slack-test) MODE=slack-test ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
: "${GH_TOKEN:?GH_TOKEN missing from /etc/realms-foreman/env}"
export GH_TOKEN GH_REPO=$REPO GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1

umask 022
mkdir -p "$STATE"
chmod 700 "$STATE"
FUID=$(id -u foreman)
exec 9> "$STATE/review.lock"
if ! flock -n 9; then echo "another review.sh holds the lock; exiting" >&2; exit 0; fi

say() { echo "$(date -u +%FT%TZ) $*" >&2; }
logline() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG" >&2; }
today() { date -u +%F; }

spent_today() { awk -v d="$(today)" '$2 == d { s += $4 } END { printf "%.4f", s + 0 }' "$LEDGER" 2> /dev/null || echo 0; }
lt() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a < b) }'; }
min() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", (a < b ? a : b) }'; }

looks_secret() { grep -qE "$SECRET_RE"; }

# ---- PR scan ---------------------------------------------------------------
# scan_prs > tsv: number, head sha, head ref, newest "Strategist review" first line
scan_prs() {
  local n sha ref first
  gh api "repos/$REPO/pulls?state=open&per_page=100&sort=created&direction=asc" --paginate \
    --jq ".[] | select(.head.repo.full_name == \"$REPO\") | \"\(.number)\t\(.head.sha)\t\(.head.ref)\"" |
    while IFS=$'\t' read -r n sha ref; do
      first=$(gh api "repos/$REPO/issues/$n/comments?per_page=100" --paginate \
        --jq '.[] | select(.body | startswith("Strategist review")) | .body | split("\n")[0]' | tail -1)
      printf '%s\t%s\t%s\t%s\n' "$n" "$sha" "$ref" "$first"
    done
}

ci_finished() { # 0 when every check at the head has completed (and at least one exists)
  local pending total
  total=$(gh pr checks "$1" --json bucket --jq 'length' 2> /dev/null || echo 0)
  pending=$(gh pr checks "$1" --json bucket --jq '[.[] | select(.bucket == "pending")] | length' 2> /dev/null || echo 1)
  [ "${total:-0}" -gt 0 ] && [ "${pending:-1}" -eq 0 ]
}

is_jules() { [[ $1 == jules* || $1 =~ -[0-9]{15,}$ ]]; }

# ---- one review ------------------------------------------------------------
# review_pr <number> <sha> <ref> <budget-usd>
review_pr() {
  local n=$1 sha=$2 ref=$3 budget=$4 dir out rc=0
  dir=$(mktemp -d /tmp/review-"$n".XXXX)
  chown "$FUID:$FUID" "$dir"
  out=$STATE/claude-$n.json
  {
    cat "$PROMPT_FILE"
    cat << EOF

## Your task

Review PR #$n in $REPO (head $sha, branch $ref). This is the only PR assigned
to you in this run. WRITE your verdicts to the JSON file $dir/verdicts.json
(a JSON array as described above; write [] for ALREADY REVIEWED or CI PENDING).
Do not post anything to GitHub.
EOF
  } > "$dir/task.md"
  chmod 644 "$dir/task.md"

  # Runs as foreman. ANTHROPIC_API_KEY and GH_TOKEN are inherited from this
  # process's environment (never put on a command line, where /proc/*/cmdline
  # would show them); the webhook is removed. The tool allowlist keeps gh
  # read-only (no gh api, no pr comment/merge/close/edit).
  setpriv --reuid="$FUID" --regid="$FUID" --clear-groups --inh-caps=-all -- \
    env -u SLACK_WEBHOOK_URL HOME=/home/foreman USER=foreman PATH=/usr/local/bin:/usr/bin:/bin \
    LANG=C.UTF-8 DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    bash -c 'cd "$1" && exec claude -p --model "$2" --max-budget-usd "$3" --output-format json \
      --no-session-persistence --strict-mcp-config --permission-mode default \
      --allowedTools "Bash(gh pr view:*)" "Bash(gh pr diff:*)" "Bash(gh pr checks:*)" \
        "Bash(gh pr list:*)" "Bash(gh issue view:*)" "Bash(gh run view:*)" \
        "Read" "Grep" "Glob" "Write" \
      --disallowedTools "Bash(gh api:*)" "WebFetch" "WebSearch" < task.md' \
    _ "$dir" "$MODEL" "$budget" > "$out" 2> "$STATE/claude-$n.err" || rc=$?

  local cost
  cost=$(jq -r '.total_cost_usd // 0' "$out" 2> /dev/null || echo 0)
  echo "$(date -u +%FT%TZ) $(today) pr=$n $cost" >> "$LEDGER"

  local verdicts=$dir/verdicts.json
  if ! jq -e 'type == "array"' "$verdicts" > /dev/null 2>&1; then
    # Fallback: the model answered with the JSON array in its final message.
    jq -r '.result // ""' "$out" 2> /dev/null | sed -n '/^\[/,/^\]/p' > "$verdicts" || true
  fi
  if ! jq -e 'type == "array"' "$verdicts" > /dev/null 2>&1; then
    logline "pr=#$n sha=${sha:0:8} result=no-verdict claude_exit=$rc usd=$cost"
    rm -rf "$dir"; return 0
  fi
  local v
  v=$(jq -c --argjson n "$n" --arg sha "$sha" \
    '[.[] | select(.pr == $n and .sha == $sha and (.verdict | IN("PASS","FIX","CLOSE")))] | first // empty' "$verdicts")
  if [ -z "$v" ]; then
    logline "pr=#$n sha=${sha:0:8} result=no-valid-verdict-for-head usd=$cost"
    rm -rf "$dir"; return 0
  fi
  post_verdict "$n" "$sha" "$ref" "$v" "$cost"
  rm -rf "$dir"
}

post_verdict() {
  local n=$1 sha=$2 ref=$3 v=$4 cost=$5 verdict s8 comment review jules now
  verdict=$(jq -r .verdict <<< "$v")
  s8=${sha:0:8}
  comment=$(jq -r '.comment // ""' <<< "$v" | sed '1{/^Strategist review/d}')
  comment="Strategist review — $verdict at $s8"$'\n'"$comment"
  review="Strategist review — $verdict at $s8. Details in the PR comment of the same title."
  jules=$(jq -r '.jules // ""' <<< "$v")
  if printf '%s\n%s' "$comment" "$jules" | looks_secret; then
    logline "pr=#$n sha=$s8 verdict=$verdict result=dropped-secret-pattern usd=$cost"
    return 0
  fi
  if [ "$POST" = 0 ]; then
    mkdir -p "$STATE/dry-run"
    jq --arg c "$comment" --arg r "$review" '.comment = $c | .review = $r' <<< "$v" > "$STATE/dry-run/$n.json"
    logline "pr=#$n sha=$s8 verdict=$verdict result=dry-run usd=$cost"
    return 0
  fi
  now=$(gh api "repos/$REPO/pulls/$n" --jq .head.sha)
  if [ "$now" != "$sha" ]; then
    logline "pr=#$n sha=$s8 verdict=$verdict result=dropped-head-moved usd=$cost"
    return 0
  fi
  gh api "repos/$REPO/issues/$n/comments" -f body="$comment" > /dev/null
  gh api "repos/$REPO/pulls/$n/reviews" -f commit_id="$sha" -f event=COMMENT -f body="$review" > /dev/null
  if is_jules "$ref" && [ "$verdict" != PASS ] && [ -n "$jules" ]; then
    [[ $jules == @jules* ]] || jules="@jules $jules"
    gh api "repos/$REPO/issues/$n/comments" -f body="$jules" > /dev/null
  fi
  if [ "$verdict" = FIX ] && [[ $ref =~ ^catjam/([0-9]+)- ]]; then
    gh api -X POST "repos/$REPO/issues/${BASH_REMATCH[1]}/labels" -f 'labels[]=catjam-fix' > /dev/null
  fi
  logline "pr=#$n sha=$s8 verdict=$verdict result=posted usd=$cost"
}

review_tick() {
  PROMPT_FILE=$STATE/review_prompt.md
  if ! gh api "repos/$REPO/contents/docs/ops/review_prompt.md?ref=main" \
    -H 'Accept: application/vnd.github.raw' > "$PROMPT_FILE" || [ ! -s "$PROMPT_FILE" ]; then
    say "could not read docs/ops/review_prompt.md from main; skipping reviews"; return 0
  fi
  chmod 644 "$PROMPT_FILE"
  local n sha ref first done_n=0 spent budget
  while IFS=$'\t' read -r n sha ref first; do
    [ -n "$n" ] || continue
    [ -z "$ONLY_PR" ] || [ "$n" = "$ONLY_PR" ] || continue
    [ "$done_n" -lt "$MAX_PRS" ] || break
    case $first in *" at ${sha:0:8}"*) continue ;; esac
    ci_finished "$n" || { say "pr #$n: CI not finished, skip"; continue; }
    spent=$(spent_today)
    if ! lt "$spent" "$DAILY_USD"; then
      logline "daily cap reached (\$$spent of \$$DAILY_USD); stopping reviews until 00:00Z"
      break
    fi
    budget=$(min "$PER_PR_USD" "$(awk -v a="$DAILY_USD" -v b="$spent" 'BEGIN { print a - b }')")
    review_pr "$n" "$sha" "$ref" "$budget"
    done_n=$((done_n + 1))
  done < <(scan_prs)
}

# ---- daily summary ---------------------------------------------------------
nums() { # "#1 #2 ..." capped at 15, then "+N more"
  awk 'NF { n++; if (n <= 15) printf "%s#%s", (n > 1 ? " " : ""), $1 } END { if (n > 15) printf " +%d more", n - 15 }'
}
search() { gh api -X GET search/issues -f q="$1" -f per_page=100 --jq '.items[].number' | sort -n; }
since_iso() { date -u -d '24 hours ago' +%FT%TZ; }

summary_text() {
  local since merged pass needs_human p1 rob deploys live spend fixes runs mins
  since=$(since_iso)
  merged=$(search "repo:$REPO is:pr is:merged merged:>=$since")
  pass=$(scan_prs | awk -F'\t' '$4 ~ /^Strategist review — PASS at / && index($4, substr($2, 1, 8)) { print $1 }')
  needs_human=$(search "repo:$REPO is:open label:needs-human")
  p1=$(search "repo:$REPO is:open is:issue label:P1")
  rob=$(search "repo:$REPO is:open label:needs-rob")
  deploys=$(gh api -X GET "repos/$REPO/commits" -f sha=main -f since="$since" -f per_page=100 --jq length)
  live=$(curl -fsS -m 10 https://api.infiniterealms.app/version 2> /dev/null | jq -r '.short // "unknown"' || echo unknown)
  spend=$(awk -v s="$since" '$1 >= s { t += $4 } END { printf "%.2f", t + 0 }' "$LEDGER" 2> /dev/null || echo 0.00)
  fixes=$(awk -v s="$since" '$1 >= s && /verdict=FIX result=posted/ { sub(/^pr=/, "", $2); print $2 }' "$LOG" 2> /dev/null | sort -u | tr '\n' ' ')
  runs=$(awk -v s="$since" '$1 >= s && /issue=#/' "$RUNNER_LOG" 2> /dev/null | wc -l)
  mins=$(awk -v s="$since" '$1 >= s { for (i = 1; i <= NF; i++) if ($i ~ /^minutes=/) { sub(/minutes=/, "", $i); t += $i } } END { print t + 0 }' "$RUNNER_LOG" 2> /dev/null || echo 0)
  count() { [ -n "$1" ] && printf '%s\n' "$1" | wc -l || echo 0; }

  echo "Realms strategist — last 24h"
  echo "Merged PRs ($(count "$merged")): $(printf '%s\n' "$merged" | nums)"
  echo "PASS waiting for merge ($(count "$pass")): $(printf '%s\n' "$pass" | nums)"
  echo "FIX rounds posted: $(printf '%s' "$fixes" | wc -w)${fixes:+ on $fixes}"
  echo "needs-human ($(count "$needs_human")): $(printf '%s\n' "$needs_human" | nums)"
  echo "Open P1s ($(count "$p1")): $(printf '%s\n' "$p1" | nums)"
  echo "Prod deploys: $deploys commits to main (auto-deploy ships each); live build $live"
  echo "API spend: \$$spend (cap \$$DAILY_USD/day)"
  echo "Runner: $runs jobs, $mins min"
  if [ -n "$rob" ]; then
    echo "Rob: typed lines needed on $(printf '%s\n' "$rob" | nums)"
  else
    echo "Rob: none"
  fi
}

slack_post() { # text on stdin; webhook URL never appears on a command line
  : "${SLACK_WEBHOOK_URL:?SLACK_WEBHOOK_URL missing from /etc/realms-foreman/env}"
  jq -Rs '{text: .}' | curl -fsS -m 20 -o /dev/null -H 'Content-Type: application/json' \
    --data-binary @- -K <(printf 'url = "%s"\n' "$SLACK_WEBHOOK_URL")
}

post_summary() {
  local marker=$STATE/summary-$(today) text
  text=$(summary_text)
  if [ "$POST" = 0 ]; then printf '%s\n' "$text"; return 0; fi
  [ ! -e "$marker" ] || { say "summary already posted today"; return 0; }
  printf '%s\n' "$text" | slack_post || say "slack post failed"
  gh api "repos/$REPO/issues/$OPS_LOG_ISSUE/comments" -f body="$text" > /dev/null || say "#$OPS_LOG_ISSUE comment failed"
  touch "$marker"
  logline "summary posted (slack + #$OPS_LOG_ISSUE)"
}

case $MODE in
  slack-test)
    echo "Realms strategist — webhook test from realms-reviewer (#586). The daily summary will post here at 11:50Z." | slack_post
    logline "slack test line sent"
    ;;
  summary) post_summary ;;
  tick)
    : "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY missing from /etc/realms-foreman/env}"
    review_tick
    if [ "$(date -u +%H)" = "$(printf '%02d' "$SUMMARY_HOUR")" ] && [ -z "$ONLY_PR" ]; then post_summary; fi
    ;;
esac
