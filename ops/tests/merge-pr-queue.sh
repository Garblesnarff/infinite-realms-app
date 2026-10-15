#!/usr/bin/env bash
# Cases for ops/foreman/merge-pr.sh (#663 item 3).
# Stubs `gh` so no network is touched. Verifies:
#   1. each skip rule (workflow, migration, release title, release author,
#      non-conventional title, empty PR)
#   2. merge queue ON  → GraphQL enqueuePullRequest, no REST merge
#   3. merge queue OFF → REST squash merge, no enqueue
#   4. the caller's expected head sha: required, refused on mismatch, pinned
#      in both merge calls
#   5. renames out of workflow/migration folders, the 3000-file cap, the PR
#      argument check, perf: titles
#   6. refusals before the merge: HOLD MERGES on #356/#230 (trusted authors
#      only, newest wins, unreadable refuses) and main CI (newest push run
#      must be completed/success); skip exits 3, refuse exits 1
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
#   $TMP/queue.json     GET rules/branches/main response (active rules)
#   $TMP/c356.json, $TMP/c230.json  issue comments (hold state)
#   $TMP/ci.json        GET actions/workflows/ci.yml/runs response
# A fixture whose content is FAIL makes that call exit 1 (a read error).
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
for k in issues/356/comments:c356 issues/230/comments:c230 actions/workflows/ci.yml/runs:ci; do
  if [[ "$args" == *"${k%%:*}"* ]]; then
    f="$TMP/${k##*:}.json"
    [ "$(cat "$f")" != FAIL ] || { echo "HTTP 502" >&2; exit 1; }
    serve "$f" "$@"; exit 0
  fi
done
if [[ "$args" == *"pulls/99/files"* ]]; then serve "$TMP/files.json" "$@"; exit 0; fi
if [[ "$args" == *"pulls/99"* && "$args" != *"merge"* ]]; then serve "$TMP/pr.json" "$@"; exit 0; fi
if [[ "$args" == *"rules/branches/main"* ]]; then serve "$TMP/queue.json" "$@"; exit 0; fi
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
SHA=deadbeef12345678deadbeef12345678deadbeef
OTHER=0123456789abcdef0123456789abcdef01234567
ok()   { pass=$((pass+1)); echo "ok: $1"; }
notok(){ fail=$((fail+1)); echo "FAIL: $1"; }

# Default: no hold, main CI green.
echo '[]' > "$TMP/c356.json"; echo '[]' > "$TMP/c230.json"
green() { echo '{"workflow_runs":[{"status":"completed","conclusion":"success","head_sha":"1111111122222222"}]}' > "$TMP/ci.json"; }
green
cmt() { # cmt <created_at> <author_association> <body> → one comment object
  jq -n --arg t "$1" --arg a "$2" --arg b "$3" '{created_at: $t, author_association: $a, body: $b}'
}

mkpr() { # title author base state
  cat > "$TMP/pr.json" <<JSON
{"title":"$1","user":{"login":"$2"},"head":{"sha":"$SHA"},"node_id":"PR_node_1","base":{"ref":"$3"},"state":"$4"}
JSON
}

# --- skip rules ---------------------------------------------------------------
mkpr "feat(x): thing" "someone" "main" "open"; echo '[]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == "skip: empty PR (0 files)" ]] && ok "empty PR skipped" || notok "empty PR: $out"

mkpr "feat(x): thing" "someone" "main" "open"
echo '[{"filename":".github/workflows/ci.yml"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == skip:\ workflow\ PR* ]] && ok "workflow PR skipped" || notok "workflow: $out"

mkpr "feat(x): thing" "someone" "main" "open"
echo '[{"filename":"ai-adventure-scribe-main/db/migrations/0022_x.sql"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == skip:\ migration* ]] && ok "migration skipped" || notok "migration: $out"

mkpr "chore(main): release 0.38.0" "someone" "main" "open"
echo '[{"filename":"a.txt"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == skip:\ release\ PR* ]] && ok "release title skipped" || notok "release title: $out"

mkpr "feat(x): thing" "release-please[bot]" "main" "open"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == skip:\ release\ PR* ]] && ok "release author skipped" || notok "release author: $out"

mkpr "do stuff" "someone" "main" "open"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == skip:\ non-conventional\ title* ]] && ok "non-conventional title skipped" || notok "title: $out"

mkpr "fix(combat): thing (#621)" "someone" "other-branch" "open"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == "skip: base is other-branch, not main" ]] && ok "non-main base skipped" || notok "base: $out"

# --- merge queue ON → enqueue, no REST merge ----------------------------------
mkpr "fix(combat): thing (#621)" "someone" "main" "open"
echo '[{"filename":"ops/foreman/merge-pr.sh"}]' > "$TMP/files.json"
cat > "$TMP/queue.json" <<'JSON'
[{"type":"pull_request","ruleset_source_type":"Repository","ruleset_source":"Garblesnarff/infinite-realms-app","ruleset_id":1,"parameters":{}},
 {"type":"merge_queue","ruleset_source_type":"Repository","ruleset_source":"Garblesnarff/infinite-realms-app","ruleset_id":1,"parameters":{"merge_method":"SQUASH"}}]
JSON
: > "$STUB_LOG"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1)
[[ "$out" == *"enqueued: id=Q1 state=QUEUED position=3"* ]] && ok "queue ON → enqueued" || notok "enqueue: $out"
grep -q "enqueuePullRequest" "$STUB_LOG" && ok "enqueue mutation called" || notok "no enqueue call"
grep -q "pulls/99/merge" "$STUB_LOG" && notok "REST merge called while queue on" || ok "no REST merge while queue on"

# --- merge queue OFF → REST squash merge, no enqueue --------------------------
cat > "$TMP/queue.json" <<'JSON'
[{"type":"pull_request","ruleset_source_type":"Repository","ruleset_source":"Garblesnarff/infinite-realms-app","ruleset_id":1,"parameters":{}}]
JSON
: > "$STUB_LOG"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1)
[[ "$out" == *"merged: sha=abc123 merged=true"* ]] && ok "queue OFF → REST merged" || notok "rest merge: $out"
grep -q "pulls/99/merge" "$STUB_LOG" && ok "REST merge called" || notok "no REST merge call"
grep -q "enqueuePullRequest" "$STUB_LOG" && notok "enqueue called while queue off" || ok "no enqueue while queue off"

# --- dry run -------------------------------------------------------------------
: > "$STUB_LOG"
out=$(bash "$SCRIPT" 99 "$SHA" --dry-run 2>&1)
[[ "$out" == *"dry-run:"* ]] && ok "dry-run prints intent" || notok "dry-run: $out"
grep -q "enqueuePullRequest" "$STUB_LOG" && notok "dry-run enqueued" || ok "dry-run makes no mutation"

# --- expected head sha ----------------------------------------------------------
cat > "$TMP/queue.json" <<'JSON'
[]
JSON
mkpr "fix(x): thing" "someone" "main" "open"
echo '[{"filename":"a.txt"}]' > "$TMP/files.json"
: > "$STUB_LOG"
rc=0; out=$(bash "$SCRIPT" 99 "$OTHER" 2>&1) || rc=$?
[ "$rc" = 1 ] && [[ "$out" == refuse:* ]] && ok "head differs from the approved sha → refuse, exit 1" || notok "mismatch: rc=$rc $out"
grep -qE "pulls/99/merge|enqueuePullRequest" "$STUB_LOG" && notok "merge called on a sha mismatch" || ok "no merge call on a sha mismatch"
rc=0; out=$(bash "$SCRIPT" 99 2>&1) || rc=$?
[ "$rc" = 2 ] && ok "missing expected sha → exit 2" || notok "missing sha: rc=$rc $out"
rc=0; out=$(bash "$SCRIPT" 99 deadbeef 2>&1) || rc=$?
[ "$rc" = 2 ] && ok "short expected sha → exit 2" || notok "short sha: rc=$rc $out"
: > "$STUB_LOG"
out=$(MERGE_EXPECT_SHA=$SHA bash "$SCRIPT" 99 2>&1)
[[ "$out" == *"merged: sha=abc123"* ]] && ok "MERGE_EXPECT_SHA works" || notok "env sha: $out"
grep -q "pulls/99/merge.*sha=$SHA" "$STUB_LOG" && ok "REST merge pins the approved sha" || notok "REST merge sha not pinned: $(cat "$STUB_LOG")"
cat > "$TMP/queue.json" <<'JSON'
[{"type":"merge_queue","ruleset_id":1,"parameters":{}}]
JSON
: > "$STUB_LOG"
bash "$SCRIPT" 99 "$SHA" > /dev/null 2>&1
grep -q "headOid=$SHA" "$STUB_LOG" && ok "enqueue pins the approved sha" || notok "enqueue sha not pinned: $(cat "$STUB_LOG")"
echo '[]' > "$TMP/queue.json"

# --- argument checks --------------------------------------------------------------
rc=0; bash "$SCRIPT" --dryrun "$SHA" > /dev/null 2>&1 || rc=$?
[ "$rc" = 2 ] && ok "unknown option → exit 2" || notok "unknown option rc=$rc"
rc=0; bash "$SCRIPT" 9x "$SHA" > /dev/null 2>&1 || rc=$?
[ "$rc" = 2 ] && ok "non-numeric PR → exit 2" || notok "non-numeric PR rc=$rc"

# --- renames, file cap, perf: -------------------------------------------------------
echo '[{"filename":"docs/old-ci.yml","previous_filename":".github/workflows/ci.yml"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == "skip: workflow PR (.github/workflows/ci.yml)" ]] && ok "rename out of workflows skipped" || notok "workflow rename: $out"
echo '[{"filename":"docs/0022_x.sql","previous_filename":"ai-adventure-scribe-main/db/migrations/0022_x.sql"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == skip:\ migration* ]] && ok "rename out of migrations skipped" || notok "migration rename: $out"
jq -n '[range(3000) | {filename: "f\(.).txt"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
[[ "$out" == skip:\ file\ list\ truncated* ]] && ok "3000 files skipped" || notok "3000 files: $out"
jq -n '[range(2999) | {filename: "f\(.).txt"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" --dry-run 2>&1) || true
[[ "$out" == *"dry-run:"* ]] && ok "2999 files not skipped" || notok "2999 files: $out"
mkpr "perf(dm): faster thing" "someone" "main" "open"
echo '[{"filename":"a.txt"}]' > "$TMP/files.json"
out=$(bash "$SCRIPT" 99 "$SHA" --dry-run 2>&1) || true
[[ "$out" == *"dry-run:"* ]] && ok "perf: title accepted" || notok "perf title: $out"

# --- skip exit code ---------------------------------------------------------------
mkpr "do stuff" "someone" "main" "open"
rc=0; out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || rc=$?
[ "$rc" = 3 ] && [[ "$out" == skip:* ]] && ok "skip exits 3" || notok "skip rc=$rc $out"
for p in ai-adventure-scribe-main/supabase/migrations/20261015_x.sql ai-adventure-scribe-main/drizzle/meta/_journal.json; do
  mkpr "fix(x): thing" "someone" "main" "open"; jq -n --arg f "$p" '[{filename: $f}]' > "$TMP/files.json"
  out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || true
  [[ "$out" == "skip: migration ($p)" ]] && ok "protected: $p" || notok "protected $p: $out"
done

# --- refusals: merge hold ------------------------------------------------------------
mkpr "fix(x): thing" "someone" "main" "open"; echo '[{"filename":"a.txt"}]' > "$TMP/files.json"
refused() { # refused <label> <expected refuse prefix>
  local rc=0 out; : > "$STUB_LOG"
  out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || rc=$?
  if [ "$rc" = 1 ] && grep -q "^refuse: $2" <<< "$out" && ! grep -qE "pulls/99/merge|enqueuePullRequest" "$STUB_LOG"; then ok "$1"; else notok "$1: rc=$rc $out"; fi
}
merged() { # merged <label>
  local rc=0 out; out=$(bash "$SCRIPT" 99 "$SHA" 2>&1) || rc=$?
  [ "$rc" = 0 ] && [[ "$out" == *"merged: sha=abc123"* ]] && ok "$1" || notok "$1: rc=$rc $out"
}
{ cmt 2026-10-14T06:29:32Z OWNER $'HOLD MERGES \u2014 strategist 06:32Z. Prod returns 521.\nmore'; } | jq -s . > "$TMP/c356.json"
refused "HOLD MERGES (with a reason after it) on #356 → refuse: hold" "hold"
{ cmt 2026-10-14T06:29:32Z OWNER 'HOLD MERGES'; cmt 2026-10-14T06:47:54Z MEMBER '  RESUME MERGES  06:48Z: back'; } | jq -s . > "$TMP/c356.json"
merged "RESUME MERGES after the hold → merges"
{ cmt 2026-10-14T06:47:54Z OWNER 'RESUME MERGES'; } | jq -s . > "$TMP/c356.json"
{ cmt 2026-10-14T07:00:00Z COLLABORATOR 'HOLD MERGES'; } | jq -s . > "$TMP/c230.json"
refused "a newer HOLD MERGES on #230 beats an older RESUME on #356" "hold"
{ cmt 2026-10-14T08:00:00Z NONE 'HOLD MERGES'; cmt 2026-10-14T08:00:01Z CONTRIBUTOR 'HOLD MERGES'; } | jq -s . > "$TMP/c230.json"
merged "HOLD MERGES from an untrusted author is ignored"
{ cmt 2026-10-14T08:00:00Z OWNER 'Status: we may need HOLD MERGES later'; cmt 2026-10-14T08:00:01Z OWNER 'HOLD MERGESX'; } | jq -s . > "$TMP/c230.json"
merged "a HOLD MERGES mention that does not start the comment is ignored"
echo FAIL > "$TMP/c230.json"
refused "hold comments unreadable → refuse" "cannot read merge-hold comments"
echo '[]' > "$TMP/c356.json"; echo '[]' > "$TMP/c230.json"

# --- refusals: main CI -----------------------------------------------------------------
echo '{"workflow_runs":[{"status":"in_progress","conclusion":null,"head_sha":"3333333344444444"}]}' > "$TMP/ci.json"
refused "main CI in progress → refuse" "main CI is not green"
echo '{"workflow_runs":[{"status":"completed","conclusion":"failure","head_sha":"3333333344444444"}]}' > "$TMP/ci.json"
refused "main CI failed → refuse" "main CI is not green"
echo FAIL > "$TMP/ci.json"
refused "main CI unreadable → refuse" "cannot read main CI"
echo '{"workflow_runs":[]}' > "$TMP/ci.json"
refused "no main CI run → refuse" "no push CI run"
green
merged "main CI green and no hold → merges"
grep -q "event=push" "$STUB_LOG" && grep -q "branch=main" "$STUB_LOG" && ok "main CI read is the push run on main" || notok "CI query: $(grep runs "$STUB_LOG")"

echo "--- $pass passed, $fail failed ---"
[ "$fail" = "0" ]
