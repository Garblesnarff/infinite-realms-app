/**
 * Blog Routes - Re-export
 *
 * This file re-exports from ./blog/index.ts so that existing imports
 * (e.g. `from './routes/v1/blog'`) continue to resolve correctly.
 *
 * All route logic now lives in the blog/ subdirectory modules:
 * - blog/posts.ts          - Post CRUD
 * - blog/posts-workflow.ts - Publish, schedule, review, archive, preview, slug check
 * - blog/categories.ts     - Category CRUD
 * - blog/tags.ts           - Tag CRUD
 * - blog/admin.ts          - Admin dashboard routes
 * - blog/media.ts          - Image upload / media management
 * - blog/index.ts          - Composed router
 */

export { blogApiRoutes } from './blog/index.js';
