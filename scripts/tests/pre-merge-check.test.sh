#!/usr/bin/env bash

set -euo pipefail

# Test suite for scripts/pre-merge-check.sh
# Exercises clean, overlap clean (with long path names), conflict, and fail-closed cases in temporary git repositories.

REPO_ROOT="$(git rev-parse --show-toplevel)"
PRE_MERGE_CHECK_SCRIPT="$REPO_ROOT/scripts/pre-merge-check.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pre-merge-check-test.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

echo "Running pre-merge-check tests in $TMP_DIR..."

# Helper to create a test git repo
TEST_REPO="$TMP_DIR/repo"
mkdir -p "$TEST_REPO"
cd "$TEST_REPO"

git init -b main
git config user.email "test@example.com"
git config user.name "Test User"

# Setup initial commit on main with a long nested path
LONG_PATH="ai-adventure-scribe-main/src/services/ai-service.ts"
mkdir -p "$(dirname "$LONG_PATH")"
echo 'export function processAi() { return "v1"; }' > "$LONG_PATH"
echo 'export function helper() { return "base"; }' > "ai-adventure-scribe-main/src/services/helper.ts"
git add .
git commit -m "Initial commit on main"

BASE_SHA=$(git rev-parse HEAD)

# -------------------------------------------------------------------
# Test 1: Clean merge with no file path overlap
# -------------------------------------------------------------------
echo "--- Test 1: Clean merge, no overlap ---"
git checkout -b feature-clean main
echo 'export function extra() { return "extra"; }' > "ai-adventure-scribe-main/src/services/extra.ts"
git add .
git commit -m "Add extra service"
CLEAN_HEAD_SHA=$(git rev-parse HEAD)

OUT1=$("$PRE_MERGE_CHECK_SCRIPT" "$BASE_SHA" "$CLEAN_HEAD_SHA")
if ! echo "$OUT1" | grep -q "Pre-merge check PASSED"; then
  echo "FAIL Test 1: Expected PASSED, got:"
  echo "$OUT1"
  exit 1
fi
if ! echo "$OUT1" | grep -q "File path overlap check: CLEAN"; then
  echo "FAIL Test 1: Expected CLEAN overlap check, got:"
  echo "$OUT1"
  exit 1
fi
echo "PASS Test 1"

# -------------------------------------------------------------------
# Test 2: Overlap clean - long paths modified on both base and head, auto-merges cleanly
# -------------------------------------------------------------------
echo "--- Test 2: Overlap clean (long path modified cleanly on both branches) ---"
# Create new base commit on main modifying lines at top
git checkout main
echo -e 'import { x } from "module";\nexport function processAi() { return "v1"; }' > "$LONG_PATH"
git commit -am "Update top of ai-service.ts on main"
NEW_BASE_SHA=$(git rev-parse HEAD)

# Create branch from initial main modifying lines at bottom
git checkout -b feature-overlap "$BASE_SHA"
echo -e 'export function processAi() { return "v1"; }\nexport function processAiV2() { return "v2"; }' > "$LONG_PATH"
git commit -am "Update bottom of ai-service.ts on feature"
OVERLAP_HEAD_SHA=$(git rev-parse HEAD)

OUT2=$("$PRE_MERGE_CHECK_SCRIPT" "$NEW_BASE_SHA" "$OVERLAP_HEAD_SHA")
if ! echo "$OUT2" | grep -q "Pre-merge check PASSED"; then
  echo "FAIL Test 2: Expected PASSED for auto-merge, got:"
  echo "$OUT2"
  exit 1
fi
if ! echo "$OUT2" | grep -q "WARNING / COORDINATION NOTICE: 1 file(s) changed on both base and head"; then
  echo "FAIL Test 2: Expected overlap warning, got:"
  echo "$OUT2"
  exit 1
fi
if ! echo "$OUT2" | grep -q "$LONG_PATH"; then
  echo "FAIL Test 2: Expected full unabridged path $LONG_PATH in overlap notice, got:"
  echo "$OUT2"
  exit 1
fi
echo "PASS Test 2"

# -------------------------------------------------------------------
# Test 3: Conflict - conflicting changes in long path
# -------------------------------------------------------------------
echo "--- Test 3: Merge Conflict in long path ---"
git checkout -b feature-conflict "$BASE_SHA"
echo 'export function processAi() { return "v2-conflict"; }' > "$LONG_PATH"
git commit -am "Conflicting rewrite of ai-service.ts"
CONFLICT_HEAD_SHA=$(git rev-parse HEAD)

set +e
OUT3=$("$PRE_MERGE_CHECK_SCRIPT" "$NEW_BASE_SHA" "$CONFLICT_HEAD_SHA" 2>&1)
EXIT_CODE3=$?
set -e

if [ $EXIT_CODE3 -eq 0 ]; then
  echo "FAIL Test 3: Expected exit code non-zero on conflict, got 0"
  echo "$OUT3"
  exit 1
fi
if ! echo "$OUT3" | grep -q "RESULT: CONFLICT DETECTED!"; then
  echo "FAIL Test 3: Expected CONFLICT DETECTED in output, got:"
  echo "$OUT3"
  exit 1
fi
if ! echo "$OUT3" | grep -q "Pre-merge check FAILED"; then
  echo "FAIL Test 3: Expected Pre-merge check FAILED, got:"
  echo "$OUT3"
  exit 1
fi
echo "PASS Test 3"

# -------------------------------------------------------------------
# Test 4: Fail closed on invalid inputs
# -------------------------------------------------------------------
echo "--- Test 4: Fail closed on invalid inputs ---"
set +e
OUT4=$("$PRE_MERGE_CHECK_SCRIPT" "non-existent-ref-12345" "$CLEAN_HEAD_SHA" 2>&1)
EXIT_CODE4=$?
set -e

if [ $EXIT_CODE4 -eq 0 ]; then
  echo "FAIL Test 4: Expected exit code non-zero for invalid ref, got 0"
  echo "$OUT4"
  exit 1
fi
if ! echo "$OUT4" | grep -q "ERROR: Unable to resolve base ref"; then
  echo "FAIL Test 4: Expected resolution error, got:"
  echo "$OUT4"
  exit 1
fi
echo "PASS Test 4"

echo "=========================================="
echo "All pre-merge-check unit tests PASSED!"
echo "=========================================="
