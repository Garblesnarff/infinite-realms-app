# Systems Deep Dive — LoreKeeper, Memory, MCP Servers, Agents

**Date:** 2026-08-04 · **Source:** code audit of the T7 checkout (`infinite-realms-production`)
**Method:** four parallel code audits + spot verification. Runtime state on the Hetzner VPS was not inspected — findings are from code, PM2 configs, and deploy scripts.
**Historical note:** The memory findings here were subsequently deepened by a second independent audit (GPT 5.6 Sol) and reconciled into [`docs/memory-system-design-v2.md`](../memory-system-design-v2.md), which is the authoritative design. At the time of this audit, the `narrative_facts` migration existed only on the unmerged `feat/narrative-ledger` branch. Later mainline commits added the migration, routes, prompt scene-state path, and additional writers; this repository-only sweep did not verify production database application or deployed code. The periodic-summary conclusion below was also true of the 2026-08-04 snapshot, but current web handlers now pass `turnCount` into the AI service.

> **SUPERSEDED (2026-08-13):** This document is retained as a point-in-time audit, not as a current architecture or deployment status report. Read the current-main correction below and [`memory-system-design-v2.md`](../memory-system-design-v2.md) before making implementation decisions.

---

## Current-main correction (2026-08-13)

Verified against `origin/main` `962f6c26`:

- The ledger foundation is now in main: `db/schema/narrative-state.ts`, `db/migrations/0007_narrative_facts.sql`, `NarrativeLedgerService`, and mounted `/v1/narrative-facts` routes provide session/name-keyed facts, history, supersession, and rendered scene state.
- `<scene_state>` is assembled as an explicit prompt section immediately before `<player_input>`. Render and fetch failures are observable, rather than being an undocumented regex-only relocation.
- Engine-owned writers now include combat terminal facts and DM handout possession facts. The structured `state_updates` module is still deliberately unwired, and XML memory/world-update parsing remains live.
- Combat persistence now crosses server-authorized Bun routes, including damage-log writes. Root CI has a real `server-vitest` Bun gate plus database guard jobs; root `AGENTS.md` exists; and `docs/combat-system-design-v2.md` records ratified D1–D8 decisions.
- The pre-v2 gaps remain: facts are session/name keyed, the server turn gateway and full playthrough/entity/event model are not built, `pendingDmFacts` remains separate, and the correction UI/episode hierarchy are future work.

Not re-verified by this repo-only sweep: production migration application and deployed VPS state; the exact live usage of MCP packages and semantic-memory paths; and whether every historical orphan recommendation remains safe to act on. Do not infer those answers from this audit.

## Historical TL;DR Verdicts (2026-08-04)

| System                          | Verdict                                            | One-liner                                                             |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| LoreKeeper (in-app service)     | **KEEP, but it's not what you envisioned**         | Live every starter-campaign turn — but as a bulk lore dumper, not RAG |
| LoreKeeper vector search        | **KILL (or consciously defer)**                    | pgvector embeddings are never queried. Dead since forever             |
| lore-keeper-mcp-server          | **KILL / archive**                                 | Never built, never deployed, zero references, frozen since Jun 21     |
| dnd-5e-mcp-server               | **KILL server, KEEP data**                         | Only its vendored SRD JSON is used (build-time import script)         |
| discord-mcp                     | **KEEP only if you still use it from Claude Code** | Dev tooling; no repo reference; frozen since Jun 21                   |
| Memory ledger (narrative_facts) | **FIX — highest-value target**                     | Half-wired: good design, one writer, silent failures                  |
| src/agents directory            | **PRUNE**                                          | ~60% orphaned code + a README describing files that don't exist       |

---

## 1. Historical LoreKeeper snapshot

**Short answer: it runs, but the vision didn't ship.**

**The vision** (per code comments + memory-system-design.md):

- Canonical read-only campaign bible store (`starter_campaigns` / `campaign_chunks` / `campaign_rules`)
- **Semantic retrieval**: pgvector `search_campaign_lore` picks the few relevant chunks per turn
- Causality rules (IF-THEN `campaign_rules`) to keep Franz consistent
- Dual access: in-process service for the app + MCP server for external tools

**The reality:**

- **Live path (confirmed):** `game-context-prompts.ts:74-87` → `getCampaignOverview` + `getRules` + `getEntities`, on every turn — but **only when `starterCampaignId` is set**. User-created campaigns never touch LoreKeeper.
- **It dumps, it doesn't retrieve.** All NPCs, locations, factions, items, monsters, and handouts go into every prompt wholesale. No ranking, no relevance filter. `searchLore()` (the vector path) has zero non-test callers.
- Only 3 of 11 service methods are used. The other 8 are test-only.
- Failures are swallowed: the whole lore block is wrapped in a try/catch that only warns.

**Recommendation:** keep the 3 live methods; delete the 8 dead ones; don't build RAG for canon (retrieval misses become canon contradictions — see v2 doc); measure prompt sizes; cap entities; fix the silent catch.

---

## 2. Historical memory snapshot

The two-tier design (narrative_facts ledger = truth; memories + lore = color) is good. It is **partially wired**:

**What's live:**

- `<scene_state>` renders from `narrative_facts`, re-injected at true end-of-prompt via an undocumented regex trick in `ai-service.ts:168-184` (fragile if content contains `</scene_state>`).
- Exactly **one** engine writer: combat end → dead/fled facts (`combat-ending.ts`).
- Memories: written per turn via the old XML `<memories>` hack; read back top-8 **by importance, not similarity** — `VITE_ENABLE_SEMANTIC_MEMORIES` is off by default, so embeddings are stored null and vector matching never runs.
- An undocumented second engine→prompt channel (`pendingDmFacts` on tactical maps) duplicates part of the ledger's job during combat.

**Designed but never built:** roll-outcome writer, handout writer, scene-boundary thread markers, the Path B `state_updates` gateway (schema file exists, zero importers), sheet-derived numbers in scene_state, correction UI, contradiction telemetry. The XML-in-JSON extraction the design said to kill is still the live write path.

**Fix list (superseded by v2 doc §5 — see Phase 0-3).**

---

## 3. Historical MCP server snapshot

**None are in any runtime path.** PM2 runs exactly one process (`infiniterealms-bun`, both ecosystem configs, `auto-deploy.sh`). No `.mcp.json`, no MCP client code, no stdio spawns anywhere in the repo. All three trees frozen at the 2026-06-21 bulk-import timestamp while combat code shows activity through Aug 2.

- **lore-keeper-mcp-server**: superseded by the in-app service. Never built (`dist/` missing). Drifted: OpenAI embeddings vs the app's Gemini ai-proxy. Zero references. → **Archive/delete.**
- **dnd-5e-mcp-server**: server code unreferenced, but `data/5e-database/` feeds `scripts/import-srd-content.mjs`, which baked ~3MB of SRD JSON into the app. → **Keep the data, delete the server code. Wire the import script into package.json.**
- **discord-mcp**: dev tooling for Claude Code, zero repo references. → **Keep only if actively used locally.**

---

## 4. Historical agent architecture snapshot

There is no agent orchestration; the real turn flow is: browser builds the whole prompt → `POST /v1/llm/generate` → server proxies to OpenRouter/Gemini. `src/agents` contributes exactly two leaf functions: memory read/write and starter-lore injection.

**Live:** `services/memory/` statics (MemoryService/Repository/ImportanceService), `services/lore-keeper/` (3 methods).
**Orphaned (frozen at Jun 21):** `SceneStateTracker`, the entire `messaging/` IndexedDB stack, `rules/validators/encounter-validator.ts` (+ dead `encounter-orchestrator.ts`), the MemoryService instance API, `agents/README.md` and a test report describing files that no longer exist.

**Recommendation:** delete the orphans in one PR. Rename `src/agents/` to something honest. The stale README is actively harmful — worker agents read it and build a wrong mental model.

---

## 5. The pattern worth naming

Across all four systems the same failure mode repeats: **a design gets built to ~40%, the live path quietly routes around it, and the docs/scaffolding stay behind describing the vision instead of the reality.** Rotating worker agents then read the scaffolding and make decisions against a system that doesn't exist. The single highest-leverage habit: when a design is abandoned or superseded, delete its code and update its doc in the same commit. Second: silent try/catch around core systems means you can't tell working from broken in prod — add loud failure signals before adding features.
