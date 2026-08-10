# Memory & Continuity Architecture v2 — Playthroughs, the Ledger, and Years-Long Worlds

**Status:** Approved design. Supersedes `memory-system-design.md` (v1) and `memory-ledger-branch-notes.md` (stale — see §2).
**Date:** 2026-08-04
**Provenance:** Reconciled from two independent code audits (Claude Fable 5 via Cowork, GPT 5.6 Sol via Codex, both 2026-08-04) plus design decisions made with Rob. Every "current state" claim below was verified against code, not docs.

---

## 0. The product promise this design serves

A player can play in the SAME world for years — 50+ sessions — and the DM never contradicts established facts: deaths, ownership, quest outcomes, relationships, promises. Per-turn cost and coherence must stay flat as the world ages. This memory system is the product's #1 differentiator in the AI-RPG niche. Competitors use fuzzy recall (summaries, keyword lorebooks, vector search); they forget and contradict. We use deterministic truth plus compressed story. The marketable sentence: **"The DM that never forgets."**

**The one rule that governs everything: prompt size scales with the SCENE, not with the AGE of the world.** A turn in session 200 costs about the same as a turn in session 2.

**Facts and stories need different machinery.** Facts (who is dead, who owns what) get exact lookup — never similarity retrieval, because a retrieval miss becomes a canon contradiction. Stories (what happened, how it felt) get hierarchical compression, and MAY use retrieval, because a miss there only costs flavor.

---

## 1. Domain model — glossary and ownership

This section exists because the v1 schema was built session-first: anything needing a home got attached to `game_sessions`, producing session-scoped amnesia and eight identified concept collisions. Every worker agent MUST use these definitions. One concept, one owner, one name.

| Term | Definition | Owning table | Notes |
|---|---|---|---|
| **Campaign template** | The authored, read-only bible (setting, entities, rules, arcs) | `starter_campaigns` + `campaign_chunks` + `campaign_rules` | Versioned. Never mutated by play. |
| **Playthrough** | One character's journey through one campaign template (or user campaign). THE continuity boundary. Owns all mutable world state. | `playthroughs` (NEW) | = what the player "resumes". Replaces the implicit (campaignId, characterId) pair. |
| **Episode** | A span of play between natural breaks. Presentation/pacing only — NEVER a state boundary. | `episodes` (rename/reshape of `game_sessions`) | Soft boundaries: explicit end, 6–8h inactivity gap, long rest, arc close. |
| **Turn** | One player action and its committed consequences. The unit of the event log. | `world_events.turn_id` | NOT message count. NOT combat round. See D6. |
| **Entity** | A being/place/faction/item instance in a playthrough's world, with a stable UUID | `world_entities` (NEW) | Links to its canon template chunk if it originated in the bible. See D7. |
| **Event** | An immutable record of something that happened (roll resolved, death, handout, transfer), with idempotency key | `world_events` (NEW) | Facts and recaps DERIVE from events. |
| **Fact** | A typed, current-or-superseded assertion about an entity (bi-temporal) | `narrative_facts` (re-keyed) | Supersede, never overwrite. |
| **Thread** | An open narrative obligation: quest, promise, debt, mystery, foreshadowing | `threads` (NEW, absorbs `quests`) | Explicit open/resolved/failed/abandoned. |
| **Memory (episodic artifact)** | Compressed story: scene recap, episode recap, arc summary, chronicle | `episodic_artifacts` (evolves `memories` + `session_chronicles`) | Carries source event ranges for regeneration. |
| **World-day** | Monotonic in-game day counter per playthrough | `playthroughs.world_day` (NEW) | Advanced by long rests / explicit narration. See D5. |
| **Scene state** | The rendered ground-truth block injected into the prompt | derived (ledger render) | Not a table. |
| **Map** | Visual/tactical battle map with layers, tokens, fog-of-war | `scenes` (RENAME to `battle_maps` when convenient) | Unrelated to scene state. See D4. |

### Decisions resolving the audited ambiguities

- **D1 — Campaign template vs instance.** The template-to-play link (`starterCampaignId`) moves from `game_sessions` to `playthroughs`. A playthrough references its template exactly once.
- **D2 — Canon version pins per playthrough**, not per session. `campaignVersion` moves to `playthroughs`, set at creation. Upgrading canon mid-playthrough is an explicit user action that logs a `canon_upgraded` event.
- **D3 — Playthrough = (campaign instance + character), created once.** Characters bound to a playthrough cannot be deleted while it exists (restrict, not SET NULL). Multiple playthroughs of the same template are fully isolated worlds — this is the "3 characters, 3 viewpoints" feature. Cross-playthrough echoes are a flagged FUTURE idea, default isolation.
- **D4 — "Scene" is three things; name them apart.** `scenes` table = battle maps. `<scene_state>` = ledger render. `current_scene_description` blurb = write-only today; either feed it to episode-recap generation or delete the column. No new code may use the bare word "scene" for a new concept.
- **D5 — Add a world clock.** `world_day` integer on playthroughs, advanced by long rest and by explicit DM time-skip (a validated state_update). All new facts and events record `world_day`. Cheap now, impossible to retrofit later.
- **D6 — One turn counter.** A turn = one committed player action. The event log's `turn_id` is authoritative. `game_sessions.turn_count` (currently double-written by message-count AND client patch) becomes derived/display-only.
- **D7 — One body per NPC.** `world_entities` row per entity per playthrough, with `canon_chunk_id` linking bible-born entities. The `npcs`/`locations` name-keyed tables are migration sources, then frozen. Combat stat resolution and lore injection resolve through the registry.
- **D8 — Loose ends.** `ruleset` moves to playthrough. `rest_events` re-key to playthrough (and advance the world clock). `game_sessions.summary`/`session_notes`: unused write-only columns — delete.

---

## 2. Current state — what the reconciled audits established

Full detail: `docs/audits/SYSTEMS-AUDIT-2026-08-04.md` (Claude) and `MEMORY-AUDIT-GPT-2026-08.md` (GPT). Verified essentials:

> **Correction, 2026-08-09 (issue #1691).** Both 2026-08-04 audits, and this section as
> originally written, described the `feat/narrative-ledger` branch rather than deployed `main`.
> The branch was never merged; the T7 working tree simply sat on it. Until the PR that carries
> this correction, production had **no ledger of any kind** — no `narrative_facts` table, no
> `<scene_state>` injection, no `/v1/narrative-facts` routes, no combat fact writer. Items 3
> and 8 below are annotated accordingly. Verify ancestry (`git merge-base --is-ancestor`)
> before calling anything "live."

1. **Session amnesia is the root defect.** `memories` and `narrative_facts` are keyed to `session_id` (`db/schema/world.ts:124`, `db/schema/narrative-state.ts:52`). Every new session starts blank. The only bridge is the chronicle recap, built from the first 3 + last 3 DM messages truncated to 300 chars (`chronicle-generator.ts:162,194,216`), and it is NOT in the opening prompt (`use-initial-greeting.ts` fetches it but never passes it to `generateOpeningMessage`).
2. Prompt assembly is entirely client-side; `/v1/llm/generate` is a proxy. The server never reads memory tables on the turn path.
3. **The ledger does not exist in production.** (Corrected per #1691 — the description below is of the unmerged `feat/narrative-ledger` branch, not of `main`.) As built on that branch, and as first deployed by the #1691 rebase PR, it is half-built: one engine writer (combat dead/fled, `combat-ending.ts`), precedence one-sided (only `dm_delta` is blocked from superseding), name-keyed identity, insert race without retry. The silent read/write failures are fixed on the way in — the write path now fires `alert('narrative_fact_write_failed')` and the render path `alert('scene_state_render_failed')` (#1680/#1690). Note that its first deployment needs `db/migrations/0007_narrative_facts.sql` applied manually after the code ships; the table was verified absent from the prod database on 2026-08-09.
4. The live memory write path is regex-parsed XML inside the model's text response. The structured `state_updates` schema exists with zero importers. Client clamps importance 1–5 vs schema 1–10. Memory rows can be 100K chars — "top 8" is not a token bound.
5. The 20-turn campaign summary NEVER fires for real web players — no live handler passes `turnCount` (`use-message-handler-logic.ts:211`, `use-message-command-handler.ts:153`). It fires only in the headless playtest client. Playtests therefore look more coherent than real play.
6. Starter-campaign canon is bulk-dumped every turn with no cap; user-created campaigns get NO canon at all. `searchLore`/pgvector is dead code. Embedding drift: lore path 768-dim Gemini vs memories 1536-dim schema vs Drizzle `text` column.
7. World rows (`npcs`/`locations`/`quests`) are written from XML but their narrative content is never read back into any prompt; the NPC writer skips existing names, so status changes are discarded; quest writer forces `active`.
8. Additional live-path hazards: history pagination can misorder old pages as newest (`use-messages.ts:105-118`); state writes precede message persistence; suppressed roll-request responses still write memories; `<scene_state>` was regex-relocated over unescaped content on the unmerged branch — resolved before first deployment, since the #1691 rebase assembles the block as an explicit prompt piece in `ai-service.ts` (§3.3) instead of extracting it back out of the context section; streaming path skips combat-contract enforcement and usage recording; handout journal entries are never fed back to the DM.
9. Orphaned code (delete list): `SceneStateTracker`, `MemoryService` instance API, `src/agents/messaging/**` (IndexedDB stack), `encounter-validator`/`encounter-orchestrator`, `selection.ts`, legacy `shared/prompts/game-context-prompts.ts`, `use-chat-history`/`ChatPersistence`, `MemoryTester`, lore-keeper-mcp-server (whole package), 8 dead LoreKeeperService methods.

---

## 3. Target architecture

### 3.1 Data model (all NEW/changed tables keyed by `playthrough_id`)

```
playthroughs        id, user_id, campaign_id, character_id (restrict-delete),
                    starter_campaign_id, campaign_version, ruleset,
                    world_day, current_episode_id, created_at, last_played_at

world_entities      id (uuid), playthrough_id, canonical_name, aliases[],
                    entity_type, canon_chunk_id (nullable), created_by_event_id,
                    merged_into (nullable)

world_events        id, playthrough_id, turn_id, episode_id, world_day,
                    source ('engine'|'player'|'dm_validated'|'correction'),
                    kind (roll_resolved|death|item_transfer|handout|quest_change|
                          rest|scene_transition|time_skip|canon_upgraded|...),
                    payload jsonb, source_message_id, idempotency_key UNIQUE,
                    recorded_at            -- IMMUTABLE, append-only

narrative_facts     id, playthrough_id, entity_id (fk world_entities),
                    predicate, value jsonb (typed per predicate schema),
                    source_event_id, source_precedence, known_by[], is_belief,
                    needs_review, world_day_from, invalidated_at,
                    invalidated_by_fact_id
                    -- partial unique (playthrough, entity, predicate)
                    --   WHERE invalidated_at IS NULL
                    -- insert race: retry-on-conflict, never drop

threads             id, playthrough_id, kind (quest|promise|debt|mystery|
                    foreshadow|obligation), title, status (open|resolved|
                    failed|abandoned), participants[], salience,
                    opened_event_id, resolved_event_id, last_touched_event_id

episodes            id, playthrough_id, number, started_at, ended_at,
                    end_reason (explicit|inactivity|long_rest|arc_close),
                    first_event_id, last_event_id

episodic_artifacts  id, playthrough_id, tier (scene|episode|arc|chronicle),
                    content, source_event_range, version, stale boolean
```

Predicate families with JSON value schemas and transition rules: lifecycle (alive/dead/destroyed — dead→alive requires `correction` or `resurrection` event), location, possession (unique-item cardinality enforced), relationship/disposition, thread_status, promise/debt, faction_membership, knowledge/belief, condition. An unknown predicate from the LLM is staged (`needs_review`), never rejected silently, never injected until reviewed.

**Precedence (total order, enforced in code AND stated in the prompt):**
`engine event > adjudicated player correction > validated dm_delta > episodic color`.
For mutable world state, **ledger supersedes canon**; immutable canon constraints (setting physics, campaign rules) are enforced separately and cannot be superseded by dm_delta.

### 3.2 The turn transaction (server-side gateway)

Move game-turn prompt assembly and state application into one server endpoint (`POST /v1/playthroughs/:id/turn`). The current client-assembled `/v1/llm/generate` path remains for non-authoritative generation only.

1. Accept client `turn_id` (idempotency key). Replays return the committed result.
2. Commit the player's action as event(s); lock the playthrough turn stream.
3. Resolve scene roster, adjacent entities, active threads, critical invariants.
4. Assemble the bounded prompt (§3.3) from server-owned data.
5. Call the model with strict structured output: narrative + typed `state_updates` (evolve the existing `dm-response-schema-state-updates.ts` — it is the right shape, currently unwired).
6. Validate deltas: entity IDs resolve against the registry, predicate schemas, source authority, transition legality, contradiction check against current facts. Reject or stage; at most ONE corrective regeneration on conflict.
7. Atomically persist: DM message + accepted events/facts + thread transitions. No state write without its message; no hidden writes from suppressed responses.
8. Return committed narrative to the client.

This kills, by construction: XML-in-text parsing, write-before-persist, roll-request ghost writes, the client dedup-key gap, and the streaming/non-streaming enforcement gap (one path, one contract).

### 3.3 Bounded per-turn prompt (fixed order, per-section token budgets, all truncation logged)

```
[STABLE CANON PREFIX — byte-identical across turns of a playthrough]
  persona + immutable rules + campaign overview + world rules
  + compact entity directory (id, name, type, one-line immutable traits)
[CRITICAL INVARIANTS]      always-on terminal facts: deaths, unique-item
                           ownership, resolved main quests, world_day
[SCENE FACT PACK]          current facts for roster + location + one-hop
                           dependencies; hard entity cap; overflow logged
[THREADS]                  scene-relevant open threads + top-N urgent global
[EPISODIC CONTEXT]         chronicle (compact) + current arc summary
                           + last episode recap
[RECENT DIALOGUE]          contiguous newest turns within remaining budget;
                           an oversized newest message is summarized, never
                           silently skipped
[SCENE STATE + PLAYER INPUT at true end of prompt]
```

Rules: full entity descriptions are exact-retrieved by roster membership, not bulk-dumped (fixes the unbounded canon dump; also gives user-created campaigns a path — their entities live in the registry even without a bible). The stable prefix is content-hash versioned and sent as the system/first message for provider implicit caching; record cache-hit telemetry per turn. Escape or fence ALL dynamic content (entity names, fact values, memories, player input) — no raw interpolation into delimiters. If an authoritative section (invariants, scene pack) cannot fit, degrade LOUDLY (log + telemetry + explicit `<context_incomplete>` marker), never silently.

### 3.4 Episodic compression (the years-long story)

Immutable, provenance-carrying, incremental — never summaries-of-summaries without source ranges:

- scene closes → scene recap (from its event range + transcript slice)
- episode closes → episode recap (from scene recaps + critical events + player messages — fixes the 3+3-DM-messages chronicle starvation)
- every ~10 episodes or arc close → arc summary (from episode recaps + thread transitions)
- arc summaries → compact world chronicle

A correction marks overlapping artifacts `stale` and regenerates only those ranges. Retrieval (vector or keyword) over episode recaps is PERMITTED for flavor recall, budget-capped, results carry world_day + entities. Replaces importance-sorted top-8 `memories` as the story channel.

### 3.5 Corrections

Player-facing "Correct the record" on journal/codex entries → creates a `correction` event + superseding fact, never edits history → regenerates stale artifacts. Engine-proven outcomes show an explicit conflict instead of silently yielding. (The API route exists — `POST /v1/narrative-facts` — it needs a UI and re-keying.)

### 3.6 Product surfaces (free wins from the same data)

- **"Previously on…"** at episode start, IN the opening generation prompt (fix the current ordering bug immediately, even pre-v2).
- **Player journal/codex**: chronicle, threads, entity fact-sheets, handouts as an in-world tome — the visible proof of "the DM that never forgets".
- **FUTURE (enabled by the event log, not scoped now):** branching saves ("rewind to chapter 3"), cross-playthrough echoes.

---

## 4. Keep / fix / kill map (current code → v2)

| Current | Verdict |
|---|---|
| `narrative_facts` + ledger service | KEEP core; re-key to playthrough+entity; fix precedence matrix, insert-race retry, provenance-on-unchanged; loud failures |
| `LoreKeeperService` (3 live methods) | KEEP as canon reader feeding the stable prefix + entity directory; DELETE 8 dead methods, `searchLore`, chunk embeddings |
| `state_updates` schema module | PROMOTE — becomes the validated delta channel (step 5 of turn transaction) |
| XML `<memories>`/`<world_updates>` parsing | KILL after dual-write telemetry confirms parity (keep parser temporarily as telemetry to count missed deltas) |
| `memories` table + top-8 retrieval + client heuristics + importance scoring | REPLACE with episodic_artifacts hierarchy; migrate rows as low-confidence episodic source material |
| `session_chronicles` + "Previously on" | KEEP concept; re-source from episode recaps; inject into opening prompt |
| `pendingDmFacts` tactical buffer | FOLD into world_events (it is Path A with worse plumbing) |
| `npcs`/`locations`/`quests` tables | FREEZE after migration into world_entities/facts/threads |
| `game_sessions` | RESHAPE into `episodes` under playthroughs |
| Orphan list in §2.9 | DELETE in one PR, including stale `src/agents/README.md` and `memory-ledger-branch-notes.md` |

---

## 5. Phased work order (each phase = one dispatchable work package with acceptance criteria)

**Phase 0 — Observability + quick wins (hours, ship immediately, no schema change)**
Loud failures (Slack alert / metric) on: lore injection catch, scene-state read null, ledger write fail. Per-section prompt token telemetry. Pass the chronicle recap into `generateOpeningMessage`. Widen chronicle sources (all DM+player messages, larger cap). Fix history pagination ordering. Delete orphan code + stale docs.
*Accept: alerts fire in prod on injected failure; opening prompt contains recap text in a session-2 playtest; orphan grep returns zero.*

**Phase 1 — Playthrough anchor (the re-key)**
Create `playthroughs`; backfill one per distinct (campaign, character) with sessions ordered under it; add `playthrough_id` to memories, narrative_facts, rest_events, chronicles (keep session_id during transition); move `starterCampaignId`, `campaignVersion`, `ruleset` to playthrough; restrict character deletion. Resume UI lists playthroughs. **Migration in BOTH trees or per the consolidation plan — the split migration trees are a known landmine.**
*Accept: a new session in an existing playthrough sees prior facts in `<scene_state>`; 3 characters × 1 campaign = 3 isolated worlds in a playtest.*

**Phase 2 — Entity registry + event log + deterministic writers**
`world_entities` (backfill from canon chunks + npcs + fact subject names, alias-merge pass), `world_events` with idempotency keys. Dual-write engine writers: combat end (exists), roll outcomes, handout delivery, item transfer, rest (advance `world_day`), scene transition. Re-point fact identity to entity_id.
*Accept: spike script replays a playtest transcript and every death/handout/roll appears as exactly one event; re-running is idempotent.*

**Phase 3 — Server turn gateway + validated deltas**
`POST /v1/playthroughs/:id/turn` per §3.2; wire `state_updates` into the DM schema; validator + staging; XML parsers demoted to telemetry; one corrective-regeneration loop; atomic persistence.
*Accept: agent playtest (30-turn CLI) passes with zero XML-sourced state writes; kill-switch env flag reverts to legacy path.*

**Phase 4 — Bounded prompt + caching**
Layered assembly per §3.3 server-side; entity-capped scene packs; critical invariants; stable hashed prefix as system message; cache-hit + truncation telemetry.
*Accept: measured per-turn tokens flat (±10%) between turn 5 and turn 300 of a long playtest; cache-hit rate visible in telemetry.*

**Phase 5 — Episodes + compression hierarchy**
Episodes with soft boundaries; scene/episode/arc/chronicle generation jobs; retrieval over recaps; migrate legacy memories as episodic source material; retire top-8.
*Accept: session-50 simulated playtest: DM correctly references a session-3 fact (ledger) and a session-3 event (recap) with flat prompt size.*

**Phase 6 — Journal/codex + corrections UI**
Player-facing tome; "Correct the record"; stale-artifact regeneration.
*Accept: player corrects an NPC fact; next turn's scene_state reflects it; affected recap regenerates.*

Phases 0–1 are the unlock; nothing else lands without them. 2→3→4 in order; 5–6 parallelizable after 3.

---

## 6. Guardrails for worker agents (read before touching anything)

1. Never key new world state to `session_id`/`episode_id`. Continuity keys are `playthrough_id` + `entity_id`. Episodes are provenance, not scope.
2. Never use display names as identity. Resolve through `world_entities`; unknown names create staged entities, not silent new identities.
3. No silent catch on continuity paths. Degrade loudly or fail the turn.
4. Facts come from events with idempotency keys. No writer without one.
5. Do not "fix" the ledger by loosening validation; stage and surface instead. (Same spirit as the authored stat-block parser rule.)
6. When you change behavior, update THIS doc and delete superseded docs in the same commit. Stale docs misdirect the next agent — this codebase has been bitten repeatedly (see `memory-ledger-branch-notes.md` history).
7. Each table's DDL lives in exactly ONE migration tree — Drizzle (`db/migrations/`) for app tables; `supabase/migrations/` only for Supabase-platform concerns (RLS/grants/RPCs). CI's schema-drift and migration-replay guards enforce consistency; never duplicate DDL across trees. (Corrected 2026-08-09: this guardrail previously read "never add a table to only one tree", which reads as an instruction to duplicate DDL and produced exactly that in the #1691 ledger PR — two equivalent `narrative_facts` migrations that collided on replay.)
8. Prompt sections are budgeted and ordered; do not reorder the stable prefix or interpolate unescaped content.
9. Verify your deliverable is on GitHub before reporting done.

## 7. Open questions (Rob to decide; defaults chosen so work can proceed)

1. User-created campaigns: generate canon entities into the registry at creation (default), or leave canon-less?
2. Retention: keep raw `world_events` forever (default: yes — it's the moat and enables branching saves), or archive beyond N?
3. `battle_maps` rename timing (default: opportunistic, not a dedicated PR).
4. Cross-playthrough echoes: parked (default) — revisit post-launch.
