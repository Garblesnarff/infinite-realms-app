#!/usr/bin/env bash
# Proves the frontend typecheck gate (#664) against the real tsconfig.app.json
# program: the seeded allowlist passes, a new error fails, and a stale
# allowlist entry fails. Not wired into ci.yml; run it directly.
set -u

REPO_ROOT="$(git rev-parse --show-toplevel)"
APP_ROOT="$REPO_ROOT/ai-adventure-scribe-main"
GATE="$APP_ROOT/scripts/frontend-typecheck-gate.sh"
ALLOWLIST="$APP_ROOT/typecheck-known-errors.txt"
TYPE_ERROR_FILE="$APP_ROOT/src/__typecheck_gate_test__.ts"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/frontend-typecheck-gate.XXXXXX")"
ALLOWLIST_BACKUP="$TMP_ROOT/typecheck-known-errors.txt"

cleanup() {
  rm -f "$TYPE_ERROR_FILE"
  if [ -f "$ALLOWLIST_BACKUP" ]; then
    cp "$ALLOWLIST_BACKUP" "$ALLOWLIST"
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

cp "$ALLOWLIST" "$ALLOWLIST_BACKUP"

if ! bash "$GATE" > "$TMP_ROOT/baseline.log" 2>&1; then
  echo "FAIL: frontend typecheck gate rejected the seeded allowlist" >&2
  cat "$TMP_ROOT/baseline.log" >&2
  exit 1
fi
if ! grep -q 'frontend-typecheck: PASS' "$TMP_ROOT/baseline.log"; then
  echo "FAIL: frontend typecheck gate did not report PASS on the seeded allowlist" >&2
  cat "$TMP_ROOT/baseline.log" >&2
  exit 1
fi

printf '\n%s\n' 'src/__stale_frontend_typecheck_gate__.ts : 1 # #664 test fixture' >> "$ALLOWLIST"
if bash "$GATE" > "$TMP_ROOT/stale.log" 2>&1; then
  echo "FAIL: frontend typecheck gate accepted a stale allowlist entry" >&2
  cat "$TMP_ROOT/stale.log" >&2
  exit 1
fi
if ! grep -q '__stale_frontend_typecheck_gate__.ts' "$TMP_ROOT/stale.log"; then
  echo "FAIL: typecheck gate did not report the stale allowlist entry" >&2
  cat "$TMP_ROOT/stale.log" >&2
  exit 1
fi
if ! grep -q 'expected 1, got 0' "$TMP_ROOT/stale.log"; then
  echo "FAIL: typecheck gate did not report the stale count mismatch" >&2
  cat "$TMP_ROOT/stale.log" >&2
  exit 1
fi
cp "$ALLOWLIST_BACKUP" "$ALLOWLIST"

printf 'export const invalidTypecheckFixture: string = 123;\n' > "$TYPE_ERROR_FILE"
if bash "$GATE" > "$TMP_ROOT/new-error.log" 2>&1; then
  echo "FAIL: frontend typecheck gate accepted a new type error" >&2
  cat "$TMP_ROOT/new-error.log" >&2
  exit 1
fi
if ! grep -q '__typecheck_gate_test__.ts' "$TMP_ROOT/new-error.log"; then
  echo "FAIL: typecheck gate did not report the new type error" >&2
  cat "$TMP_ROOT/new-error.log" >&2
  exit 1
fi

echo "frontend-typecheck-gate: PASS"
