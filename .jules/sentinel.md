## 2025-05-22 - [IDOR in Token Configurations]
**Vulnerability:** The `getDefaultTokenConfig` method in `TokenService` was fetching configurations based solely on `characterId`, allowing any authenticated user to retrieve settings for characters they did not own.
**Learning:** Even when Row Level Security (RLS) is disabled, it's tempting to rely on service-level checks, but these must be consistently applied across all retrieval paths, including 'default' or 'associated' configurations.
**Prevention:** Always verify resource ownership (e.g., via `verifyCharacterOwnership`) before accessing related tables that don't directly store a `user_id` column. Incorporate ownership checks into the initial database query's `where` clause to prevent existence-of-resource leakage.

## 2025-05-23 - [Insecure Public Procedures for Scene Assets]
**Vulnerability:** tRPC procedures for listing and getting drawings and measurement templates were marked as `publicProcedure` and lacked `userId` filtering in the underlying services. This allowed unauthenticated users to access sensitive campaign data.
**Learning:** Procedures that access assets tied to a private resource (like a scene) must be `protectedProcedure` even if they are only for "viewing". The service layer must then verify ownership of the parent resource (scene) using joins or nested queries.
**Prevention:** Audit all `publicProcedure` usage to ensure no private campaign data is exposed. Always pass `userId` from context to services for any data retrieval that isn't explicitly meant for the general public.

## 2025-05-24 - [Missing Dual-Ownership Checks and Existence Leakage]
**Vulnerability:** Several methods in `CharacterService` only verified `userId`, ignoring the `ownerId` field. Additionally, permission-related methods threw `FORBIDDEN` instead of `NOT_FOUND` when authorization failed, leaking the existence of characters to unauthorized users.
**Learning:** In systems with complex ownership (like PC assignment vs. creation), all authorization checks must account for all identity fields. Using generic `NOT_FOUND` errors for unauthorized access is critical for preventing IDOR scanning.
**Prevention:** Always check both `userId` and `ownerId` for characters. Ensure all service methods that verify access throw `NOT_FOUND` (404) rather than `FORBIDDEN` (403) to mask the existence of private resources.

## 2025-05-25 - [IDOR in Fog of War Revelation]
**Vulnerability:** Fog of War tRPC procedures (`reveal`, `conceal`, etc.) allowed a `targetUserId` parameter without verifying if the requester was authorized to modify that user's fog. This allowed any authenticated user to manipulate any other user's revealed map areas.
**Learning:** Even for user-specific data like Fog of War, authorization must be strictly enforced. A user should only be able to modify their own data or data for users they are "managing" (e.g., a DM managing players in their scene).
**Prevention:** Always validate that the requester (`ctx.user.userId`) is either the owner of the target data (`targetUserId === requesterId`) or the owner of the parent resource (scene owner). Consistently throw `NotFoundError` for unauthorized access to prevent existence leakage.

## 2025-11-12 - [Critical IDOR in Progression Service and Missing Dual-Ownership Logic]
**Vulnerability:** The `ProgressionService` lacked `userId` parameters and character ownership verification in all its methods, allowing any authenticated user to view or modify any character's XP and level data. Additionally, a critical bug was found in `CharacterService` where the `or` operator from Drizzle ORM was not imported, potentially breaking dual-ownership checks (userId vs ownerId).
**Learning:** Core services ported from other runtimes or older versions may lack the centralized security patterns required in the new Bun-based architecture. A missing import for a security-critical utility like `or` can silently degrade authorization logic.
**Prevention:** Always propagation `userId` from the route layer to the service layer. Incorporate ownership checks (`userId` AND `ownerId`) directly into the database query's `where` clause using `JOIN` or `EXISTS` to prevent IDOR and existence leakage. Audit all core services for missing user filtering when RLS is disabled.

## 2025-05-26 - [IDOR and Existence Leakage in Measurement Service]
**Vulnerability:** The `MeasurementService.createTemplate` method lacked any ownership verification, allowing any authenticated user to create measurement templates on any scene. Additionally, multiple methods (get, list, delete, cleanup) used `ForbiddenError` (403) for unauthorized access, leaking the existence of resources to unauthorized users.
**Learning:** Services ported from legacy systems or implemented "for simplicity" often omit critical ownership checks. High-frequency assets like measurement templates are prime targets for IDOR scanning if existence is leaked via 403 errors.
**Prevention:** Incorporate ownership checks directly into database `WHERE` clauses using `JOIN` with parent resources (e.g., `scenes`). Always throw `NotFoundError` (404) or return `null` instead of `ForbiddenError` (403) for unauthorized access to mask the existence of resources. Map these application-level 404s to `TRPCError({ code: 'NOT_FOUND' })` in the router.

## 2025-05-27 - [IDOR and Existence Leakage in Combat Services]
**Vulnerability:** Combat service methods (HP and Conditions) lacked verification that participants or conditions belonged to the encounter being accessed. Additionally, ownership verification returned 403 instead of 404, leaking resource existence.
**Learning:** Even with encounter-level authorization, sub-resources must be explicitly scoped to the verified parent in database queries to prevent cross-resource manipulation.
**Prevention:** Incorporate parent ID (e.g., `encounterId`) into all service methods and query `WHERE` clauses for sub-resources. Consistently use 404 for unauthorized access to valid IDs.

## 2025-05-28 - [Critical Missing User Filtering in Character Folders and Character Service]
**Vulnerability:** The `CharacterFolderService.getFolderSubtree` method was fetching all folders from the database without a `userId` filter. Additionally, `CharacterService.checkPermission` and `exportCharacter` fetched character data by ID before verifying ownership/permissions in the database query, potentially leading to existence leakage.
**Learning:** High-level service methods and recursive logic are often overlooked during security audits. Even when high-level gates exist, the underlying database queries should incorporate ownership filters for defense in depth. Character-related entities require complex checks involving both `userId`, `ownerId`, and the `character_permissions` table.
**Prevention:** Incorporate ownership and permissions directly into database `WHERE` clauses using `exists` subqueries for shared resources. Always filter by `userId` even for internal helper methods. Ensure that shared-resource retrieval masks existence by returning `null` for unauthorized IDs at the database level.

## 2025-05-29 - [Critical IDOR and Existence Leakage in Session Service]
**Vulnerability:** The `SessionService` methods lacked `userId` parameters and ownership verification, allowing any authenticated user to access or modify any game session. Additionally, the REST routes in `sessions.ts` performed separate ownership checks and returned 403 instead of 404, leaking the existence of sessions.
**Learning:** Transitioning from direct Supabase calls to a service layer requires careful propagation of authentication context. Mixed patterns (Supabase snake_case vs Drizzle camelCase) can lead to inconsistencies in security implementation if not managed centrally.
**Prevention:** Incorporate ownership checks directly into database queries using `EXISTS` subqueries that join with parent resources (`campaigns` and `characters`). Always filter by both `userId` and `ownerId` for character-related resources. Ensure all service methods mask existence by throwing `NotFoundError` (404) for unauthorized access.

## 2025-11-13 - [Critical IDOR and RLS Bypass in Spell Slots Service]
**Vulnerability:** The `SpellSlotsService` lacked `userId` parameters and performed no ownership verification, using direct Supabase calls without user filtering. This allowed any authenticated user to manage any character's spell slots. Additionally, stale `.js` files in the schema directory were causing test failures by masking new TypeScript exports.
**Learning:** Core game mechanics like spell slots are high-value targets for IDOR. Using the legacy Supabase client often leads to missing manual filters when RLS is disabled. Stale build artifacts in source directories can lead to confusing "undefined" errors during testing.
**Prevention:** Always migrate legacy services to Drizzle ORM and incorporate `userId`/`ownerId` checks into all data retrieval and modification paths. Regularly audit and clean up build artifacts (like `.js` files in `db/schema/`) that may conflict with TypeScript sources. Use `onBeforeHandle` in routes for defense-in-depth ownership verification.

## 2025-11-14 - [Critical IDOR and Existence Leakage in Combat Attack Service]
**Vulnerability:** The `CombatAttackService` lacked `userId` filtering in all its data retrieval and modification methods, allowing any authenticated user to access or modify weapon attacks and creature stats for any character or NPC. Additionally, the associated REST routes performed separate, incomplete ownership checks and returned 403 Forbidden instead of 404 Not Found, leaking the existence of characters.
**Learning:** Even with encounter-level authorization, sub-resources like weapon attacks must be explicitly scoped to the verified user in database queries. Separate ownership checks in the route layer are prone to errors and existence leakage.
**Prevention:** Incorporate ownership checks (`userId`/`ownerId` for characters, campaign ownership for NPCs) directly into the database query's `WHERE` clause using `EXISTS` subqueries. Consistently use `NotFoundError` (404) for unauthorized access to mask resource existence.

## 2026-02-10 - [Incomplete Ownership Verification in Database Updates]
**Vulnerability:** Service methods like `spendHitDice` and `restoreHitDice` in `RestService` were performing an initial ownership check before updating hit dice records, but the `UPDATE` queries themselves only filtered by hit die ID and character ID, without verifying the current user's ownership of the character. This could allow for a race condition or IDOR if an attacker could bypass the initial check or provide a valid ID for a resource they don't own.
**Learning:** Checking ownership at the beginning of a service method is good for early exit, but the database operation itself must incorporate the ownership check for atomicity and defense-in-depth, especially when Row Level Security (RLS) is disabled.
**Prevention:** Always incorporate ownership checks (`userId` and `ownerId`) directly into the `WHERE` clause of `UPDATE` and `DELETE` queries using `EXISTS` subqueries or joins.

## 2026-02-11 - [Missing Atomic Ownership Checks in Class Features Service]
**Vulnerability:** Several data-modifying methods in `ClassFeaturesService` (`grantFeature`, `useFeature`, `restoreFeatures`, `setSubclass`, `logFeatureUsage`) lacked atomic ownership checks in their database queries. While some had pre-flight checks, the actual `INSERT` and `UPDATE` operations did not verify the current user's authorization to modify the target character, potentially allowing for IDOR or race conditions.
**Learning:** High-level service methods often rely on early-exit ownership checks, but for defense-in-depth and atomicity (especially when RLS is disabled), the database operations themselves must include these checks. Complex mocking is required in tests to verify these sequential database calls.
**Prevention:** Incorporate dual-ownership checks (`userId` AND `ownerId`) directly into `UPDATE` where clauses using `EXISTS` and `INSERT` statements using `INSERT ... SELECT`. Use sequential mocking in Vitest to verify that each database interaction correctly implements these security boundaries.

## 2026-02-12 - [Information Leakage and Runtime Crash in Measurement Service]
**Vulnerability:** The `calculateAffectedTokens` method in `MeasurementService` was fetching all tokens in a scene regardless of their visibility status, allowing players to discover hidden NPCs by placing templates. Additionally, `cleanupTemporaryTemplates` used an unimported `sql` template literal for ownership verification, which would crash at runtime.
**Learning:** Security checks must extend to information disclosure, not just data modification. Even "read-only" calculations like AoE overlap can leak sensitive state (like hidden token positions) if they don't respect visibility and ownership rules.
**Prevention:** Always filter sub-resource queries (like tokens in a scene) by visibility and ownership when the requester is not a GM. Use idiomatic ORM helpers like Drizzle's `exists` instead of raw `sql` fragments to avoid missing import crashes and ensure consistency.

## 2026-02-12 - [Atomic Ownership Verification in Measurement Service]
**Vulnerability:** The `createTemplate` method in `MeasurementService` was using separate queries for scene ownership verification and template insertion. This "check-then-act" pattern is less secure than atomic operations and can lead to existence leakage.
**Learning:** Atomic database operations (`INSERT ... SELECT` and `DELETE ... WHERE EXISTS`) are the preferred way to enforce ownership when RLS is disabled. They prevent race conditions and ensure that the database itself gates the operation based on the user's identity.
**Prevention:** Avoid pre-flight ownership checks for data modification. Instead, incorporate the ownership filter directly into the `INSERT`, `UPDATE`, or `DELETE` query's `WHERE` clause using joins or subqueries. Mask resource existence by throwing `NotFoundError` if the atomic operation returns zero rows.

## 2026-02-14 - [Insecure Session Ownership Verification and IDOR in Chronicles]
**Vulnerability:** The `verifySessionOwnership` helper in the chronicles router performed ownership checks in application logic after fetching the session, leading to existence leakage. Additionally, several chronicle-related procedures lacked `userId` filtering, allowing users sharing a session to see or overwrite each other's chronicles (IDOR).
**Learning:** Shared resources (like game sessions) require consistent ownership verification across all routers. Even if a session is shared, sub-resources tied to it (like chronicles) may still be user-specific and must be explicitly scoped to `userId` to prevent IDOR and race conditions.
**Prevention:** Incorporate ownership verification (`campaigns.userId`, `characters.userId/ownerId`) directly into SQL `WHERE` clauses for all session-linked queries. Ensure all user-specific data is scoped by `userId` even when accessing via a shared parent ID.

## 2026-02-16 - [IDOR and RLS Bypass in Combat HP Service]
**Vulnerability:** `CombatHPService` modification methods used a "check-then-act" pattern, where database updates didn't incorporate ownership checks into their `WHERE` clauses, relying solely on pre-flight validation. This created a race condition and IDOR risk.
**Learning:** Even with centralized route protection (`onBeforeHandle`), the service layer must implement defense-in-depth by ensuring every database operation is atomic and explicitly scoped to the authenticated user's permissions.
**Prevention:** Always use `UPDATE ... WHERE EXISTS` or `INSERT ... SELECT` patterns that join with parent campaigns/characters to verify `userId` or `ownerId` in a single round-trip. Centralize these filters in service-level helpers to ensure consistency.

## 2026-06-17 - [Atomic Ownership Verification in Combat Initiative Service]
**Vulnerability:** Several data-modifying methods in `CombatInitiativeService` (`addParticipant`, `rollInitiative`, `reorderInitiative`) were using a "check-then-act" pattern. While they performed pre-flight ownership checks, the actual `INSERT` and `UPDATE` operations were not gated by the user's identity in the database query. This exposed the application to race conditions and potential IDOR.
**Learning:** Pre-flight checks are necessary for early exits and better error messaging, but the database operation itself MUST be atomic and incorporate ownership verification to ensure defense-in-depth, especially when Row Level Security (RLS) is disabled.
**Prevention:** Incorporate dual-ownership checks (`userId` AND `ownerId`) directly into `UPDATE` where clauses using `EXISTS` and `INSERT` statements using `INSERT ... SELECT`. Ensure that if no rows are affected by these atomic operations, a `NotFoundError` is thrown to mask resource existence.
