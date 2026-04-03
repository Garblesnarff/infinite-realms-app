/**
 * Admin Middleware for Elysia
 *
 * Provides admin-only access control.
 * Checks email or user ID against explicit admin allowlists.
 *
 * Ported from /server/src/middleware/admin.ts
 */

import { Elysia } from 'elysia';

function parseList(value: string | undefined): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
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
  .onBeforeHandle(({ user, set }) => {
    if (!isAdmin(user)) {
      set.status = 403;
      return { error: 'Admin access required' };
    }
  });
