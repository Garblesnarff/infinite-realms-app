# Jev pilot (offline)

Phase 1 of [#2277](https://github.com/Garblesnarff/infinite-realms-production/issues/2277). This directory is a Bun script. The app does not import it. It does not run during a live turn.

Jev (`typesafe/jev-1.13`) is a decision model. It answers typed questions. It does not write prose. This client calls the OpenRouter Decisions API:

`POST https://openrouter.ai/api/alpha/decisions`

It does **not** call `/api/v1/chat/completions`. Chat completions reject this model. The request body is `model`, `state`, and `questions` (`noul` for yes/no, `score` for a rubric). Questions that share one `state` go in one call.

The key is `OPENROUTER_API_KEY`. The script reads that name and never prints the value. If the variable is unset, the live command exits 2 and sends nothing. Unit tests use a mocked response.

## Experiments

Fixtures are quoted from the "Report — run" issues (#2230, #2231, #2189, #2188) and from the narration quoted on #2236 / #2249. No production user rows.

| | Fixture | What one call asks |
|---|---|---|
| A | `fixtures/narration.jsonl` (33 rows) | Six yes/no questions about one narration plus the engine facts |
| B | `fixtures/memory-rerank.jsonl` (22 rows) | One yes/no "relevant?" per candidate (12 each). Candidates live in `fixtures/memory-pool.jsonl` |
| C | `fixtures/importance.jsonl` (24 rows) | One Score per memory, batched 20 per call. Levels 0–4 are reported as 1–5 |

### A. Narration

The four questions named in #2277, plus the two #2236 rules the #2249 checker also scores, so a later comparison is on the same claims:

- `unresolved_action` — an attack, spell, Dash, or similar the engine did not resolve
- `false_turn_denial` — "not your turn" while the engine says it is the player's turn
- `invented_dice_result` — a hit, miss, or damage the engine did not produce, including success wording on a miss ("swings true")
- `speaks_for_the_player` — an action or spoken line the player did not declare. Restating a declared action is no
- `inflated_action_count` — one resolved attack told as a flurry or as several blows
- `scene_drift` — a place the scene field does not support (stone floor, chamber, halls on a rope over a chasm)

A noul of 0.5 is "cannot tell" (TypeSafe). The scorer treats that as an abstain: not a catch, and not a false flag. Above 0.5 is yes.

### B. Memory rerank

Two baselines, both reported next to Jev. Turning similarity back on in the live turn is #2282, not this pilot.

1. **Top by importance (live today).** `getRelevantMemories` ignores the player message and returns `loadTopMemories`: `GET /v1/memories?top=true`, ordered by the stored `importance` column, then `created_at` descending. The `VITE_ENABLE_SEMANTIC_MEMORIES` flag is unused. A pool row that carries `importance` and `created_at` is ranked that way. The GitHub-quote starter rows are not memory-table rows, so they have neither field and fall back to `calculateImportance`, with listed order as the tie-break.
2. **Raw similarity (offline).** `match_memories` orders by pgvector cosine distance: `ORDER BY embedding <=> query_embedding`, which is highest `1 - distance` first (`supabase/migrations/20260818_memories_embedding_vector768.sql`). Prod vectors are gemini-embedding-001, 768 dimensions, normalized. This pilot ranks the same way and does **not** apply the 0.7 floor (that floor drops rows; raw order ranks all of them). Put the stored document vector on each pool row as `embedding`, and the player-message `RETRIEVAL_QUERY` vector on the rerank row as `query_embedding`. If either is missing, that row's similarity recall is null. It is not filled in from list order.

The GitHub-quote starter set has no stored vectors, so similarity recall is null until a JSONL carries them. No production rows are copied into this repo.

A candidate is relevant when it is about the NPC, place, or creature the message addresses in that same run. Another campaign, or another run's monster, is a distractor. Top-5 recall is the fraction of hand-relevant ids that land in the first five.

### C. Importance

Jev scores the text on a 1–5 rubric (the API returns 0–4; we add 1). The baseline is `calculateImportance` in `src/utils/memory/importance.ts`, which returns 1–10 from type, category, length, a few keywords, and capitalised names. This tool keeps a copy of that function (`src/importance-baseline.ts`) because the app module imports `@/types/memory`. Scores 1–2, 3–4, 5–6, 7–8, and 9–10 map to 1–5. A returned `confidence` below 0.05 is an abstain (a flat distribution — do not act on it).

Hand labels use the same 1–5 rubric as the question, judged from the text. They are not the type points.

## Cost cap

The ledger stops **before** a request whose conservative estimate (about 3 characters per token) would take the run past **2,000,000 input tokens** (about $0.08 at $0.042 per 1M input tokens; output is free). Failed attempts reserve the estimate so retries cannot walk past the cap. When the provider returns `usage`, that count replaces the reservation. The run prints tokens and cost. Published price is the fallback when `usage.cost` is absent.

## Regex checker

#2249 is not merged. `origin/main` at the branch point has no `src/services/ai/narration-contract-check.ts`. Experiment A looks for that file under `--app-root` (default: the app root, three levels up). If it is missing, the result says `regex_checker: not-on-ref` and does not invent a comparison. When the file is present it must export `checkNarrationAgainstContract`.

## Run

From this directory:

```bash
bun test
bun src/cli.ts --dry-run
```

Live pass (needs the key; do not paste it into the shell history if you can avoid it):

```bash
OPENROUTER_API_KEY=... bun src/cli.ts --experiment all
```

`--experiment` is `A`, `B`, `C`, or `all` (default). Results go to `out/results.json` and `out/results.md`. `out/` is gitignored.

A dry run prints the token estimate, the fixture counts, and how often the importance baseline already matches the hand labels. It sends nothing.

Exit codes: `0` finished or dry-run, `1` over the cap or a request error, `2` live run with no key.
