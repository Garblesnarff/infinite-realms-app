/**
 * Blog Routes - Composed Router
 *
 * Assembles all blog sub-routers into a single Elysia instance
 * with the /v1/blog prefix.
 *
 * Sub-modules:
 * - posts.ts       - CRUD for blog posts
 * - posts-workflow.ts - Publish, unpublish, schedule, review, archive, preview, slug check
 * - categories.ts  - Category CRUD
 * - tags.ts        - Tag CRUD
 * - admin.ts       - Admin dashboard routes
 * - media.ts       - Image upload / media management
 */

import { Elysia } from 'elysia';

import { blogAdminRoutes } from './admin.js';
import { blogCategoryRoutes } from './categories.js';
import { blogMediaRoutes } from './media.js';
import { blogPostWorkflowRoutes } from './posts-workflow.js';
import { blogPostRoutes } from './posts.js';
import { blogTagRoutes } from './tags.js';
import { planRateLimit } from '../../../middleware/rate-limit.js';

export const blogApiRoutes = new Elysia({ prefix: '/v1/blog' })
  .use(planRateLimit('default'))
  .use(blogPostRoutes)
  .use(blogPostWorkflowRoutes)
  .use(blogCategoryRoutes)
  .use(blogTagRoutes)
  .use(blogAdminRoutes)
  .use(blogMediaRoutes);
