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
