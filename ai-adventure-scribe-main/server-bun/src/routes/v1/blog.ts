/**
 * Blog Routes - Re-export
 *
 * This file re-exports from ./blog/index.ts so that existing imports
 * (e.g. `from './routes/v1/blog'`) continue to resolve correctly.
 *
 * All route logic now lives in the blog/ subdirectory modules:
 * - blog/posts.ts          - Post CRUD
 * - blog/categories.ts     - Category CRUD
 * - blog/media.ts          - Image upload / media management
 * - blog/index.ts          - Composed router
 *
 * blog/posts-workflow.ts, blog/tags.ts, and blog/admin.ts were removed in the
 * 2026-07-22 dead-code sweep (zero frontend/e2e/test callers).
 */

export { blogApiRoutes } from './blog/index.js';
