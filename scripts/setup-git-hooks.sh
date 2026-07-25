#!/usr/bin/env bash
# =============================================================================
# Git hook setup
# =============================================================================
# Points git at the hooks in .husky/ and makes sure they are executable.
# Idempotent, dependency-free, and safe to run from any directory in the repo.
# Wired into the `prepare` script of both package.json files, so `bun install`
# in the repo root OR in ai-adventure-scribe-main sets hooks up either way.
#
# Why this exists rather than `husky`:
#
#   * The hooks live in .husky/ at the repo ROOT, but the package.json people
#     actually run `bun install` against is ai-adventure-scribe-main/. husky 9
#     refuses to install from a subdirectory -- it exits 1 with ".git can't be
#     found" -- so that `prepare: husky` could never have worked. The root
#     package.json's `prepare: husky` could not work either, because husky is
#     not one of its dependencies. Net effect: a fresh clone had no hooks at
#     all, so the secret-detection, commitlint and schema-drift checks were
#     silently doing nothing for anyone who had not configured it by hand.
#
#   * None of the hooks in .husky/ source husky.sh, so husky's generated
#     .husky/_/ shim directory buys nothing here. Setting core.hooksPath
#     directly is the whole job.
#
# core.hooksPath is local git config and can never be committed, so a fresh
# clone must run something. `bun install` is that something.
# =============================================================================

set -euo pipefail

GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  # Not a git repo -- e.g. a tarball export or a Docker build context.
  # Not an error: there is simply nothing to hook.
  echo "ℹ Not a git repository; skipping git hook setup."
  exit 0
}

cd "$GIT_ROOT"

if [ ! -d .husky ]; then
  echo "⚠ No .husky/ directory at $GIT_ROOT; skipping git hook setup."
  exit 0
fi

# core.hooksPath is resolved relative to the current working directory for
# git commands run in subdirectories, so it must be absolute to work from
# ai-adventure-scribe-main/ as well as the root.
git config core.hooksPath "$GIT_ROOT/.husky"

# Belt and braces for clones with core.fileMode=false, where a lost +x bit
# would leave git silently skipping every hook.
for hook in .husky/*; do
  [ -f "$hook" ] || continue
  case "$hook" in *.md) continue;; esac
  [ -x "$hook" ] || chmod +x "$hook"
done

echo "✓ Git hooks enabled (core.hooksPath -> $GIT_ROOT/.husky)"
