# Codebase Cleanup Phase 1 Inventory (2026-02-18)

This document defines a safe boundary for cleanup work before any deletions.

## Scope

- Host root inspected: `/var/www/infiniterealms`
- Confirmed runtime/deploy app: `/var/www/infiniterealms/ai-adventure-scribe-main`
- No files were deleted or modified as part of this phase.

## Evidence Summary

1. Production process configs point to `ai-adventure-scribe-main`:
`ecosystem.production.config.cjs` and `ecosystem.bun.config.cjs` both set:
`cwd: /var/www/infiniterealms/ai-adventure-scribe-main/server-bun`

2. Recent activity is concentrated in `ai-adventure-scribe-main` (latest writes on 2026-02-17), while sibling trees are older.

3. Top-level `.gitmodules` maps submodule path `infinite-realms` to repo URL `infinite-realms-clean`:
- path: `infinite-realms`
- url: `https://github.com/Garblesnarff/infinite-realms-clean.git`

4. One local tool currently depends on `infinite-realms-clean` by default:
- `tools/lore-keeper-ingest/src/index.ts:56`
- default `--repo-path` is `../../../infinite-realms-clean`

## Directory Classification

| Path | Size | Last Modified (UTC) | Classification | Notes |
|---|---:|---|---|---|
| `/var/www/infiniterealms/ai-adventure-scribe-main` | 1.3G | 2026-02-17 | Active | Runtime app + server |
| `/var/www/infiniterealms/infinite-realms` | 967M | 2026-01-08 | Blocked (submodule path) | Declared submodule in root `.gitmodules` |
| `/var/www/infiniterealms/infinite-realms-clean` | 157M | 2026-01-05 | Blocked (tool dependency) | Default source for lore ingest tool |
| `/var/www/infiniterealms/infinite-realms-production-backup` | 715M | 2025-11-22 | Archive candidate | Research/campaign backup tree |
| `/var/www/infiniterealms/infiniterealms-character-image-hotreload` | 862M | 2025-12-05 | Archive candidate | Old snapshot fork; no active runtime references found |
| `/var/www/infiniterealms/backups` | SQL dumps | 2026-02-18 | Keep | Operational DB backups |

## Phase 1 Decision Boundary

Safe to target in Phase 2+:

- In-repo dead code inside `ai-adventure-scribe-main` with no runtime references.
- Archive candidate trees:
  - `/var/www/infiniterealms/infinite-realms-production-backup`
  - `/var/www/infiniterealms/infiniterealms-character-image-hotreload`

Do not touch yet:

- `/var/www/infiniterealms/infinite-realms` (submodule mapping risk)
- `/var/www/infiniterealms/infinite-realms-clean` (tool default dependency risk)
- `/var/www/infiniterealms/backups` (operational restore path)

## Required Preconditions Before Any Directory Deletion

1. Confirm no cron/systemd/PM2 scripts still reference the candidate directory path.
2. Create a tarball snapshot of the directory to be removed.
3. Remove in one directory-at-a-time change, then verify deploy/startup still works.

## Suggested Phase 2 Starting Point (Low Risk)

Inside `ai-adventure-scribe-main` only:

1. Remove `src/App.css` after one final import check and build.
2. Remove unused battle-map dead components confirmed by import scan.
3. Leave TS/JS duplicate strategy for a later dedicated phase (higher coordination risk).

