# GitHub Actions Workflows

This directory is `.github/workflows/` at the **repository root**. GitHub Actions
only discovers workflows here — it ignores any `.github/workflows/` folder nested
inside a subdirectory (e.g. the old `ai-adventure-scribe-main/.github/workflows/`).
All workflow files for this repo must live at this path.

The main application lives in `ai-adventure-scribe-main/`, so most jobs below set
`working-directory: ai-adventure-scribe-main` (either via `defaults.run` at the
workflow level, or per-step) to run commands against it from a repo-root checkout.

## Workflows

### ci.yml — Main CI
Triggers: every `push` and `pull_request` (no path filter — runs repo-wide).

Jobs:
- **frontend** — `bun install`, `bun run lint` (ESLint), `bunx tsc --noEmit`,
  `bunx vitest run` (frontend unit tests), `bun run build`.
- **server-vitest** — installs deps for the root app and for `server-bun`, then
  runs the complete Bun suite with per-file isolation from
  `ai-adventure-scribe-main/server-bun`. Isolation keeps a test fixture's
  process-wide `mock.module` replacements from changing another file's imports.
- **security-lint** — runs `node scripts/security-lint.js`, a custom static
  checker that flags route handlers missing auth/rate-limiting, unbounded
  `parseInt`, unsanitized `dangerouslySetInnerHTML`, error-message leakage, and
  hardcoded-secret patterns. Exits non-zero (fails the job) on any
  critical/high finding.
- **gitleaks** — runs `gitleaks/gitleaks-action@v2` against full git history
  (`fetch-depth: 0`), using the repo-root `.gitleaks.toml` config.
- **e2e** — runs `bun run e2e` (Playwright) from `ai-adventure-scribe-main`.
  Playwright starts its own API servers on ports 8891/8892 (see
  `ai-adventure-scribe-main/playwright.config.ts`) and needs `DATABASE_URL`,
  `CORS_ORIGIN`, `WORKOS_API_KEY`, and `WORKOS_CLIENT_ID` to boot `server-bun`
  successfully. **These are not yet configured as repo secrets**, so this job
  is marked `continue-on-error: true` and will not block merges until they are
  added. See "Secrets required" below.

### test-coverage.yml — Coverage Reporting
Triggers: `pull_request` (any branch) and `push` to `main`/`master`/`develop`,
both scoped to `paths: ai-adventure-scribe-main/**`.

Runs `bunx vitest run --coverage`, reads `coverage/coverage-summary.json`,
and emits a `::warning::` (non-blocking) if line coverage is below 40%.
Uploads the coverage report as a build artifact (`frontend-coverage`,
30-day retention) and comments the coverage percentage on pull requests.

### release.yml — Release & Changelog
Triggers: `push` to `main` scoped to `paths: ai-adventure-scribe-main/**`, and
manual `workflow_dispatch`.

Runs `googleapis/release-please-action@v4` in manifest mode for
`ai-adventure-scribe-main/`. It keeps the existing `v0.x.y` tag format and
changelog section conventions. The first run opens a release PR instead of
tagging immediately; merging that PR updates `package.json` and `CHANGELOG.md`,
creates the GitHub Release/tag, then makes the same best-effort (non-fatal)
POST to the internal blog API.

### dast-nightly.yml — Nightly DAST
Triggers: nightly cron (`0 3 * * *`) and manual `workflow_dispatch`.

Runs an OWASP ZAP baseline scan (`zaproxy/action-baseline@v0.10.0`) against
`${{ secrets.STAGING_URL }}` and uploads the HTML/JSON report as a build
artifact. Fails the job if ZAP finds issues (`fail_action: true`).

### claude.yml — Claude Code (@claude mentions)
Triggers: issue comments, PR review comments, PR reviews, and issues, but only
runs when the triggering body contains `@claude`. Invokes
`anthropics/claude-code-action@v1` to respond/act on the mention.

### claude-code-review.yml — Automated Claude PR Review
Triggers: `pull_request` opened/synchronize (repo-wide, no path filter).
Runs `anthropics/claude-code-action@v1` with a fixed review prompt and posts
the review as a PR comment via `gh pr comment`.

## Secrets / variables required

| Secret or variable | Used by | Notes |
|---|---|---|
| `STAGING_URL` | dast-nightly.yml | Target URL for the nightly ZAP scan. |
| `CLAUDE_CODE_OAUTH_TOKEN` | claude.yml, claude-code-review.yml | OAuth token for `anthropics/claude-code-action`. |
| `GITHUB_TOKEN` | release.yml, claude.yml, claude-code-review.yml, gitleaks job in ci.yml | Auto-provided by GitHub Actions; no setup needed. |
| `BLOG_API_KEY` | release.yml | Optional — "Post to blog" step is non-fatal if missing/failing. |
| `API_URL` (variable, not secret) | release.yml | Optional — defaults to `https://api.infiniterealms.app` if unset. |
| `DATABASE_URL` | ci.yml `e2e` job | Required for `server-bun` to boot; job is `continue-on-error: true` until set. |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | ci.yml `e2e` job | Same as above. |

`GITLEAKS_LICENSE` is only required if this repository is owned by a GitHub
Organization (not needed for a personal-account repo) — see the
`gitleaks/gitleaks-action` docs if that ever changes.

## Running things locally

```bash
cd ai-adventure-scribe-main

# Lint / type-check / unit tests (mirrors the `frontend` CI job)
bun run lint
bunx tsc --noEmit
bunx vitest run

# Server tests (mirrors `server-vitest`)
cd server-bun && bun test --isolate

# Security static-analysis (mirrors `security-lint`)
node scripts/security-lint.js

# Coverage (mirrors test-coverage.yml)
bunx vitest run --coverage

# E2E (mirrors the `e2e` job) — needs DATABASE_URL, CORS_ORIGIN,
# WORKOS_API_KEY, WORKOS_CLIENT_ID in your environment first
bun run e2e
```

## Notes / known gaps

- The `e2e` job is best-effort (`continue-on-error: true`) until the
  `server-bun` secrets above are added to the repo. Once configured, remove
  `continue-on-error` from `ci.yml` so failures block merges.
- `test-coverage.yml`'s 40% threshold check only emits a warning; it does not
  fail the job. If you want coverage to gate merges, change the `if` branch in
  the "Check coverage thresholds" step to `exit 1`.
- This README intentionally does not list test counts or coverage numbers —
  those change constantly and are better read live from the coverage artifact
  or the PR comment than hardcoded here.
