# Shared guards for catjam-runner.sh and review.sh (#586). Sourced, not run.
# Pure functions only (no gh, no git), so ops/tests/foreman-guards.sh can test
# them in isolation.
#
# Pipelines: both scripts run under `set -o pipefail`, where `producer | grep -q`
# can report "no match" when grep exits early and the producer dies of SIGPIPE
# (exit 141). Every match here reads a variable through a here-string instead.

# Secret-shaped strings. Built from pieces so the repo's own pre-commit secret
# hook (.husky/check-secrets.sh) does not flag this line.
SK=sk
SECRET_RE="${SK}_live_|${SK}_test_|${SK}-ant-|ghp_[A-Za-z0-9]{20}|github_pat_|hooks\.slack\.com/services|-----BEGIN [A-Z ]*PRIVATE K""EY"

# has_secret_pattern <text>: 0 when the text contains a secret-shaped string.
has_secret_pattern() { grep -qE -- "$SECRET_RE" <<< "$1"; }

# diff_has_secret <unified diff text>: 0 when an ADDED line looks like a secret.
diff_has_secret() {
  local added
  added=$(grep -E '^\+' <<< "$1" || true)
  has_secret_pattern "$added"
}

# contains_env_secret <text>: 0 when the text contains the literal value of one
# of the env secrets, as-is or with whitespace removed. The comparison happens
# in-shell; the values never reach a command line, a file or a log.
FOREMAN_SECRET_VARS=(ANTHROPIC_API_KEY GH_TOKEN SLACK_WEBHOOK_URL)
contains_env_secret() {
  local text=$1 squeezed=${1//[[:space:]]/} var val
  for var in "${FOREMAN_SECRET_VARS[@]}"; do
    val=${!var:-}
    [ "${#val}" -ge 8 ] || continue
    if [[ $text == *"$val"* || $squeezed == *"$val"* ]]; then return 0; fi
  done
  return 1
}

# jq filter for issue comments: keep only "Strategist review" comments written by
# the token owner as OWNER/MEMBER. Anyone can comment on a public repo, so a
# stranger's "Strategist review — PASS at <sha8>" must not suppress a review,
# and a stranger's "FIX ... Required:" must not reach the model.
# Use: jq --arg me "$OWNER_LOGIN" "$TRUSTED_REVIEWS_JQ"   (input: comments array)
TRUSTED_REVIEWS_JQ='[.[] | select((.body // "" | startswith("Strategist review"))
  and .user.login == $me
  and (.author_association == "OWNER" or .author_association == "MEMBER"))]'

# jq filter for a pulls array: the open same-repo PR whose branch is catjam/<n>-*.
# Fork PRs can use any branch name, so head.repo must be this repo.
# Use: jq -r --arg repo "$REPO" --arg pfx "catjam/$n-" "$CATJAM_PR_JQ"
CATJAM_PR_JQ='[.[] | select(.head.repo.full_name == $repo and (.head.ref | startswith($pfx)))]
  | first // empty | "\(.number)\t\(.head.ref)"'

# ---- triage.sh (#717) --------------------------------------------------------
# Files a catjam or Jules task may never touch; an issue whose fix needs one goes
# to the crew. Paths may come with or without the ai-adventure-scribe-main/ prefix.
TRIAGE_HOT_RE='(^|/)(combat-resolution-step\.ts|DynamicOptionsSection\.tsx|combat-intent-service\.ts)$'
TRIAGE_CREW_RE='(^|/)migrations/|(^|/)\.github/|(^|/)ops/'
TRIAGE_CATJAM_MAX_FILES=4

# triage_route <verdict> <files, one per line> <repro test> <open PR files, "path<TAB>#n" per line>
# Prints "<catjam|jules|crew> <reason>". The model proposes; this decides.
triage_route() {
  local verdict=$1 files=$2 repro=$3 open=$4 f count=0 p pr
  if [ "$verdict" = crew ]; then echo "crew model"; return 0; fi
  case $verdict in catjam | jules) ;; *) echo "crew bad-verdict"; return 0 ;; esac
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    count=$((count + 1))
    if grep -qE -- "$TRIAGE_HOT_RE" <<< "$f"; then echo "crew hot-file $f"; return 0; fi
    if grep -qE -- "$TRIAGE_CREW_RE" <<< "$f"; then echo "crew protected-path $f"; return 0; fi
    while IFS=$'\t' read -r p pr; do
      [ -n "$p" ] || continue
      if [ "$p" = "$f" ] || [[ $p == */"$f" ]] || [[ $f == */"$p" ]]; then echo "crew open-pr $pr $f"; return 0; fi
    done <<< "$open"
  done <<< "$files"
  if [ "$count" = 0 ]; then echo "crew no-files"; return 0; fi
  if [ -z "${repro//[[:space:]]/}" ]; then echo "crew no-repro-test"; return 0; fi
  if [ "$verdict" = catjam ] && [ "$count" -gt "$TRIAGE_CATJAM_MAX_FILES" ]; then echo "jules files=$count"; return 0; fi
  echo "$verdict files=$count"
}

# triage_files_ok <answer json>: 0 when every files[] entry is a plain repo path
# (letters, digits and _ . / ( ) -, 1-200 characters). The entries are model-written
# and go into the issue body, so a newline, a heading, an @mention or a non-string
# entry sends the issue to the crew instead.
triage_files_ok() {
  jq -e '(.files | type == "array") and all(.files[]; type == "string" and test("\\A[A-Za-z0-9_./()-]{1,200}\\z"))' \
    <<< "$1" > /dev/null 2>&1
}

# TRIAGE_TASK_HEADING_RE: a "## Task" heading as Markdown reads it (up to 3
# leading spaces). The candidate gate and the re-check before a write use it.
TRIAGE_TASK_HEADING_RE='(?m)^ {0,3}## Task'

# triage_clean <markdown>: the model's task text made safe to append to an issue.
# Drops HTML comments (repeated until none is left, then any unclosed "<!--" or
# stray "-->"), turns #/## headings (up to 3 leading spaces) into ### so it
# cannot open a second "## Task" section, and strips the @ from mentions (no
# pings, no "@jules"). Capped at 8000 characters.
triage_clean() {
  local t
  t=$(perl -0pe '1 while s/<!--.*?-->//gs || s/<!--|-->//g; s/^ {0,3}#{1,2}(?=\s)/###/mg; s/(^|[^\w`])@(?=[A-Za-z0-9])/$1/g' <<< "$1")
  printf '%s' "${t:0:8000}"
}

# triage_task_deletes_tests <task text>: 0 when the model-written task asks to
# delete or remove tests. The catjam runner allows a test deletion only when the
# task lists it, so a model-written task must never do that; the crew decides.
# Matches over the whole text (dots and newlines included): rm/remove/delete/drop
# followed anywhere later by a test word or a test path. It errs towards the
# crew: "remove X, then make sure the tests pass" also matches.
triage_task_deletes_tests() {
  perl -0e 'exit(($ARGV[0] =~ /\b(?:rm|remov\w*|delet\w*|drop\w*)\b.*?(?:\btests?\b|\bspecs?\b|\.test\.|\.spec\.|__tests__\/|\btests\/)/is) ? 0 : 1)' -- "$1"
}

# has_pii <text>: 0 when the text holds an email address or an IPv4 address.
has_pii() { grep -qE -- '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' <<< "$1"; }

# model_family_of_text <text>: the model family named in the text
# (sonnet|opus|haiku|gpt|grok|gemini|catjam), or empty when none is named.
# Recognizes "model: <id>" / "author-model: <id>" lines and the name part of
# "Co-Authored-By: <name> <email>" lines, case-insensitively. First match wins.
# Pure: safe for the guard tests in ops/foreman/ (#662 item 1).
model_family_of_text() {
  local line id low
  while IFS= read -r line; do
    id=$(sed -nE 's/^[[:space:]]*(model|author-model|author_model)[[:space:]]*:[[:space:]]*([^[:space:],;]+).*/\2/Ip' <<< "$line")
    [ -n "$id" ] || id=$(sed -nE 's/^[[:space:]]*co-authored-by[[:space:]]*:[[:space:]]*(.*)/\1/Ip' <<< "$line")
    [ -n "$id" ] || continue
    low=${id,,}
    case $low in
      *opus*)   echo opus;   return 0 ;;
      *sonnet*) echo sonnet; return 0 ;;
      *haiku*)  echo haiku;  return 0 ;;
      *gpt*)    echo gpt;    return 0 ;;
      *grok*)   echo grok;   return 0 ;;
      *gemini*|*jules*) echo gemini; return 0 ;;
      *catjam*|*cat-jam*) echo catjam; return 0 ;;
    esac
  done <<< "$1"
  return 1
}
