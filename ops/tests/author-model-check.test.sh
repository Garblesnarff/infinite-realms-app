#!/usr/bin/env bash
# Guard test for #662 item 1 (author never judges): model_family_of_text in
# ops/foreman/lib.sh maps "model:" / "author-model:" / "Co-Authored-By:" lines
# to a model family, or empty when no model is named.
#
#   bash ops/tests/author-model-check.test.sh
#
# Needs only bash; no network, no gh. Exits non-zero on the first failure.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/foreman/lib.sh
. "$HERE/../foreman/lib.sh"

pass=0 fail=0
expect_family() { # expect_family <name> <want: family|empty> <text>
  local name=$1 want=$2 text=$3 got=""
  got=$(model_family_of_text "$text" || true)
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); echo "FAIL $name (want '$want', got '$got')"
  fi
}

expect_family "model line, sonnet id"        sonnet  "Model: claude-sonnet-4-5-20250929"
expect_family "author-model line, gpt"       gpt     "author-model: gpt-6.1"
expect_family "author_model underscore, opus" opus   "Author_Model: claude-opus-4-6"
expect_family "co-authored-by, grok"         grok    "Co-Authored-By: Grok Bot <grok@example.com>"
expect_family "co-authored-by, gemini"       gemini  "Co-Authored-By: Jules (Gemini) <jules@example.com>"
expect_family "co-authored-by, haiku"        haiku   "Co-Authored-By: Muse Haiku <noreply@muse.dev>"
expect_family "model line, catjam"           catjam  "model: opencode/cat-jam-free"
expect_family "case-insensitive key"         sonnet  "MODEL: CLAUDE-SONNET-4-5"
expect_family "multiline body, first wins"   gpt     "$(printf 'Some report text\nmodel: gpt-5.2\nmodel: claude-opus-4-6')"
expect_family "no model named"               ""      "Just a normal PR body with no model line."
expect_family "co-authored-by without model" ""      "Co-Authored-By: Wonky <wonky@example.com>"
expect_family "empty text"                   ""      ""

echo "----"
echo "pass=$pass fail=$fail"
[ "$fail" = 0 ]
