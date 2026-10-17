/**
 * tRPC Root Router
 *
 * Combines all feature-specific routers into a single root router.
 * This file is the main entry point for the tRPC API.
 *
 * To add a new router:
 * 1. Create a new router file in ./routers/
 * 2. Import it here
 * 3. Add it to the appRouter definition
 *
 * Example:
 * ```typescript
 * import { campaignRouter } from './routers/campaign.js';
 *
 * export const appRouter = router({
 *   campaign: campaignRouter,
 *   auth: authRouter,
 * });
 * ```
 */

import { authRouter } from './routers/auth.js';
import { chroniclesRouter } from './routers/chronicles.js';
import { scenesRouter } from './routers/scenes.js';
import { router } from './trpc.js';

/**
 * Root tRPC router
 * Combines all feature routers
 *
 * Active routers:
 * - auth: WorkOS AuthKit authentication and user management
 * - chronicles: session chronicle reads and generation
 * - scenes: scene and map calls still used by the client scene files
 *
 * Future routers to be added:
 * - campaign: Campaign CRUD operations
 * - session: Game session handling
 * - ai: AI Dungeon Master interactions
 */
export const appRouter = router({
  auth: authRouter,
  chronicles: chroniclesRouter,
  scenes: scenesRouter,
});

/**
 * Export type definition of API for use in client
 * This type is used by tRPC client to provide end-to-end type safety
 */
export type AppRouter = typeof appRouter;
