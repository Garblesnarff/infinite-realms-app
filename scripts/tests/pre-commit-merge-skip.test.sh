#!/usr/bin/env bash
# Proves .husky/pre-commit skips lint-staged on a merge commit and still runs it on a normal
# commit. Runs the real hook in a throwaway linked worktree, with a stand-in `bunx` on PATH that
# records each call, so nothing is formatted and no package is fetched. Not wired into ci.yml;
# run it directly: bash scripts/tests/pre-commit-merge-skip.test.sh
set -u

REPO_ROOT="$(git rev-parse --show-toplevel)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pre-commit-merge-skip.XXXXXX")"
PROBE="$TMP_ROOT/worktree"
BIN="$TMP_ROOT/bin"
CALLS="$TMP_ROOT/bunx-calls"

cleanup() {
  cd "$REPO_ROOT" || true
  git -C "$REPO_ROOT" worktree remove --force "$PROBE" > /dev/null 2>&1 || true
  git -C "$REPO_ROOT" branch -D pre-commit-merge-skip-side > /dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$BIN"
printf '#!/usr/bin/env bash\necho "$*" >> "%s"\n' "$CALLS" > "$BIN/bunx"
chmod +x "$BIN/bunx"

git -C "$REPO_ROOT" worktree add --detach "$PROBE" HEAD > /dev/null 2>&1
cd "$PROBE" || exit 1
git config user.email probe@example.test
git config user.name probe

# A side branch adds a file in a shape prettier would rewrite.
PROBE_FILE="ai-adventure-scribe-main/src/__merge_skip_probe__.ts"
git checkout -q -b pre-commit-merge-skip-side
printf 'export const probe = {a:1,b:2}\n' > "$PROBE_FILE"
git add "$PROBE_FILE"
git commit -q --no-verify -m probe-side
git checkout -q --detach HEAD~1

# The hook under test is this checkout's (it may be uncommitted); it cds to the probe's top level.
run_hook() {
  PATH="$BIN:$PATH" bash "$REPO_ROOT/.husky/pre-commit" > "$TMP_ROOT/hook.log" 2>&1
}

# 1. Merge commit: MERGE_HEAD exists, the merged file is staged, lint-staged must not run.
git merge -q --no-ff --no-commit pre-commit-merge-skip-side > /dev/null 2>&1
if ! git rev-parse -q --verify MERGE_HEAD > /dev/null; then
  echo "FAIL: the probe merge did not leave MERGE_HEAD" >&2
  exit 1
fi
rm -f "$CALLS"
if ! run_hook; then
  echo "FAIL: pre-commit failed on a merge commit" >&2
  cat "$TMP_ROOT/hook.log" >&2
  exit 1
fi
if [ -s "$CALLS" ]; then
  echo "FAIL: lint-staged ran on a merge commit: $(cat "$CALLS")" >&2
  exit 1
fi
if ! grep -q 'Merge commit: lint-staged skipped' "$TMP_ROOT/hook.log"; then
  echo "FAIL: the hook did not say it skipped lint-staged" >&2
  cat "$TMP_ROOT/hook.log" >&2
  exit 1
fi
if [ "$(cat "$PROBE_FILE")" != 'export const probe = {a:1,b:2}' ]; then
  echo "FAIL: the merged file was rewritten" >&2
  exit 1
fi
git merge --abort

# 2. Normal commit: no MERGE_HEAD, lint-staged must run.
printf 'export const other = 1;\n' > ai-adventure-scribe-main/src/__merge_skip_other__.ts
git add ai-adventure-scribe-main/src/__merge_skip_other__.ts
rm -f "$CALLS"
if ! run_hook; then
  echo "FAIL: pre-commit failed on a normal commit" >&2
  cat "$TMP_ROOT/hook.log" >&2
  exit 1
fi
if ! grep -qx 'lint-staged' "$CALLS" 2> /dev/null; then
  echo "FAIL: lint-staged did not run on a normal commit" >&2
  cat "$TMP_ROOT/hook.log" >&2
  exit 1
fi

echo "PASS: pre-commit skips lint-staged on a merge commit and runs it on a normal commit"
