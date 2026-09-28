#!/usr/bin/env bash
# Server typecheck gate (#2313).
#
# Runs tsc against server-bun/tsconfig.typecheck.json and enforces the
# quarantine allowlist in server-bun/typecheck-known-errors.txt:
#   - tsc exits non-zero but produces NO per-file diagnostics (crash, bad
#     config, OOM)                                          -> FAIL (never PASS
#     silently on a tsc failure we cannot attribute)
#   - tsc reports a non-file diagnostic (e.g. "error TS5083" from a bad
#     config)                                               -> FAIL
#   - any tsc error in a file NOT on the allowlist          -> FAIL (new breakage)
#   - an allowlisted file whose error COUNT changed (up or down)
#                                                           -> FAIL (a new error
#     slipped into a quarantined file, or the quarantine shrank / resolved:
#     update the count in typecheck-known-errors.txt, or remove the entry AND
#     the tsconfig.typecheck.json exclude entry)
#
# Counts are per file because tsc's `exclude` cannot suppress errors in files
# pulled into the program via imports; see tsconfig.typecheck.json.
set -u

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$APP_DIR/server-bun"
ALLOWLIST="$SERVER_DIR/typecheck-known-errors.txt"

cd "$SERVER_DIR" || exit 1

raw_output="$(bun x tsc -p tsconfig.typecheck.json --noEmit 2>&1)"
tsc_exit=$?

# Per-file error counts from "path/to/file.ts(line,col): error TSXXXX" lines.
# Paths are relative to server-bun because we run from there.
declare -A error_counts=()
while IFS= read -r line; do
  file="${line%%(*}"
  error_counts["$file"]=$(( ${error_counts["$file"]:-0} + 1 ))
done < <(printf '%s\n' "$raw_output" | grep -oE '^[^ (]+\.ts\([0-9]+,[0-9]+\): error TS[0-9]+')

# Global (non-file) diagnostics, e.g. "error TS5083: Cannot read file ..."
# from a bad config. These can never map to a quarantined file.
global_errors="$(printf '%s\n' "$raw_output" | grep -E '^error TS[0-9]+' || true)"

# Allowlist: "<path> : <count> # #issue ..." lines; comments and blanks ignored.
declare -A allowed_counts=()
while IFS= read -r line; do
  entry="${line%%#*}"
  entry="$(printf '%s' "$entry" | awk '{$1=$1};1')"
  [ -z "$entry" ] && continue
  file="$(printf '%s' "${entry%%:*}" | awk '{$1=$1};1')"
  count="$(printf '%s' "${entry##*:}" | awk '{$1=$1};1')"
  if ! [[ "$count" =~ ^[0-9]+$ ]] || [ "$count" -eq 0 ]; then
    echo "FAIL: malformed allowlist entry (expected '<path> : <positive count>'): $line" >&2
    exit 1
  fi
  allowed_counts["$file"]="$count"
done < "$ALLOWLIST"

echo "server-typecheck: tsc exit=$tsc_exit, files with errors: ${#error_counts[@]}, quarantined: ${#allowed_counts[@]}"
if [ "${#allowed_counts[@]}" -gt 0 ]; then
  echo "  quarantined (acknowledged):"
  for a in "${!allowed_counts[@]}"; do
    echo "    $a : ${allowed_counts[$a]} error(s)"
  done
fi

failed=0

# A non-zero tsc exit with no per-file diagnostics means tsc crashed or the
# config is bad — there is nothing to attribute, so never PASS.
if [ "$tsc_exit" -ne 0 ] && [ "${#error_counts[@]}" -eq 0 ]; then
  failed=1
  echo "FAIL: tsc exited $tsc_exit with no per-file diagnostics (crash or bad config?)."
  echo "--- tsc output (first 30 lines) ---"
  printf '%s\n' "$raw_output" | head -30
fi

if [ -n "$global_errors" ]; then
  failed=1
  echo "FAIL: tsc reported non-file diagnostics:"
  printf '%s\n' "$global_errors"
fi

unexpected=()
for f in "${!error_counts[@]}"; do
  if [ -z "${allowed_counts[$f]+x}" ]; then unexpected+=("$f"); fi
done
if [ "${#unexpected[@]}" -gt 0 ]; then
  failed=1
  echo "FAIL: tsc errors in non-quarantined files:"
  for f in "${unexpected[@]}"; do echo "  - $f (${error_counts[$f]} error(s))"; done
  echo "--- full tsc output (unexpected files) ---"
  for f in "${unexpected[@]}"; do
    printf '%s\n' "$raw_output" | grep -F "$f(" || true
  done
fi

count_mismatch=()
for a in "${!allowed_counts[@]}"; do
  actual="${error_counts[$a]:-0}"
  if [ "$actual" -ne "${allowed_counts[$a]}" ]; then
    count_mismatch+=("$a (expected ${allowed_counts[$a]}, got $actual)")
  fi
done
if [ "${#count_mismatch[@]}" -gt 0 ]; then
  failed=1
  echo "FAIL: quarantined file error count changed:"
  printf '  - %s\n' "${count_mismatch[@]}"
  echo "  Update the count in server-bun/typecheck-known-errors.txt, or remove"
  echo "  the entry (and the tsconfig.typecheck.json exclude entry) if resolved."
fi

if [ "$failed" -eq 0 ]; then
  echo "server-typecheck: PASS"
fi
exit "$failed"
