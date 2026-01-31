# Bolt's Journal

## 2025-05-15 - Vector Embedding Over-fetching
**Learning:** Selecting `*` on tables with vector embeddings (like `campaign_chunks.embedding`) can lead to massive unnecessary data transfer (~3KB per row for 768-dim vectors).
**Action:** Always use explicit column lists when querying lore tables to exclude the `embedding` column unless specifically needed for similarity calculations.

## 2025-05-22 - [Drizzle N+1 Batching]
**Learning:** The blog posts tRPC router used an anti-pattern where child relations (categories/tags) were fetched individually for each post in a loop.
**Action:** Use `inArray` from `drizzle-orm` to fetch all child relations in a single batch query for the entire list of parent items.

## 2025-05-22 - [Corrupted Source Files & Build Failures]
**Learning:** Found that `ai-adventure-scribe-main/src/services/ai/context-builder.ts` was truncated at the end, causing a build failure (Unterminated string literal).
**Action:** Always verify if a build failure is due to your changes or existing corruption. If the file is truncated, report it as a separate infrastructure issue.

## 2025-05-22 - [Drizzle Type Conflicts]
**Learning:** Conflicting versions of `drizzle-orm` in nested `node_modules` (root vs server-bun) caused type errors regarding private properties like `shouldInlineParams`.
**Action:** When working in monorepos or nested projects, ensure dependency versions are synchronized to avoid opaque type errors.

## 2025-01-29 - [Combat Conditions N+1 & Truncated Files]
**Learning:** Found an N+1 query pattern in `server-bun/src/routes/v1/combat/status.ts` where participant conditions were fetched in a loop. Also discovered truncated files in `src/services/ai/` that broke the build.
**Action:** Always check for batching opportunities in loops hitting the DB. Use `db.execute(sql`...`)` for efficient multi-table joins when Drizzle relations aren't mapped. Ensure template literals with backticks are escaped to prevent Vite build failures.

## 2025-01-31 - [Redundant Combat State Queries]
**Learning:** The `CombatInitiativeService` was performing redundant database queries by calling `getCurrentTurn` inside `getCombatState` and `advanceTurn`. Each call re-fetched the encounter and all participants even when they were already available in memory.
**Action:** Avoid calling helper methods that repeat database fetches when the data is already available. Use Drizzle's relational queries (`db.query`) with `with` to fetch related data in a single round-trip, and perform dependent logic (like finding the current participant) in-memory.
