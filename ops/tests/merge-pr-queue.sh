#!/usr/bin/env bash
# Cases for ops/foreman/merge-pr.sh (#663 item 3).
# Stubs `gh` so no network is touched. Verifies:
#   1. each skip rule (workflow, migration, release title, release author,
#      non-conventional title, empty PR)
#   2. merge queue ON  → GraphQL enqueuePullRequest, no REST merge
#   3. merge queue OFF → REST squash merge, no enqueue
#
#   bash ops/tests/merge-pr-queue.sh
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../foreman/merge-pr.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export STUB_LOG="$TMP/calls.log"
export TMP
: > "$STUB_LOG"

# --- stub gh -----------------------------------------------------------------
# Behaviour is driven by env files the test writes per case:
#   $TMP/pr.json        PR object
#   $TMP/files.json     files array
#   $TMP/queue.json     GraphQL branch-protection response
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
# emulate `gh api ... --jq <filter>`: serve the fixture, then apply the filter
serve() {  # serve <file> -- [gh args...]
  local f=$1; shift
  local jqf=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "--jq" ]; then jqf=$2; shift 2; else shift; fi
  done
  if [ -n "$jqf" ]; then jq -r "$jqf" "$f"; else cat "$f"; fi
}
args="$*"
if [[ "$args" == *"pulls/99/files"* ]]; then serve "$TMP/files.json" "$@"; exit 0; fi
if [[ "$args" == *"pulls/99"* && "$args" != *"merge"* ]]; then serve "$TMP/pr.json" "$@"; exit 0; fi
if [[ "$args" == *"/rulesets"* ]]; then serve "$TMP/queue.json" "$@"; exit 0; fi
if [[ "$args" == *"enqueuePullRequest"* ]]; then
  printf '%s' '{"data":{"enqueuePullRequest":{"mergeQueueEntry":{"id":"Q1","state":"QUEUED","position":3}}}}' \
    | serve /dev/stdin "$@"; exit 0
fi
if [[ "$args" == *"pulls/99/merge"* ]]; then
  printf '%s' '{"sha":"abc123","merged":true,"message":"Pull Request successfully merged"}' \
    | serve /dev/stdin "$@"; exit 0
fi
echo "UNEXPECTED: $args" >&2; exit 9
STUB
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export GH_TOKEN=fake

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "ok: $1"; }
notok(){ fail=$((fail+1)); echo "FAIL: $1"; }

mkpr() { # title author base state
  cat > "$TMP/pr.json" <<JSON
{"title":"$1","user":{"login":"$2"},"head":{"sha":"deadbeef12345678"},"node_id":"PR_node_1","base":{"ref":"$3"},"state":"$4"}
JSON
}

# --- skip rules ---------------------------------------------------------------
mkpr "feat(x): thing" "someone" "main" "open"; echo '[]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 2>&1) || true
[[ "$out" == "skip: empty PR (0 files)" ]] && ok "empty PR skipped" || notok "empty PR: $out"

mkpr "feat(x): thing" "someone" "main" "open"
echo '[{"filename":".github/workflows/ci.yml"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 2>&1) || true
[[ "$out" == skip:\ workflow\ PR* ]] && ok "workflow PR skipped" || notok "workflow: $out"

mkpr "feat(x): thing" "someone" "main" "open"
echo '[{"filename":"ai-adventure-scribe-main/db/migrations/0022_x.sql"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 2>&1) || true
[[ "$out" == skip:\ migration* ]] && ok "migration skipped" || notok "migration: $out"

mkpr "chore(main): release 0.38.0" "someone" "main" "open"
echo '[{"filename":"a.txt"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 2>&1) || true
[[ "$out" == skip:\ release\ PR* ]] && ok "release title skipped" || notok "release title: $out"

mkpr "feat(x): thing" "release-please[bot]" "main" "open"
out=$(bash "$SCRIPT" 99 2>&1) || true
[[ "$out" == skip:\ release\ PR* ]] && ok "release author skipped" || notok "release author: $out"

mkpr "do stuff" "someone" "main" "open"
out=$(bash "$SCRIPT" 99 2>&1) || true
[[ "$out" == skip:\ non-conventional\ title* ]] && ok "non-conventional title skipped" || notok "title: $out"

mkpr "fix(combat): thing (#621)" "someone" "other-branch" "open"
out=$(bash "$SCRIPT" 99 2>&1) || true
[[ "$out" == "skip: base is other-branch, not main" ]] && ok "non-main base skipped" || notok "base: $out"

# --- merge queue ON → enqueue, no REST merge ----------------------------------
mkpr "fix(combat): thing (#621)" "someone" "main" "open"
echo '[{"filename":"ops/foreman/merge-pr.sh"}]' > "$TMP/files.json"
cat > "$TMP/queue.json" <<'JSON'
[{"id":1,"name":"main protection","target":"branch","rules":[{"type":"merge_queue","parameters":{}}]}]
JSON
: > "$STUB_LOG"
out=$(bash "$SCRIPT" 99 2>&1)
[[ "$out" == *"enqueued: id=Q1 state=QUEUED position=3"* ]] && ok "queue ON → enqueued" || notok "enqueue: $out"
grep -q "enqueuePullRequest" "$STUB_LOG" && ok "enqueue mutation called" || notok "no enqueue call"
grep -q "pulls/99/merge" "$STUB_LOG" && notok "REST merge called while queue on" || ok "no REST merge while queue on"

# --- merge queue OFF → REST squash merge, no enqueue --------------------------
cat > "$TMP/queue.json" <<'JSON'
[{"id":1,"name":"main protection","target":"branch","rules":[{"type":"pull_request"}]}]
JSON
: > "$STUB_LOG"
out=$(bash "$SCRIPT" 99 2>&1)
[[ "$out" == *"merged: sha=abc123 merged=true"* ]] && ok "queue OFF → REST merged" || notok "rest merge: $out"
grep -q "pulls/99/merge" "$STUB_LOG" && ok "REST merge called" || notok "no REST merge call"
grep -q "enqueuePullRequest" "$STUB_LOG" && notok "enqueue called while queue off" || ok "no enqueue while queue off"

# --- dry run -------------------------------------------------------------------
: > "$STUB_LOG"
out=$(bash "$SCRIPT" 99 --dry-run 2>&1)
[[ "$out" == *"dry-run:"* ]] && ok "dry-run prints intent" || notok "dry-run: $out"
grep -q "enqueuePullRequest" "$STUB_LOG" && notok "dry-run enqueued" || ok "dry-run makes no mutation"

echo "--- $pass passed, $fail failed ---"
[ "$fail" = "0" ]
