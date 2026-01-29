## 2025-05-22 - [IDOR in Token Configurations]
**Vulnerability:** The `getDefaultTokenConfig` method in `TokenService` was fetching configurations based solely on `characterId`, allowing any authenticated user to retrieve settings for characters they did not own.
**Learning:** Even when Row Level Security (RLS) is disabled, it's tempting to rely on service-level checks, but these must be consistently applied across all retrieval paths, including 'default' or 'associated' configurations.
**Prevention:** Always verify resource ownership (e.g., via `verifyCharacterOwnership`) before accessing related tables that don't directly store a `user_id` column. Incorporate ownership checks into the initial database query's `where` clause to prevent existence-of-resource leakage.
