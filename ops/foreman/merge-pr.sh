#!/usr/bin/env bash
# merge-pr.sh — merge one PR, merge-queue aware (#663 item 3).
#
# Usage: merge-pr.sh <PR-number> <expected-head-sha> [--dry-run]
#        (or MERGE_EXPECT_SHA=<sha> merge-pr.sh <PR-number> [--dry-run])
#
# The expected head is the full 40-character sha the caller approved (the
# head the strategist PASS and the green CI are for). The script refuses
# (exit 1) if the PR head is anything else, and both merge paths pin it, so a
# push after the approval is never merged under the old PASS.
#
# Applies the standing merger skip rules, then merges:
#   - if the GitHub merge queue is enabled on main: enqueues the PR via
#     GraphQL enqueuePullRequest (REST merge fails when the queue is on)
#   - otherwise: squash-merges via the REST merge endpoint
#
# Skip rules (from the merger contract). A skip exits 0 printing "skip: <reason>":
#   - PR changes .github/workflows/           → skip: workflow PR
#   - PR adds a db migration                   → skip: migration
#     (ai-adventure-scribe-main/db/migrations/)
#     Both rules check the old name of a renamed file too, so a rename out
#     of those folders (deleting a workflow, say) is caught.
#   - 3000 or more files                       → skip: file list truncated
#     (the API lists at most 3000, so the checks above could miss a path)
#   - release-please PR                        → skip: release PR
#     (title starts "chore(main): release" or author is release-please[bot])
#   - non-conventional title                   → skip: non-conventional title
#   - 0 files changed                          → skip: empty PR
#
# The caller (Muse's merger) owns the rest of the merge contract: strategist
# PASS at the exact head SHA, green pull_request CI at that SHA, the 2-minute
# second look, draft→ready, and "Fixes #N" → "Refs #N". This script performs
# only the merge step itself.
#
# Env: GH_TOKEN with repo scope. Uses `gh` (gh api) for all GitHub calls.
set -euo pipefail

REPO=${MERGE_REPO:-Garblesnarff/infinite-realms-app}
BASE_BRANCH=${MERGE_BASE:-main}

usage() { echo "usage: merge-pr.sh <PR-number> <expected-head-sha> [--dry-run]" >&2; exit 2; }
DRY_RUN=0
PR=""
EXPECT_SHA=${MERGE_EXPECT_SHA:-}
pos=0
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *)
      pos=$((pos + 1))
      case $pos in
        1) PR=$1 ;;
        2) EXPECT_SHA=$1 ;;
        *) usage ;;
      esac
      ;;
  esac
  shift
done
[[ $PR =~ ^[0-9]+$ ]] || { echo "PR must be a number, got '$PR'" >&2; usage; }
[[ $EXPECT_SHA =~ ^[0-9a-f]{40}$ ]] || { echo "expected head sha must be 40 hex characters, got '$EXPECT_SHA'" >&2; usage; }
: "${GH_TOKEN:?GH_TOKEN is required}"

skip() { echo "skip: $1"; exit 0; }

# --- PR facts ---------------------------------------------------------------
PR_JSON=$(gh api "repos/$REPO/pulls/$PR")
TITLE=$(printf '%s' "$PR_JSON" | jq -r '.title')
AUTHOR=$(printf '%s' "$PR_JSON" | jq -r '.user.login')
HEAD_SHA=$(printf '%s' "$PR_JSON" | jq -r '.head.sha')
NODE_ID=$(printf '%s' "$PR_JSON" | jq -r '.node_id')
BASE=$(printf '%s' "$PR_JSON" | jq -r '.base.ref')
STATE=$(printf '%s' "$PR_JSON" | jq -r '.state')

[ "$STATE" = "open" ] || skip "PR is $STATE"
[ "$BASE" = "$BASE_BRANCH" ] || skip "base is $BASE, not $BASE_BRANCH"
if [ "$HEAD_SHA" != "$EXPECT_SHA" ]; then
  echo "refuse: PR #$PR head is ${HEAD_SHA:0:8}, the caller approved ${EXPECT_SHA:0:8}" >&2
  exit 1
fi

# One line per file: "<filename><TAB><previous_filename or empty>".
FILES=$(gh api --paginate "repos/$REPO/pulls/$PR/files?per_page=100" \
  --jq '.[] | "\(.filename)\t\(.previous_filename // "")"')
[ -n "$FILES" ] || skip "empty PR (0 files)"
NFILES=$(printf '%s\n' "$FILES" | wc -l)
[ "$NFILES" -lt 3000 ] || skip "file list truncated ($NFILES files; the API lists at most 3000)"

# --- skip rules --------------------------------------------------------------
case "$TITLE" in
  "chore(main): release"*) skip "release PR (title)" ;;
esac
[ "$AUTHOR" = "release-please[bot]" ] && skip "release PR (author)"

if ! printf '%s' "$TITLE" | grep -Eq '^(feat|fix|perf|refactor|chore|docs|test|ci|build)(\(.+\))?(!)?: .+'; then
  skip "non-conventional title: $TITLE"
fi

while IFS=$'\t' read -r f old; do
  for p in "$f" ${old:+"$old"}; do
    case "$p" in
      .github/workflows/*) skip "workflow PR ($p)" ;;
      ai-adventure-scribe-main/db/migrations/*) skip "migration ($p)" ;;
    esac
  done
done <<< "$FILES"

# --- merge queue detection ----------------------------------------------------
# rules/branches/<branch> lists the rules active on that branch, one object
# per rule ({type, ruleset_id, ...}). The rulesets list endpoint returns
# summaries without rules, so it cannot show a queue.
QUEUE_ON=$(gh api "repos/$REPO/rules/branches/$BASE_BRANCH" --paginate \
  --jq '[.[] | select(.type == "merge_queue")] | length > 0')

# --- merge --------------------------------------------------------------------
if [ "$QUEUE_ON" = "true" ]; then
  echo "merge queue is ON for $BASE_BRANCH: enqueueing PR #$PR at $EXPECT_SHA"
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run: would run enqueuePullRequest for $NODE_ID @ ${EXPECT_SHA:0:8}"
    exit 0
  fi
  gh api graphql -f query='
    mutation($prId:ID!, $headOid:GitObjectID!) {
      enqueuePullRequest(input:{pullRequestId:$prId, expectedHeadOid:$headOid}) {
        mergeQueueEntry { id state position }
      }
    }' -f prId="$NODE_ID" -f headOid="$EXPECT_SHA" \
    --jq '.data.enqueuePullRequest.mergeQueueEntry | "enqueued: id=\(.id) state=\(.state) position=\(.position)"'
else
  echo "merge queue is OFF for $BASE_BRANCH: squash-merging PR #$PR at $EXPECT_SHA"
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run: would REST squash-merge #$PR @ ${EXPECT_SHA:0:8}"
    exit 0
  fi
  gh api --method PUT "repos/$REPO/pulls/$PR/merge" \
    -f merge_method=squash -f sha="$EXPECT_SHA" \
    --jq '"merged: sha=\(.sha) merged=\(.merged) message=\(.message)"'
fi
