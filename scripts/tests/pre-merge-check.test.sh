#!/usr/bin/env bash

set -euo pipefail

# Test suite for scripts/pre-merge-check.sh
# Exercises clean, overlap clean (with long path names), conflict, and fail-closed cases in temporary git repositories,
# plus PR-number mode against a stale local origin/<base> and a missing current base object.

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

# -------------------------------------------------------------------
# PR-number mode fixtures. A stub `gh` answers `gh pr view` offline with the
# JSON in GH_STUB_PR_JSON, so the base/head resolution runs for real against a
# local bare "origin" remote.
# -------------------------------------------------------------------
STUB_BIN="$TMP_DIR/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$GH_STUB_PR_JSON"
EOF
chmod +x "$STUB_BIN/gh"

# -------------------------------------------------------------------
# Test 5: PR-number mode checks against the CURRENT remote base, not a stale origin/<base>
# -------------------------------------------------------------------
echo "--- Test 5: Stale local origin/main must not hide a conflict with the current remote base ---"
ORIGIN5="$TMP_DIR/origin5.git"
REPO5="$TMP_DIR/repo5"
git init --bare -q -b main "$ORIGIN5"
mkdir -p "$REPO5"
cd "$REPO5"
git init -q -b main
git config user.email "test@example.com"
git config user.name "Test User"
echo "v1" > shared.txt
git add shared.txt && git commit -q -m "base"
STALE_BASE5=$(git rev-parse HEAD)
git remote add origin "$ORIGIN5"
git push -q origin main
git checkout -q -b feature5
echo "feature" > shared.txt
git commit -qam "feature edits shared.txt"
FEATURE5=$(git rev-parse HEAD)
git checkout -q main
echo "main-new" > shared.txt
git commit -qam "main edits shared.txt"
CURRENT_BASE5=$(git rev-parse HEAD)
git push -q origin main
# Leave the local tracking ref stale, as it is after a fetch that did not run.
git update-ref refs/remotes/origin/main "$STALE_BASE5"

# Against the stale base the feature merges cleanly, so the old code passed it.
set +e
OUT5=$(PATH="$STUB_BIN:$PATH" GH_STUB_PR_JSON="{\"baseRefName\":\"main\",\"headRefName\":\"feature5\",\"headRefOid\":\"$FEATURE5\"}" "$PRE_MERGE_CHECK_SCRIPT" 5 2>&1)
EXIT_CODE5=$?
set -e
if [ $EXIT_CODE5 -eq 0 ]; then
  echo "FAIL Test 5: Expected non-zero exit (conflict with current base), got 0"
  echo "$OUT5"
  exit 1
fi
if ! echo "$OUT5" | grep -q "RESULT: CONFLICT DETECTED!"; then
  echo "FAIL Test 5: Expected CONFLICT DETECTED against the current base, got:"
  echo "$OUT5"
  exit 1
fi
if ! echo "$OUT5" | grep -q "Base Ref: $CURRENT_BASE5"; then
  echo "FAIL Test 5: Expected the current remote base SHA $CURRENT_BASE5 in the summary, got:"
  echo "$OUT5"
  exit 1
fi
echo "PASS Test 5"
cd "$TEST_REPO"

# -------------------------------------------------------------------
# Test 6: Fail closed when the current remote base object is not in the local database
# -------------------------------------------------------------------
echo "--- Test 6: Fail closed when the current base object is missing locally ---"
ORIGIN6="$TMP_DIR/origin6.git"
PRODUCER6="$TMP_DIR/producer6"
REPO6="$TMP_DIR/repo6"
git init --bare -q -b main "$ORIGIN6"
git init -q -b main "$PRODUCER6"
cd "$PRODUCER6"
git config user.email "test@example.com"
git config user.name "Test User"
echo "v1" > shared.txt
git add shared.txt && git commit -q -m "base"
git remote add origin "$ORIGIN6"
git push -q origin main
mkdir -p "$REPO6"
cd "$REPO6"
git init -q -b main
git config user.email "test@example.com"
git config user.name "Test User"
git remote add origin "$ORIGIN6"
git fetch -q origin main
git checkout -q -b feature6 FETCH_HEAD
echo "feature" > shared.txt
git commit -qam "feature"
FEATURE6=$(git rev-parse HEAD)
# Advance origin's main from a producer clone. This repo never fetches the new commit.
cd "$PRODUCER6"
echo "main-new" > shared.txt
git commit -qam "main moves on"
git push -q origin main
cd "$REPO6"

set +e
OUT6=$(PATH="$STUB_BIN:$PATH" GH_STUB_PR_JSON="{\"baseRefName\":\"main\",\"headRefName\":\"feature6\",\"headRefOid\":\"$FEATURE6\"}" "$PRE_MERGE_CHECK_SCRIPT" 6 2>&1)
EXIT_CODE6=$?
set -e
if [ $EXIT_CODE6 -eq 0 ]; then
  echo "FAIL Test 6: Expected non-zero exit when the current base object is missing, got 0"
  echo "$OUT6"
  exit 1
fi
if ! echo "$OUT6" | grep -q "is not in the local object database"; then
  echo "FAIL Test 6: Expected the fail-closed missing-object error, got:"
  echo "$OUT6"
  exit 1
fi
echo "PASS Test 6"
cd "$TEST_REPO"

echo "=========================================="
echo "All pre-merge-check unit tests PASSED!"
echo "=========================================="
