# Bolt's Journal

## Established Patterns

### Vector Embedding Over-fetching
**Learning:** Selecting `*` on tables with vector embeddings (like `campaign_chunks.embedding`) transfers ~3KB per row for 768-dim vectors.
**Action:** Always use explicit column lists when querying lore tables to exclude the `embedding` column unless needed for similarity calculations.

### N+1 Query Batching
**Learning:** Common anti-pattern: fetching child relations individually in a loop (e.g., blog post categories, combat participant conditions, creature stats for AoE spells).
**Action:** Use `inArray` from `drizzle-orm` to fetch all child relations in a single batch query. For creature stats, use `getCreatureStatsBatch` pattern to reduce O(N) to O(1).

### Connection Pool Reuse
**Learning:** Creating new PostgreSQL pools per request (e.g., in tRPC context resolution) adds 10-50ms latency.
**Action:** Use the existing Drizzle `db` instance for context resolution. Use relational query callbacks to bypass cross-package drizzle-orm type conflicts.

### Redundant Database Fetches
**Learning:** Helper methods that re-fetch data already available in memory waste round-trips. Example: `getCurrentTurn` inside `getCombatState` re-fetching encounters and participants.
**Action:** Use Drizzle's relational queries (`db.query`) with `with` to fetch related data in a single round-trip. Perform dependent logic (like finding the current participant) in-memory.

### Synchronous Logging Blocking
**Learning:** `console.log(JSON.stringify(...))` in high-frequency WebSocket handlers and tRPC middleware blocks the Bun event loop.
**Action:** Use the pino-based `logger` utility with structured logging (passing objects) for non-blocking output.

### Batch Updates for State Changes
**Learning:** Sequential individual updates (e.g., deactivating superseded conditions one-by-one) can be consolidated. Sequential `await` calls for independent data can be parallelized.
**Action:** Use batch updates with `IN` clauses. Use `Promise.all` for independent data fetches in API routes.

### Consolidated Query Patterns
**Learning:** Sequential `findFirst`/`select` calls that depend on each other can be combined using `innerJoin` or `leftJoin`. "Verify then update" patterns can be made atomic by including ownership checks in the `WHERE` clause.
**Action:** For "set one active" operations, use `CASE WHEN id = :id THEN true ELSE false END` to toggle a single active row while deactivating others in one round-trip.

## Specific Fixes

### 2025-05-22 - Drizzle Type Conflicts
**Learning:** Conflicting versions of `drizzle-orm` in nested `node_modules` (root vs server-bun) cause type errors regarding private properties like `shouldInlineParams`.
**Action:** Ensure dependency versions are synchronized across the monorepo to avoid opaque type errors.

### 2025-05-22 - Corrupted Source Files
**Learning:** Found that source files can be truncated, causing build failures (unterminated string literals). This is an infrastructure issue, not a code issue.
**Action:** Always verify if a build failure is due to your changes or existing corruption before attempting fixes.

### 2026-06-25 - React Hook Consolidation
**Learning:** Monolithic components often have multiple `useMemo` and `useEffect` hooks that process the same source data sequentially (e.g., string cleaning -> asset parsing -> formatting). Each hook adds overhead to the React render cycle.
**Action:** Consolidate sequential data processing into a single `useMemo` block. This reduces the number of hooks React needs to track and ensures all derived data is calculated atomically.

## 2026-05-22 - Redundant Utility Calculations
**Learning:** Core calculation utilities (like `calculateAllCharacterStats`) often call sub-functions that re-calculate the same shared values (proficiency bonus, skill modifiers, etc.), leading to O(N^2) or multiple O(N) paths in what should be O(1) or single O(N) operations.
**Action:** Use parameter drilling to pass shared, pre-calculated values down to sub-functions. Add optional parameters to sub-function signatures to allow them to skip redundant work while maintaining backward compatibility.
