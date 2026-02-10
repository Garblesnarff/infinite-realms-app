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
