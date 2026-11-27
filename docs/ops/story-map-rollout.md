# Story map rollout (Hetzner)

**For:** the Hetzner ops session. **Issue:** #1756 (maps 5/5) needs this done first. **Parent:** #1742.
**Rules:** AGENTS.md applies. Each migration apply, each merge and each `--apply` needs Rob's
typed line. Do not merge between a Playtest `run N started` and `run N ended` comment on #229.

This is the order to take the story map live: two database changes, two merges, then a
re-ingest of the four starter bibles with their routes. Each step is one paste. Stop at the
first step that prints `STOP`.

## What is already done

- `db/migrations/0038_story_map.sql` is applied on prod, and its ledger row is in place (#1703, 11-27 00:01:17Z).
- #1760 (maps 1/5) is merged.

## Before you start

- **Content:** the bibles need their `## Routes` sections. These are in content PR
  `Garblesnarff/infinite-realms-clean#47`, and The Eternal Feast's routes were still pending
  on #1757. The re-ingest (step 5) waits until that PR is merged. Steps 1 to 4 do not wait.
- **PRs and their PASS lines:** #1775 (route function, PASS), #1762 (maps 2/5, place and
  discovery), #1774 (maps 4/5, fight board). Each merges only on its own `Strategist review —
  PASS at <sha>` with a green pull_request CI run at the same head (AGENTS §1).
- **Stack:** #1774's base is #1762's branch. Retarget #1774 to `main` **before** #1762 merges
  (AGENTS §8), or #1762's branch deletion closes it.

## Step 0 — preflight (read-only)

```bash
set -euo pipefail
cd /var/www/infiniterealms/ai-adventure-scribe-main
git fetch origin main
docker exec supabase-db psql -U postgres -tAc 'select 1' | grep -qx 1 || { echo "STOP: database not reachable"; exit 1; }
docker exec supabase-db psql -U postgres -tAc "select filename, status, applied_at from public.schema_migrations where filename like '%story_map%' order by filename"
docker exec supabase-db psql -U postgres -tAc "select to_regclass('public.story_map_places') is not null, to_regclass('public.story_map_progress') is not null, to_regproc('public.replace_story_map_edges') is not null"
```

Expected: one ledger row, `db/migrations/0038_story_map.sql | applied`, then `t|f|f`. If
`story_map_progress` or the function already exists, that step was done; skip it below.

## Step 1 — apply the route function (for #1775), on Rob's typed line

This uses the file from #1775's PASS head. It runs in one transaction with a 5 s lock timeout,
and the ledger row is written in the same transaction.

```bash
set -euo pipefail
cd /var/www/infiniterealms/ai-adventure-scribe-main
git fetch origin claude/elegant-rubin-21oy2d-1752-followups
F=db/migrations/20261126_replace_story_map_edges.sql
git show FETCH_HEAD:ai-adventure-scribe-main/$F > /tmp/$(basename $F)
sha256sum /tmp/$(basename $F)
{ echo "SET lock_timeout = '5s';"; cat /tmp/$(basename $F); echo "INSERT INTO public.schema_migrations (filename, status, note) VALUES ('$F', 'applied', 'story map route function (#1775), ahead of its merge') ON CONFLICT (filename) DO NOTHING;"; } \
  | docker exec -i supabase-db psql -U postgres --single-transaction -v ON_ERROR_STOP=1
docker exec supabase-db psql -U postgres -tAc "select has_function_privilege('anon', 'public.replace_story_map_edges(text, jsonb)', 'execute'), has_function_privilege('service_role', 'public.replace_story_map_edges(text, jsonb)', 'execute')"
```

Expected last line: `f|t`. Post the ledger line on #1703, then merge #1775 with the normal
pre-merge procedure (`scripts/pre-merge-check.sh`).

## Step 2 — apply 0039 (for #1762), on Rob's typed line

```bash
set -euo pipefail
cd /var/www/infiniterealms/ai-adventure-scribe-main
git fetch origin claude/elegant-rubin-21oy2d-1753
F=db/migrations/0039_story_map_progress.sql
git show FETCH_HEAD:ai-adventure-scribe-main/$F > /tmp/$(basename $F)
sha256sum /tmp/$(basename $F)
{ echo "SET lock_timeout = '5s';"; cat /tmp/$(basename $F); echo "INSERT INTO public.schema_migrations (filename, status, note) VALUES ('$F', 'applied', 'story map progress tables (#1762), ahead of its merge') ON CONFLICT (filename) DO NOTHING;"; } \
  | docker exec -i supabase-db psql -U postgres --single-transaction -v ON_ERROR_STOP=1
docker exec supabase-db psql -U postgres -tAc "select count(*) from story_map_progress; select count(*) from story_map_revealed_edges; select has_table_privilege('anon', 'public.story_map_progress', 'select')"
```

Expected: `0`, `0`, `f`. Post the ledger line on #1703.

## Step 3 — merge, in this order

1. #1775 (if step 1 did not already merge it).
2. Retarget #1774 to `main`: `gh pr edit 1774 --base main`.
3. #1762, on its PASS and green CI at the same head.
4. #1774, on its own PASS and green CI at its head (after the retarget, CI runs again).

Each merge deploys within about 15 minutes. After each one:

```bash
curl -s https://api.infiniterealms.app/version
```

Check that `short` is the merge commit, before you go on.

## Step 4 — content checkout

The re-ingest reads the bibles from the content checkout next to the app. Confirm the path, and
that the routes are present, before the dry run.

```bash
set -euo pipefail
CONTENT_DIR=/var/www/infiniterealms/infinite-realms
test -d "$CONTENT_DIR/campaign-ideas" || { echo "STOP: no content checkout at $CONTENT_DIR"; exit 1; }
git -C "$CONTENT_DIR" fetch origin main
git -C "$CONTENT_DIR" checkout --detach origin/main
git -C "$CONTENT_DIR" log --oneline -1
grep -rlE '^## +([0-9]+\. *)?Routes *$' "$CONTENT_DIR/campaign-ideas/Completed" || echo "STOP: no bible has a ## Routes section yet (content #47 not merged?)"
```

The last command should list three or four `campaign_bible.md` files. A bible with no Routes
section still ingests; it gets places and no edges (step 6 says what to expect).

## Step 5 — re-ingest: dry run, then `--apply`, on Rob's typed line

The dry run reads the database (read-only) and prints, for each campaign, places, zones,
routes and any place key that would change. A route that names an unknown place stops the run
with its line number and writes nothing.

```bash
set -euo pipefail
cd /var/www/infiniterealms/ai-adventure-scribe-main
# The deploy checkout is at main after step 3; do not move it (auto-deploy owns it).
grep -q diffPlaceKeys scripts/reingest-starter-campaigns.ts || { echo "STOP: #1775 is not deployed here yet"; exit 1; }
bun scripts/reingest-starter-campaigns.ts --repo-path /var/www/infiniterealms/infinite-realms 2>&1 | tee /tmp/story-map-dry-run.log
grep -E 'story map|place keys|SKIP|route at' /tmp/story-map-dry-run.log
```

Read the `story map` lines against the table in step 6. Read every `place keys removed:` line:
a removed key drops that place's progress for players. Before the launch, no player has
progress, so the line is information only. Go on only if the four lines are there and no line
says `route at …`.

```bash
set -euo pipefail
cd /var/www/infiniterealms/ai-adventure-scribe-main
bun scripts/reingest-starter-campaigns.ts --repo-path /var/www/infiniterealms/infinite-realms --apply 2>&1 | tee /tmp/story-map-apply.log
grep -E 'story map wrote|place keys|wrote [0-9]+/' /tmp/story-map-apply.log
```

The apply re-embeds the chunks, like any re-ingest (it needs the embedding key in
`server-bun/.env`). Add `--skip-embeddings` only if the bibles changed nothing but the Routes
sections.

## Step 6 — verify, one SQL per table

```bash
docker exec supabase-db psql -U postgres -c "select campaign_id, count(*) as places, count(distinct zone_key) as zones from story_map_places group by 1 order by 1"
docker exec supabase-db psql -U postgres -c "select campaign_id, count(*) as edge_rows, count(*) filter (where hidden) as hidden_rows from story_map_edges group by 1 order by 1"
docker exec supabase-db psql -U postgres -c "select count(*) as progress_rows, count(distinct campaign_id) as campaigns from story_map_progress"
docker exec supabase-db psql -U postgres -c "select count(*) as revealed_rows from story_map_revealed_edges"
docker exec supabase-db psql -U postgres -c "select filename, status, applied_at from public.schema_migrations where filename like '%story_map%' order by filename"
```

What to expect, from the content counts on #1757 (places exclude zone overviews):

| Campaign | Places | Routes in the bible | Edge rows |
| --- | ---: | ---: | --- |
| `a-midsummer-nights-chaos` | 40 | 7 | 7 to 14 |
| `academy-of-arcane-gastronomy` | 20 | 8 (2 hidden) | 8 to 16 |
| `abyssal-descent` | 25 | 8 | 8 to 16 |
| `the-eternal-feast` | 26 | 0 until its routes land | 0 |

A two-way route (`<->`) is two edge rows and a one-way route (`->`) is one row, so edge rows fall
between the route count and twice it. Progress and revealed rows are `0` until players move.
There are three ledger rows: 0038, 0039 and the route function.

Then hand over to #1756 (the Playtest run).

## Rollback

Pick the smallest one that fixes the problem.

1. **Wrong map data** (bad routes or places). Remove the starter maps. Players then see no map
   button, and the DM gets no `<story_map>` block (there are no places), so nothing else
   changes. Fix the content and run step 5 again.

   ```bash
   docker exec supabase-db psql -U postgres --single-transaction -v ON_ERROR_STOP=1 \
     -c "delete from story_map_edges where campaign_id in ('a-midsummer-nights-chaos','academy-of-arcane-gastronomy','abyssal-descent','the-eternal-feast')" \
     -c "delete from story_map_places where campaign_id in ('a-midsummer-nights-chaos','academy-of-arcane-gastronomy','abyssal-descent','the-eternal-feast')"
   ```

2. **Code fault.** On Rob's line "You have my permission to revert #X", revert that PR's squash
   commit through a PR (AGENTS, Hetzner rules). Revert #1774 before #1762, because #1774 builds
   on it. Then confirm `/version`.
3. **Schema.** The tables and the function are additive, and the code that reads them fails
   open. Leave them in place after a code revert. Drop them only on Rob's typed line, and only
   after the revert is live:

   ```bash
   docker exec supabase-db psql -U postgres --single-transaction -v ON_ERROR_STOP=1 \
     -c "drop table if exists story_map_revealed_edges" \
     -c "drop table if exists story_map_progress" \
     -c "drop function if exists public.replace_story_map_edges(text, jsonb)" \
     -c "update public.schema_migrations set status = 'rolled_back' where filename in ('db/migrations/0039_story_map_progress.sql','db/migrations/20261126_replace_story_map_edges.sql')"
   ```

   Keep 0038's tables (`story_map_places`, `story_map_edges`) unless #1760 is also reverted.
