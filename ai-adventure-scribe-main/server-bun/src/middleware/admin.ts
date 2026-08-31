/**
 * Admin Middleware for Elysia
 *
 * Provides admin-only access control.
 * Checks email or user ID against explicit admin allowlists.
 *
 * Ported from /server/src/middleware/admin.ts
 */

import { Elysia } from 'elysia';

import type { AuthTokenPayload } from './auth.js';

function parseList(value: string | undefined): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

const ADMIN_EMAILS = parseList(process.env.ADMIN_EMAILS);
const ADMIN_USER_IDS = parseList(process.env.ADMIN_USER_IDS);

/**
 * Check if a user has admin access
 */
export function isAdmin(user: { plan?: string; email?: string; userId?: string } | null): boolean {
  if (!user) return false;

  const email = user.email?.toLowerCase();
  const userId = user.userId?.toLowerCase();

  const allowedByEmail = email ? ADMIN_EMAILS.has(email) : false;
  const allowedById = userId ? ADMIN_USER_IDS.has(userId) : false;

  return allowedByEmail || allowedById;
}

/**
 * Required admin plugin
 * Returns 403 if user is not an admin
 */
export const requireAdmin = new Elysia({ name: 'require-admin' })
  // 'scoped' is REQUIRED: local-by-default hooks make a hook-only plugin
  // inert for the parent's routes (same bug class as bead -4ru).
  .onBeforeHandle({ as: 'scoped' }, (context) => {
    // `user` is supplied by the parent requireAuth plugin. A standalone Elysia
    // plugin cannot infer that parent's decorator at its declaration site.
    const { set } = context;
    const user = (context as typeof context & { user?: AuthTokenPayload | null }).user;
    if (!isAdmin(user ?? null)) {
      set.status = 403;
      return { error: 'Admin access required' };
    }
  });
