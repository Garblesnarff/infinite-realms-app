/**
 * Blog Routes - Composed Router
 *
 * Assembles all blog sub-routers into a single Elysia instance
 * with the /v1/blog prefix.
 *
 * Sub-modules:
 * - posts.ts       - CRUD for blog posts
 * - categories.ts  - Category CRUD (frontend uses direct Supabase for reads/
 *                    writes; the POST handler here is kept only because
 *                    e2e/auth-role-*.spec.ts exercise it as an admin-gated
 *                    auth-boundary regression check)
 * - media.ts       - Image upload / media management
 *
 * Removed 2026-07-22 dead-code sweep (zero frontend/e2e/test callers):
 * - posts-workflow.ts - Publish, unpublish, schedule, review, archive, preview, slug check
 * - tags.ts           - Tag CRUD
 * - admin.ts          - Admin dashboard routes
 */

import { Elysia } from 'elysia';

import { blogCategoryRoutes } from './categories.js';
import { blogMediaRoutes } from './media.js';
import { blogPostRoutes } from './posts.js';
import { planRateLimit } from '../../../middleware/rate-limit.js';

export const blogApiRoutes = new Elysia({ prefix: '/v1/blog' })
  .use(planRateLimit('default'))
  .use(blogPostRoutes)
  .use(blogCategoryRoutes)
  .use(blogMediaRoutes);
