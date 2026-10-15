#!/usr/bin/env bash
# merge-pr.sh — merge one PR, merge-queue aware (#663 item 3).
#
# Usage: merge-pr.sh <PR-number> [--dry-run]
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

DRY_RUN=0
PR=""
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    *) PR=${1:?PR number required} ;;
  esac
  shift
done
[ -n "$PR" ] || { echo "usage: merge-pr.sh <PR-number> [--dry-run]" >&2; exit 2; }
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

FILES=$(gh api --paginate "repos/$REPO/pulls/$PR/files?per_page=100" --jq '.[].filename')
[ -n "$FILES" ] || skip "empty PR (0 files)"

# --- skip rules --------------------------------------------------------------
case "$TITLE" in
  "chore(main): release"*) skip "release PR (title)" ;;
esac
[ "$AUTHOR" = "release-please[bot]" ] && skip "release PR (author)"

if ! printf '%s' "$TITLE" | grep -Eq '^(feat|fix|refactor|chore|docs|test|ci|build)(\(.+\))?(!)?: .+'; then
  skip "non-conventional title: $TITLE"
fi

while IFS= read -r f; do
  case "$f" in
    .github/workflows/*) skip "workflow PR ($f)" ;;
    ai-adventure-scribe-main/db/migrations/*) skip "migration ($f)" ;;
  esac
done <<< "$FILES"

# --- merge queue detection ----------------------------------------------------
# REST rulesets: look for a merge_queue rule targeting branches. This covers
# both legacy branch protection and ruleset-enforced queues (GraphQL
# BranchProtectionRule exposes no merge-queue flag).
QUEUE_ON=$(gh api "repos/$REPO/rulesets" \
  --jq '[.[] | select(.target == "branch") | .rules[]? | select(.type == "merge_queue")] | length > 0')

# --- merge --------------------------------------------------------------------
if [ "$QUEUE_ON" = "true" ]; then
  echo "merge queue is ON for $BASE_BRANCH: enqueueing PR #$PR at $HEAD_SHA"
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run: would run enqueuePullRequest for $NODE_ID @ ${HEAD_SHA:0:8}"
    exit 0
  fi
  gh api graphql -f query='
    mutation($prId:ID!, $headOid:GitObjectID!) {
      enqueuePullRequest(input:{pullRequestId:$prId, expectedHeadOid:$headOid}) {
        mergeQueueEntry { id state position }
      }
    }' -f prId="$NODE_ID" -f headOid="$HEAD_SHA" \
    --jq '.data.enqueuePullRequest.mergeQueueEntry | "enqueued: id=\(.id) state=\(.state) position=\(.position)"'
else
  echo "merge queue is OFF for $BASE_BRANCH: squash-merging PR #$PR at $HEAD_SHA"
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run: would REST squash-merge #$PR @ ${HEAD_SHA:0:8}"
    exit 0
  fi
  gh api --method PUT "repos/$REPO/pulls/$PR/merge" \
    -f merge_method=squash -f sha="$HEAD_SHA" \
    --jq '"merged: sha=\(.sha) merged=\(.merged) message=\(.message)"'
fi
