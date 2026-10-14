#!/usr/bin/env bash

set -euo pipefail

# Pre-merge check script for Infinite Realms
# Checks for unabridged file path overlaps (coordination evidence) and git merge conflicts.
# Read-only; does not merge, push, rebase, or mutate local branches/checkouts.

usage() {
  cat <<'EOF'
Usage:
  scripts/pre-merge-check.sh <pr-number>
  scripts/pre-merge-check.sh <base-ref> <head-ref>

Examples:
  scripts/pre-merge-check.sh 2053
  scripts/pre-merge-check.sh origin/main my-feature-branch
EOF
  exit 1
}

if [ $# -eq 0 ] || [ $# -gt 2 ]; then
  usage
fi

BASE_REF=""
HEAD_REF=""

if [ $# -eq 1 ]; then
  path_or_pr="$1"
  if [[ "$path_or_pr" =~ ^[0-9]+$ ]]; then
    if ! command -v gh &>/dev/null; then
      echo "ERROR: 'gh' CLI tool is required to look up PR #$path_or_pr, but is not installed or available in PATH." >&2
      exit 1
    fi
    echo "Fetching PR #$path_or_pr details via gh..."
    PR_JSON=$(gh pr view "$path_or_pr" --json baseRefName,headRefName,headRefOid 2>/dev/null || true)
    if [ -z "$PR_JSON" ]; then
      echo "ERROR: Failed to fetch PR #$path_or_pr details via gh." >&2
      exit 1
    fi
    BASE_NAME=$(echo "$PR_JSON" | grep -o '"baseRefName":"[^"]*"' | cut -d'"' -f4 || true)
    HEAD_OID=$(echo "$PR_JSON" | grep -o '"headRefOid":"[^"]*"' | cut -d'"' -f4 || true)
    if [ -z "$BASE_NAME" ] || [ -z "$HEAD_OID" ]; then
      echo "ERROR: Could not resolve base branch or head SHA for PR #$path_or_pr." >&2
      exit 1
    fi
    # Use the base branch's current tip on origin, not the local origin/<base>
    # ref: that ref can be stale, and checking against a stale base gives a
    # false PASS. ls-remote only reads, so this never fetches or updates refs.
    PR_BASE_TIP=$(git ls-remote --heads origin "refs/heads/$BASE_NAME" 2>/dev/null | cut -f1 || true)
    if [ -z "$PR_BASE_TIP" ]; then
      echo "ERROR: Could not read the current tip of '$BASE_NAME' from origin (git ls-remote)." >&2
      exit 1
    fi
    BASE_REF="$PR_BASE_TIP"
    HEAD_REF="$HEAD_OID"
  else
    usage
  fi
elif [ $# -eq 2 ]; then
  BASE_REF="$1"
  HEAD_REF="$2"
fi

# Resolve exact SHAs
# ^{commit}: a bare full SHA passes --verify even when its object is absent.
BASE_SHA=$(git rev-parse --verify "$BASE_REF^{commit}" 2>/dev/null || true)
HEAD_SHA=$(git rev-parse --verify "$HEAD_REF^{commit}" 2>/dev/null || true)

if [ -z "$BASE_SHA" ]; then
  if [ -n "${PR_BASE_TIP:-}" ]; then
    # Fail closed: checking against a base we cannot read would be a guess.
    echo "ERROR: Current tip of the PR base ($PR_BASE_TIP) is not in the local object database. This check does not fetch; fetch origin and re-run." >&2
  else
    echo "ERROR: Unable to resolve base ref '$BASE_REF' to a valid SHA." >&2
  fi
  exit 1
fi

if [ -z "$HEAD_SHA" ]; then
  echo "ERROR: Unable to resolve head ref '$HEAD_REF' to a valid SHA." >&2
  exit 1
fi

echo "=========================================="
echo "Pre-Merge Check Summary"
echo "=========================================="
echo "Base Ref: $BASE_REF ($BASE_SHA)"
echo "Head Ref: $HEAD_REF ($HEAD_SHA)"
echo "------------------------------------------"

# Find merge base
MERGE_BASE=$(git merge-base "$BASE_SHA" "$HEAD_SHA" 2>/dev/null || true)
if [ -z "$MERGE_BASE" ]; then
  echo "ERROR: No common merge base found between $BASE_SHA and $HEAD_SHA." >&2
  exit 1
fi
echo "Merge Base: $MERGE_BASE"
echo "------------------------------------------"

# 1. File path overlap check (coordination evidence)
# Get full unabridged file paths changed on HEAD vs MERGE_BASE
HEAD_FILES_TMP=$(mktemp)
BASE_FILES_TMP=$(mktemp)
OVERLAP_TMP=$(mktemp)

cleanup_tmps() {
  rm -f "$HEAD_FILES_TMP" "$BASE_FILES_TMP" "$OVERLAP_TMP"
}
trap cleanup_tmps EXIT

git diff --name-only "$MERGE_BASE" "$HEAD_SHA" | sort -u > "$HEAD_FILES_TMP"
git diff --name-only "$MERGE_BASE" "$BASE_SHA" | sort -u > "$BASE_FILES_TMP"

comm -12 "$HEAD_FILES_TMP" "$BASE_FILES_TMP" > "$OVERLAP_TMP"

OVERLAP_COUNT=$(wc -l < "$OVERLAP_TMP" | tr -d ' ')

if [ "$OVERLAP_COUNT" -gt 0 ]; then
  echo "WARNING / COORDINATION NOTICE: $OVERLAP_COUNT file(s) changed on both base and head since merge-base:"
  cat "$OVERLAP_TMP" | sed 's/^/  - /'
  echo "Note: File overlap is coordination evidence. Checking actual git merge status..."
else
  echo "File path overlap check: CLEAN (no overlapping modified paths)"
fi
echo "------------------------------------------"

# 2. Merge conflict check
# Try git merge-tree --write-tree
MERGE_CONFLICT=0

MERGE_TREE_OUT=$(git merge-tree --write-tree "$BASE_SHA" "$HEAD_SHA" 2>&1) || MERGE_CONFLICT=1

if [ $MERGE_CONFLICT -ne 0 ]; then
  echo "RESULT: CONFLICT DETECTED!"
  echo "Git merge-tree output:"
  echo "$MERGE_TREE_OUT" | sed 's/^/  /'
  echo "------------------------------------------"
  echo "Pre-merge check FAILED: $HEAD_SHA cannot be merged cleanly into $BASE_SHA." >&2
  exit 1
else
  echo "RESULT: CLEAN MERGE"
  echo "Git merge-tree succeeded without conflict."
  echo "------------------------------------------"
  echo "Pre-merge check PASSED."
  exit 0
fi
