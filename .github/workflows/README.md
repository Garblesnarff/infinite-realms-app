# GitHub Actions Workflows

This directory is `.github/workflows/` at the repository root. GitHub Actions
only discovers workflows here. It ignores a `.github/workflows/` folder nested
inside a subdirectory. All workflow files for this repo live at this path.

The main application lives in `ai-adventure-scribe-main/`. Most jobs set
`working-directory: ai-adventure-scribe-main` so commands run against it from
a repo-root checkout.

This file describes the workflows. It is not a workflow, and editing it does
not change what Actions runs.

## Workflows

### ci.yml — CI

Triggers: `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`), `merge_group`, and `push` to `main`.

Jobs:

- **changes** — path filters that decide whether the heavy jobs run. `checks` does not depend on it and always runs.
- **checks** — one job, several steps. The steps include `node scripts/security-lint.js`, the gitleaks scan (skipped on `merge_group`), `bun run lint`, and the step "Server typecheck gate" (`scripts/server-typecheck-gate.sh`, allowlist `server-bun/typecheck-known-errors.txt`). Security lint, gitleaks, and the server typecheck are steps of this job, not jobs of their own. The job also checks that the two `AGENTS.md` copies match.
- **frontend-test** — Vitest in four shards. Runs when `changes` says the diff touches the frontend.
- **frontend-build** — `bun run build`, then the landing-preload check. Same frontend filter.
- **frontend** — roll-up. It succeeds only when `frontend-test` and `frontend-build` succeeded. The name stays `frontend` so the merge gate still finds that check.
- **server-vitest** — Bun server unit tests with per-file isolation, when `changes` says the diff touches the server.
- **server-real-db** — migration replay into `pgvector/pgvector:pg15`, then the `*.real-db.test.ts` suites. Production is PostgreSQL 15.8, which is why the image is pg15.
- **e2e** — job name `e2e (skipped — harness blocked by #1817)`. `if: false`. It does not run, and it is not `continue-on-error`. `bun run e2e` still runs the suite locally.

`ci.yml` does not run a frontend `tsc` step. The old `bunx tsc --noEmit` step checked nothing, because `ai-adventure-scribe-main/tsconfig.json` has `files: []`. Putting a real frontend typecheck in CI is a later change (#664) and is not wired here.

### coverage.yml — Coverage

Triggers: `schedule` (`0 8 * * *`) and `workflow_dispatch`.

Job **coverage** is `if: false` until the repository's public flip. The step it would run is `bunx vitest run --coverage`, uploaded as the `frontend-coverage` artifact. PR CI leaves coverage off (`coverage.enabled: false` in `ai-adventure-scribe-main/vitest.config.ts`).

### backups-guard.yml — Tracked Backups Guard

Triggers: every `push` and `pull_request`.

Job **no-tracked-backups** fails when `git ls-files -- 'backups/**'` finds a tracked file. Production dumps stay outside the repository.

### test-coverage.yml — Test Coverage Report

Triggers: `pull_request` on any branch and `push` to `main`, `master`, or `develop`, both limited to `ai-adventure-scribe-main/**`.

Job **coverage** is `if: false`. The workflow file still describes a warning when line coverage is under 40 percent. That warning does not run while the job is disabled.

### release.yml — Release & Changelog

Triggers: `push` to `main` limited to `ai-adventure-scribe-main/**`, and `workflow_dispatch`.

Job **release** runs `googleapis/release-please-action@v4` in manifest mode. After it creates a release it attempts `POST /internal/release-post`. That step is non-fatal if it fails.

### dast-nightly.yml — Nightly DAST

Triggers: `schedule` (`0 3 * * *`) and `workflow_dispatch`.

Job **zap-baseline** is `if: false`. The step it would run is `zaproxy/action-baseline` against `STAGING_URL` with `fail_action: true`.

### db-guards.yml — DB Guards

Separate from `ci.yml`, with `paths` filters, so it runs only when a database file changes.

Jobs:

- **schema-drift** — `scripts/check-schema-drift.sh`. No database.
- **migration-replay** — replays migrations into `pgvector/pgvector:pg15`.

## Secrets and variables

| Secret or variable                                   | Used by                                | Notes                                                                        |
| ---------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `STAGING_URL`                                        | dast-nightly.yml                       | Target URL for the nightly ZAP scan.                                         |
| `GITHUB_TOKEN`                                       | release.yml, gitleaks step in `checks` | Provided by GitHub Actions.                                                  |
| `BLOG_API_KEY`                                       | release.yml                            | The "Post to blog" step is non-fatal when this is missing.                   |
| `API_URL` (variable)                                 | release.yml                            | Defaults to the public API host already written in `release.yml` when unset. |
| `DATABASE_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` | local `bun run e2e`                    | The CI `e2e` job does not use them. It is skipped. See #1817.                |

`GITLEAKS_LICENSE` is only required if an organization owns the repository.

## Running the same checks locally

```bash
cd ai-adventure-scribe-main

bun run lint
bun run build
bunx vitest run

# The app-root tsconfig is a solution file. This command checks nothing.
bunx tsc --noEmit

# Server program. Fails on a new error and on a stale allowlist entry.
bash scripts/server-typecheck-gate.sh

cd server-bun && bun run test
cd .. && node scripts/security-lint.js
```

## Notes

- Do not describe `e2e` as `continue-on-error`. The job is off until #1817.
- `coverage` in `coverage.yml`, `coverage` in `test-coverage.yml`, and `zap-baseline` in `dast-nightly.yml` are `if: false`.
- This README does not list test counts or coverage numbers. Those change every run.
