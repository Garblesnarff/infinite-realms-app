#!/usr/bin/env bash
set -euo pipefail

# Production deploy, run from root cron every 15 minutes.
#
# Order of operations (see #2093): fetch -> build into a staging dir OUTSIDE
# the repo -> secret-scan the staged bundle -> `pm2 restart` -> only then
# publish into dist/, which is nginx's docroot. The server is always restarted
# BEFORE the client bundle goes live, so any skew is new-API/old-client.
#
# FLAGS (both optional; cron passes neither):
#   --deploy-now  deploy even when origin/main has not moved — rebuild, restart
#                 and republish at the current HEAD. Refuses while HOLD exists.
#   --dry-run     report what a run would do and touch nothing: no reset, no
#                 install, no build, no restart, no publish, no state writes.
#
# TO PAUSE DEPLOYS (stranger-test runs): `touch /var/lib/infiniterealms-deploy/HOLD`.
# While that file exists this script does nothing and exits 0; `rm` it to
# resume. A hold older than 3h pages Slack so a forgotten one cannot silently
# stop prod from tracking main. See the "deploy hold" block below.
# An unmatched "run N started" comment on #2093 under 3h old holds the same
# way; see the "open stranger-test run" block.
#
# cron runs with a minimal PATH that lacks bun (/root/.bun/bin). Without this,
# the deploy advances git via `git reset --hard` but dies at `bun install`
# ("bun: command not found"), leaving prod half-deployed. (pm2/git are in /usr/bin.)
# Overridable (default unchanged) so the build/restart failure branches can be
# exercised with stub binaries instead of the real bun and pm2 — same reason
# monitor-infiniterealms.sh takes MONITOR_PATH.
export PATH="${DEPLOY_BIN_PATH:-/root/.bun/bin}:$PATH"

# --- flags (added 2026-09-21, #2124) -----------------------------------------
# cron invokes the script with no arguments and gets exactly the old behavior.
# Anything unrecognised is a hard error rather than a silent ignore: a typo'd
# `--dryrun` that quietly performed a REAL deploy is the failure this guards.
DEPLOY_FORCE=0
DRY_RUN=0
usage() {
  cat <<'USAGE'
usage: auto-deploy.sh [--deploy-now] [--dry-run]

  --deploy-now  Deploy even when origin/main has not moved: rebuild, restart
                and republish at the current HEAD. Refuses (exit 1) while the
                deploy HOLD file exists.
  --dry-run     Print the steps a run would take and change nothing — no
                `git reset`, no `bun install`, no build, no `pm2 restart`, no
                publish into dist/, no state files, no Slack.
USAGE
}
while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-now) DEPLOY_FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "auto-deploy.sh: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# Overridable purely so the failure paths can be exercised against a scratch
# repo without touching production — same reason monitor-infiniterealms.sh takes
# MONITOR_* overrides. Default is unchanged.
cd "${DEPLOY_REPO_DIR:-/var/www/infiniterealms/ai-adventure-scribe-main}"
# Absolute path to the app dir, captured before any subshell changes cwd.
PWD_REPO=$(pwd)

ts() { date '+[%F %T]'; }

# --- fetch-failure alerting (added 2026-08-11) --------------------------------
# On 2026-08-11 the box's GitHub token expired and `git fetch` failed for ~2h
# (8 cron cycles). Under `set -e` that exited with git's stderr and nothing
# else, so the log was indistinguishable from a quiet "No changes" run: prod
# silently stopped tracking main and no monitor could tell. Failures now write
# a greppable `DEPLOY FAILED` line AND page Slack.
#
# State-change semantics deliberately match monitor-infiniterealms.sh: alert on
# the first failure, then at most one reminder per REPEAT_SECONDS while it stays
# broken, then one RECOVERED. Cron runs every 15 min, so alerting every cycle
# would produce ~96 messages/day — the exact flood that made the old monitor's
# alerts worthless.
ALERTS_ENV=${DEPLOY_ALERTS_ENV:-/etc/infiniterealms/alerts.env}
ALERT_FILE=${DEPLOY_ALERT_FILE:-/var/log/infiniterealms/alerts.log}
STATE_DIR=${DEPLOY_STATE_DIR:-/var/lib/infiniterealms-deploy}
REPEAT_SECONDS=${DEPLOY_REPEAT_SECONDS:-3600}
NOTIFY=${DEPLOY_NOTIFY:-1}
# A dry run must not page anyone, whatever DEPLOY_NOTIFY says.
[ "$DRY_RUN" = 1 ] && NOTIFY=0

mkdir -p "$STATE_DIR"

# Credentials are embedded in the remote URL, so any git error text is assumed
# to be secret-bearing until proven otherwise. No token has ever reached this
# log and none is going to start now.
scrub() { sed -e 's#://[^@/]*@#://REDACTED@#g' -e 's#gh[pousr]_[A-Za-z0-9]\{16,\}#REDACTED#g'; }

post_slack() {
  [ "$NOTIFY" = "1" ] || { echo "$(ts) [dry-run] slack: $1"; return 0; }
  [ -r "$ALERTS_ENV" ] || return 0
  command -v jq > /dev/null 2>&1 || return 0
  # Subshell so the webhook never leaks into the environment of the build,
  # `bun install`, or anything else this script goes on to run.
  (
    # shellcheck disable=SC1090
    . "$ALERTS_ENV"
    [ -n "${SLACK_ALERT_WEBHOOK_URL:-}" ] || exit 0
    curl -s -m 10 -X POST -H 'Content-type: application/json' \
      --data "$(jq -n --arg t "$1" '{text: $t}')" \
      "$SLACK_ALERT_WEBHOOK_URL" > /dev/null 2>&1
  ) || true
}

# Alerting must never be able to fail the deploy it is reporting on, so every
# path here is best-effort and returns success.
emit() {
  echo "$(ts) $1" >> "$ALERT_FILE" 2>/dev/null || true
  post_slack "$1"
  return 0
}

# record_state <check> <ok|fail> <detail>
# Every command that changes production goes through run(), so --dry-run is a
# property of one function rather than a flag threaded through a dozen call
# sites. #2124: the DEPLOY_* overrides looked like a dry-run facility and were
# not one — `pm2 restart infiniterealms-bun` was hardcoded, so a "verification"
# run restarted production on 2026-09-20 when origin/main moved underneath it.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "$(ts) [dry-run] would run: $*"
    return 0
  fi
  "$@"
}

record_state() {
  # State files drive the Slack rate-limiter; a dry run must not move that
  # cursor, or a real failure afterwards is filed as "still failing" and the
  # first alert is never sent.
  if [ "$DRY_RUN" = 1 ]; then
    echo "$(ts) [dry-run] would record_state $1 $2${3:+ — $3}"
    return 0
  fi
  local check=$1 status=$2 detail=$3 now
  local file="$STATE_DIR/$check.state" prev=ok since notified=0
  now=$(date +%s); since=$now

  if [ -r "$file" ]; then
    read -r prev since notified < "$file" || true
    prev=${prev:-ok}; since=${since:-$now}; notified=${notified:-0}
  fi

  if [ "$status" = fail ]; then
    if [ "$prev" != fail ]; then
      emit "🔴 DEPLOY FAILED: $check — $detail"
      echo "fail $now $now" > "$file"
    elif [ $((now - notified)) -ge "$REPEAT_SECONDS" ]; then
      emit "🔴 DEPLOY STILL FAILING ($(( (now - since) / 60 ))m): $check — $detail"
      echo "fail $since $now" > "$file"
    else
      echo "fail $since $notified" > "$file"
    fi
    return 0
  fi

  if [ "$prev" = fail ]; then
    emit "✅ DEPLOY RECOVERED: $check — was broken $(( (now - since) / 60 ))m"
  fi
  echo "ok $now 0" > "$file"
  return 0
}

# `--frozen-lockfile` catches a package.json/bun.lock mismatch (good — same
# check CI would do), but on failure it used to kill the whole script via
# set -e, leaving prod on the old build/PM2 process indefinitely: every later
# run sees "no changes" (HEAD already matches origin) and does nothing, so
# the deploy silently stalls until someone notices and fixes it by hand.
# Fall back to a plain install so the deploy still completes, but log an
# ALERT line so the drift doesn't go unnoticed (it'll keep firing every run
# until a synced bun.lock is committed upstream).
install_deps() {
  local dir="$1" label="$2"
  if [ "$DRY_RUN" = 1 ]; then
    echo "$(ts) [dry-run] would run: bun install --frozen-lockfile in $dir ($label)"
    return 0
  fi
  if (cd "$dir" && bun install --frozen-lockfile); then
    record_state "lockfile_$label" ok ""
    return 0
  fi
  echo "$(ts) ALERT: $label bun.lock is out of sync with package.json (frozen install failed). Falling back to a regular 'bun install' so the deploy isn't blocked. Commit a refreshed lockfile to stop this fallback firing every run."
  # This line predates the alerting below and assumed someone reads the log.
  # Nobody does — that assumption is what the 2026-08-11 fetch outage disproved
  # — so route it through the same rate-limited channel as everything else.
  record_state "lockfile_$label" fail "$label bun.lock is out of sync with package.json; deploy fell back to a non-frozen 'bun install'. Commit a refreshed lockfile."
  (cd "$dir" && bun install)
}

# --- deploy hold (added 2026-09-20, #2093) -----------------------------------
# The cron fires every 15 min unconditionally, so "no deploys during a stranger
# test run" was enforced only by a human reading GitHub comments in time. A
# deploy mid-run restarts pm2 and drops in-flight turns — the #2093 failure.
#
# Playtest now gates the cron directly instead of asking Hetzner to be awake:
# `touch` this file when posting "run N started", `rm` it at "run N ended".
# While it exists this script does nothing at all — no fetch, no build, no
# restart — and exits 0 so cron stays quiet.
#
# A hold left behind is the 2026-05-12 drift shape (prod silently stops
# tracking main and every later run still says it is "fine"), so a stale hold
# pages through the same rate-limited channel as every other failure rather
# than waiting to be noticed. Removing the file clears it to RECOVERED.
HOLD_FILE=${DEPLOY_HOLD_FILE:-$STATE_DIR/HOLD}
HOLD_STALE_SECONDS=${DEPLOY_HOLD_STALE_SECONDS:-10800}
if [ -e "$HOLD_FILE" ]; then
  HOLD_SINCE=$(stat -c %Y "$HOLD_FILE" 2>/dev/null || echo 0)
  HOLD_AGE=$(( $(date +%s) - HOLD_SINCE ))
  echo "$(ts) Held: $HOLD_FILE present (${HOLD_AGE}s). No fetch, no build, no restart."
  # --deploy-now is an operator saying "go now", and the single thing the hold
  # exists to stop is a deploy landing inside a stranger-test run (#2093). So
  # the flag does NOT override the hold: it exits non-zero, because a human who
  # typed the command is reading the output and a silent exit 0 would read as
  # "deployed". `rm` the hold first if the run really has ended.
  if [ "$DEPLOY_FORCE" = 1 ]; then
    echo "$(ts) Refusing --deploy-now: deploys are held. Remove $HOLD_FILE when the run has ended, then re-run."
    exit 1
  fi
  if [ "$HOLD_AGE" -ge "$HOLD_STALE_SECONDS" ]; then
    record_state hold fail "deploy held $(( HOLD_AGE / 60 ))m by $HOLD_FILE — prod is NOT tracking main. If the stranger-test run has ended, remove the file."
  fi
  exit 0
fi
record_state hold ok ""

# --- open stranger-test run (added 2026-09-22, #2093) -------------------------
# The HOLD file only works if Playtest remembers to `touch` it. Playtest always
# posts "run N started" / "run N ended" on #2093, so read those comments too:
# a started run with no later matching "ended", started under
# RUN_HOLD_MAX_AGE_SECONDS ago, is treated exactly like HOLD. Older than that it
# is assumed to be a forgotten "ended" and ignored, so a missed comment cannot
# stop prod tracking main.
#
# Uses the box's existing `gh` login; the token never leaves gh. If GitHub
# cannot be read the deploy proceeds (the HOLD file is still the primary
# control) and the failure pages through record_state, rate-limited like
# everything else.
RUN_ISSUE=${DEPLOY_RUN_ISSUE:-2093}
RUN_REPO=${DEPLOY_RUN_REPO:-Garblesnarff/infinite-realms-production}
RUN_HOLD_MAX_AGE_SECONDS=${DEPLOY_RUN_HOLD_MAX_AGE_SECONDS:-10800}
GH_BIN=${DEPLOY_GH_BIN:-gh}

# Prints "<N>\t<started epoch>\t<first line of the started comment>" for the
# newest run with no later "ended", or nothing. One comment may carry several
# markers (e.g. "run 8 ended, run 9 started"), so match globally. Run ids may
# carry one letter prefix (Muse posts "run M2 started"); the id is upper-cased
# so "run M2 started" pairs with "run m2 ended". Fixtures:
# ops/tests/open-run-markers.sh.
open_run() {
  "$GH_BIN" api --paginate "repos/$RUN_REPO/issues/$RUN_ISSUE/comments?per_page=100" |
    jq -rs '
      add
      | map(. as $c
          | ($c.body // "") | capture("\\brun\\s+#?(?<n>[A-Za-z]?[0-9]+)\\s+(?<ev>started|ended)\\b"; "gi")
          | {n: (.n | ascii_upcase), ev: (.ev | ascii_downcase), at: ($c.created_at | fromdateiso8601),
             line: (($c.body // "") | split("\n")[0] | .[0:200])})
      | group_by(.n)
      | map({s: (map(select(.ev == "started")) | max_by(.at)),
             e: (map(select(.ev == "ended") | .at) | max)})
      | map(select(.s != null and (.e == null or .e < .s.at)) | .s)
      | max_by(.at)
      | if . == null then empty else "\(.n)\t\(.at)\t\(.line)" end'
}

# Prints "<N>\t<started|ended>" for the newest marker on the issue, or nothing
# if there are none. Dry-run only (#2201): an operator reading "run_check ok"
# could not tell "no open run" from "the check saw nothing". Within one comment
# the later marker wins ("run 8 ended; run 9 started" -> 9 started). Fixtures:
# ops/tests/newest-run-marker.sh.
newest_run() {
  "$GH_BIN" api --paginate "repos/$RUN_REPO/issues/$RUN_ISSUE/comments?per_page=100" |
    jq -rs '
      add
      | map(. as $c
          | [($c.body // "") | capture("\\brun\\s+#?(?<n>[A-Za-z]?[0-9]+)\\s+(?<ev>started|ended)\\b"; "gi")]
          | to_entries[]
          | {n: (.value.n | ascii_upcase), ev: (.value.ev | ascii_downcase),
             k: [($c.created_at | fromdateiso8601), .key]})
      | max_by(.k)
      | if . == null then empty else "\(.n)\t\(.ev)" end'
}

# The text the dry run appends to "run_check ok", e.g. "newest: run 9 ended".
newest_run_detail() {
  local newest
  if ! newest=$(newest_run 2>/dev/null); then
    echo "newest: unknown (second read of #$RUN_ISSUE failed)"
  elif [ -z "$newest" ]; then
    echo "newest: no run markers on #$RUN_ISSUE"
  else
    echo "newest: run ${newest%%$'\t'*} ${newest#*$'\t'}"
  fi
}

if RUN_OPEN=$(open_run 2>/dev/null); then
  # Only a dry run pays for the second read; the cron path is unchanged.
  RUN_NEWEST=""
  if [ "$DRY_RUN" = 1 ]; then RUN_NEWEST=$(newest_run_detail); fi
  record_state run_check ok "$RUN_NEWEST"
  if [ -n "$RUN_OPEN" ]; then
    IFS=$'\t' read -r RUN_N RUN_AT RUN_LINE <<< "$RUN_OPEN"
    RUN_AGE=$(( $(date +%s) - RUN_AT ))
    if [ "$RUN_AGE" -lt "$RUN_HOLD_MAX_AGE_SECONDS" ]; then
      echo "$(ts) Held: run $RUN_N in progress (started $(( RUN_AGE / 60 ))m ago on #$RUN_ISSUE: $RUN_LINE). No fetch, no build, no restart."
      if [ "$DEPLOY_FORCE" = 1 ]; then
        echo "$(ts) Refusing --deploy-now: run $RUN_N has no \"run $RUN_N ended\" comment on #$RUN_ISSUE."
        exit 1
      fi
      exit 0
    fi
    echo "$(ts) Ignoring run $RUN_N: started $(( RUN_AGE / 60 ))m ago with no \"ended\" comment (older than ${RUN_HOLD_MAX_AGE_SECONDS}s)."
  fi
else
  echo "$(ts) WARNING: could not read run comments on #$RUN_ISSUE; proceeding on the HOLD file alone."
  record_state run_check fail "could not read #$RUN_ISSUE comments via gh; open stranger-test runs are NOT being detected"
fi

PREV_HEAD=$(git rev-parse HEAD)

# Explicitly branched rather than left to `set -e`: a bare non-zero exit here
# logs git's stderr and nothing a monitor can key on. The `if !` form is also
# required — under `set -e` a failing assignment would abort before the alert.
if ! FETCH_ERR=$(git fetch --quiet origin main 2>&1); then
  DETAIL=$(printf '%s' "$FETCH_ERR" | scrub | grep -v '^$' | tail -1)
  echo "$(ts) DEPLOY FAILED: git fetch origin main — ${DETAIL:-no error output}"
  echo "$(ts) Production stays at $PREV_HEAD and will NOT track main until this is fixed."
  record_state fetch fail "${DETAIL:-no error output} (prod pinned at ${PREV_HEAD:0:8})"
  exit 1
fi
record_state fetch ok ""

NEW_HEAD=$(git rev-parse origin/main)

if [[ "$PREV_HEAD" == "$NEW_HEAD" ]]; then
  if [ "$DEPLOY_FORCE" != 1 ]; then
    echo "$(ts) No changes (HEAD: $PREV_HEAD)"
    exit 0
  fi
  # --deploy-now: origin/main has not moved, so there is nothing to reset to,
  # but the operator wants this commit rebuilt, restarted and republished --
  # the case where a merge landed between two cron ticks, or where dist/ and
  # the running server have drifted from HEAD. Skipping the reset is the point:
  # it is the one step that can destroy state, and at an identical SHA it can
  # only do harm.
  echo "$(ts) --deploy-now: no new commits; rebuilding, restarting and republishing at $PREV_HEAD"
fi

# Only deploy if origin is strictly ahead of local. If local has commits
# origin doesn't (e.g., a hotfix made on the server), leave it alone — never
# reset away local work. Push the local commits manually instead.
# Not overridable by --deploy-now: refusing to reset away local commits is a
# safety property, not a convenience.
if ! git merge-base --is-ancestor "$PREV_HEAD" "$NEW_HEAD"; then
  echo "$(ts) Skipping: local HEAD ($PREV_HEAD) is not an ancestor of origin/main ($NEW_HEAD). Push local commits or rebase."
  exit 0
fi

if [[ "$PREV_HEAD" != "$NEW_HEAD" ]]; then
  echo "$(ts) Deploying $PREV_HEAD -> $NEW_HEAD"
  run git reset --hard origin/main
fi
install_deps . "root"
install_deps server-bun "server-bun"
# Everything from here on runs AFTER `git reset --hard`, which is what makes a
# failure here worse than a fetch failure rather than better: git has already
# advanced, so the next cron run sees PREV_HEAD == NEW_HEAD, logs "No changes"
# and exits without retrying. A half-deploy therefore persists silently and
# indefinitely — the exact stall described in install_deps() above, and the same
# shape as the 124-commit drift of 2026-05-12. These branches exist so that
# state pages someone instead of waiting to be noticed.
#
# Build output is left streaming to the cron log rather than captured, so the
# operator gets the real compiler error; the Slack message just says where to
# look. No auto-rollback: reverting a half-applied deploy unattended is a bigger
# risk than stopping and shouting.
#
# ORDERING (issue #2093, changed 2026-09-20). This used to run `bun run build`
# straight into `dist/`, which IS nginx's docroot — so the build *was* the
# publish, and the new client bundle went live while pm2 still served the old
# API. Every successful deploy had a client/server skew window, and a browser
# that had loaded index.html before the build then asked for content-hashed
# chunks that no longer existed on disk.
#
# Now the build goes to a staging directory OUTSIDE the repo, the server
# restarts first, and only then is the bundle swapped into dist/. This inverts
# the skew to new-API/old-client, which is the safe direction: an old client
# only ever requests chunks that still exist. It keeps ONE server process — no
# cluster mode, no second port, no nginx change.
STAGING_ROOT=${DEPLOY_STAGING_ROOT:-/var/lib/infiniterealms-deploy/staging}
STAGING_DIST="$STAGING_ROOT/dist"
run mkdir -p "$STAGING_ROOT"

# vite writes the bundle to the staging dir instead of the live docroot.
# --emptyOutDir is required because the target is outside the project root;
# without it vite refuses to clear the directory and stale chunks accumulate.
if ! run bunx vite build --outDir "$STAGING_DIST" --emptyOutDir; then
  echo "$(ts) DEPLOY FAILED: vite build — build output above"
  record_state build fail "vite build failed at ${NEW_HEAD:0:8}. git ALREADY advanced, so later runs will report 'No changes' without retrying. dist/ and the server are both UNCHANGED (still ${PREV_HEAD:0:8}) — prod is consistent, just stale. Fix and redeploy by hand. See /var/log/infiniterealms/auto-deploy.log"
  exit 1
fi

# `bun run build` is `vite build && node scripts/check-client-build-secrets.mjs`,
# and that checker hardcodes BUILD_ROOT = <cwd>/dist. Running it from the
# staging root points it at the bundle just built rather than the live one —
# the scan MUST see the new bundle, because the whole point is to catch a
# secret before it is published. Splitting the two halves of `bun run build`
# here is what buys that; do not collapse it back.
if [ "$DRY_RUN" = 1 ]; then
  echo "$(ts) [dry-run] would run: check-client-build-secrets.mjs against $STAGING_DIST"
elif ! (cd "$STAGING_ROOT" && node "$PWD_REPO/scripts/check-client-build-secrets.mjs"); then
  echo "$(ts) DEPLOY FAILED: client build secret check — output above"
  record_state build fail "client build secret check FAILED at ${NEW_HEAD:0:8}. A secret may be baked into the staged bundle. NOTHING was published: dist/ and the server are both still ${PREV_HEAD:0:8}. Do not publish $STAGING_DIST by hand until this is resolved."
  exit 1
fi
record_state build ok ""

# Server first. While this runs, dist/ still holds the OLD bundle, so a browser
# mid-session keeps getting chunks that exist. A failure here leaves the server
# old-or-down against an old client — consistent, and recoverable by pm2 alone.
#
# No `--update-env`, deliberately. That flag replaces the process environment
# with the CALLER's, and the caller here is cron, whose environment is the
# minimal one this script has to patch PATH for at the top. That is exactly how
# #1888 happened: SLACK_ALERT_WEBHOOK_URL lived only as inherited pm2 process
# env, so a restart from an unsourced shell silently disabled every Slack alert
# with no error and no log line. ecosystem.production.config.cjs now parses
# /etc/infiniterealms/alerts.env and folds it in itself, so a plain restart
# carries the webhook and `--update-env` would only re-introduce the dependence
# on whatever environment happened to invoke the script. Do not add it back.
if ! run pm2 restart infiniterealms-bun; then
  echo "$(ts) DEPLOY FAILED: pm2 restart infiniterealms-bun — pm2 output above"
  record_state pm2_restart fail "pm2 restart failed at ${NEW_HEAD:0:8}. The client bundle was NOT published, so dist/ still matches the pre-deploy server (${PREV_HEAD:0:8}) — no version skew. Check 'pm2 list' and 'pm2 logs infiniterealms-bun'"
  exit 1
fi
record_state pm2_restart ok ""

# Publish. rsync --delete makes dist/ match staging exactly, clearing the
# previous build's hashed chunks. Per-file replacement is not atomic, so this
# is deliberately the LAST step and the shortest possible window.
#
# --checksum is NOT optional here. rsync's default quick check compares size
# and mtime only, and it silently skipped a changed file in testing: the git
# reset and the build landed in the same clock second and the two versions
# happened to be the same byte count, so rsync copied nothing, exited 0, and
# the deploy reported success while the OLD bundle stayed live. Content-hashed
# chunk names make that unlikely for the JS, but index.html keeps its name
# across every build and is exactly the file this would strand. A publish step
# that can no-op without saying so is worse than one that is slow.
# Snapshot the live bundle first so the rsync below has something to fall back
# to. `cp -al` hardlinks rather than copies: ~143M of dist/ costs no extra space
# and no meaningful time, and because rsync publishes each file by writing a
# temp and renaming over it, the snapshot keeps the OLD inode rather than
# watching it change underneath. Requires dist/ and STAGING_ROOT on one
# filesystem — both are on /dev/sda1.
#
# Losing the snapshot is not a reason to strand the server on new code with an
# old bundle, so a failure here warns and publishes anyway.
DIST_PREV="$STAGING_ROOT/dist.prev"
if [ "$DRY_RUN" = 1 ]; then
  echo "$(ts) [dry-run] would snapshot dist/ to $DIST_PREV"
else
  rm -rf "$DIST_PREV"
  if ! cp -al dist "$DIST_PREV" 2> /dev/null; then
    echo "$(ts) WARNING: could not snapshot dist/ to $DIST_PREV — publishing with no rollback copy."
    rm -rf "$DIST_PREV"
  fi
fi

if ! run rsync -a --checksum --delete "$STAGING_DIST/" dist/; then
  echo "$(ts) DEPLOY FAILED: rsync staging -> dist — rsync output above"
  # This is the one branch that leaves a REAL skew: pm2 is already on the new
  # code and dist/ is now old-or-partial, so a browser can ask for a chunk that
  # exists in neither tree. Swapping the snapshot back makes the docroot
  # internally consistent again — old client against new API, which is the
  # direction the whole reorder exists to guarantee — instead of leaving a
  # half-written docroot serving 404s for hashed chunks.
  ROLLBACK_NOTE="NO dist.prev snapshot was available, so dist/ is PARTIAL and may 404 on hashed chunks. Republish by hand: rsync -a --checksum --delete $STAGING_DIST/ dist/ && chown -R www-data:www-data dist"
  if [ -d "$DIST_PREV" ] && rsync -a --delete "$DIST_PREV/" dist/; then
    chown -R www-data:www-data dist
    echo "$(ts) Rolled dist/ back to the pre-deploy bundle from $DIST_PREV"
    ROLLBACK_NOTE="dist/ was rolled back to the pre-deploy bundle (${PREV_HEAD:0:8}); the SERVER is on ${NEW_HEAD:0:8}, so prod is old-client/new-API and serving. Retry the publish: rsync -a --checksum --delete $STAGING_DIST/ dist/ && chown -R www-data:www-data dist"
  else
    echo "$(ts) Rollback FAILED or unavailable — dist/ is partial"
  fi
  record_state publish fail "rsync of the client bundle into dist/ failed at ${NEW_HEAD:0:8}. $ROLLBACK_NOTE"
  exit 1
fi

# nginx serves dist as www-data; a root-run build leaves root-owned files.
run chown -R www-data:www-data dist
record_state publish ok ""

# $DIST_PREV is deliberately left in place after a success: it is the previous
# bundle, and it is the fastest manual rollback available if the new one turns
# out to be bad (rsync -a --delete "$DIST_PREV/" dist/ && chown -R www-data:www-data dist).
# The next run replaces it. Its hardlinks have diverged by now, so it does cost
# a real copy of the old bundle on disk until then.

if [ "$DRY_RUN" = 1 ]; then
  echo "$(ts) [dry-run] complete — nothing was changed (would have deployed $NEW_HEAD)"
else
  echo "$(ts) Deploy complete ($NEW_HEAD)"
fi
