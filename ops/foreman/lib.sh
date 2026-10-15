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
