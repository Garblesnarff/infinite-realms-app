#!/usr/bin/env bash

set -u

REPO_ROOT="$(git rev-parse --show-toplevel)"
APP_ROOT="$REPO_ROOT/ai-adventure-scribe-main"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/infinite-realms-tooling.XXXXXX")"
PROBE_WORKTREE="$TMP_ROOT/worktree"
TYPE_ERROR_FILE="$APP_ROOT/server-bun/src/__typecheck_gate_test__.ts"

cleanup() {
  rm -f "$TYPE_ERROR_FILE"
  if [ -d "$PROBE_WORKTREE" ]; then
    git worktree remove --force "$PROBE_WORKTREE" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

main_worktree="$(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10); exit }')"
before_hooks_path="$(git -C "$main_worktree" config --local --get core.hooksPath 2>/dev/null || true)"

git worktree add --detach "$PROBE_WORKTREE" HEAD >/dev/null
(cd "$PROBE_WORKTREE" && bash "$REPO_ROOT/scripts/setup-git-hooks.sh") >/dev/null

after_hooks_path="$(git -C "$main_worktree" config --local --get core.hooksPath 2>/dev/null || true)"
if [ "$before_hooks_path" != "$after_hooks_path" ]; then
  echo "FAIL: linked worktree changed main checkout core.hooksPath" >&2
  echo "  before: ${before_hooks_path:-<unset>}" >&2
  echo "  after:  ${after_hooks_path:-<unset>}" >&2
  exit 1
fi

worktree_hooks_path="$(git -C "$PROBE_WORKTREE" config --worktree --get core.hooksPath)"
if [ "$worktree_hooks_path" != ".husky" ]; then
  echo "FAIL: linked worktree core.hooksPath was '$worktree_hooks_path', expected '.husky'" >&2
  exit 1
fi

app_hooks_path="$(git -C "$PROBE_WORKTREE/ai-adventure-scribe-main" rev-parse --git-path hooks)"
if [ "$app_hooks_path" != "../.husky" ]; then
  echo "FAIL: app subdirectory resolved hooks path as '$app_hooks_path', expected '../.husky'" >&2
  exit 1
fi

bash_executables=()
if [ -x "/bin/bash" ]; then
  bash_executables+=("/bin/bash")
fi
if command -v bash >/dev/null 2>&1; then
  path_bash="$(command -v bash)"
  already_added=0
  for existing in "${bash_executables[@]}"; do
    if [ "$existing" = "$path_bash" ]; then
      already_added=1
      break
    fi
  done
  if [ "$already_added" -eq 0 ]; then
    bash_executables+=("$path_bash")
  fi
fi

if [ "${#bash_executables[@]}" -eq 0 ]; then
  echo "FAIL: no bash executable found to test server typecheck gate" >&2
  exit 1
fi

for shell_bin in "${bash_executables[@]}"; do
  if ! "$shell_bin" "$APP_ROOT/scripts/server-typecheck-gate.sh" >/dev/null; then
    echo "FAIL: server typecheck gate rejected main checkout under $shell_bin" >&2
    exit 1
  fi
done

printf 'const invalidTypecheckFixture: string = 123;\n' > "$TYPE_ERROR_FILE"

for shell_bin in "${bash_executables[@]}"; do
  if "$shell_bin" "$APP_ROOT/scripts/server-typecheck-gate.sh" > "$TMP_ROOT/typecheck-failure.log" 2>&1; then
    echo "FAIL: server typecheck gate accepted a new type error under $shell_bin" >&2
    cat "$TMP_ROOT/typecheck-failure.log" >&2
    exit 1
  fi
  if ! grep -q '__typecheck_gate_test__.ts' "$TMP_ROOT/typecheck-failure.log"; then
    echo "FAIL: typecheck gate did not report the new type error under $shell_bin" >&2
    cat "$TMP_ROOT/typecheck-failure.log" >&2
    exit 1
  fi
done

rm -f "$TYPE_ERROR_FILE"

echo "hooks-and-typecheck-gate: PASS"
