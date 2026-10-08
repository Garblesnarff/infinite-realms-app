/**
 * Authentication Router
 *
 * tRPC procedures for WorkOS AuthKit authentication including:
 * - Authorization URL generation
 * - Current user lookup
 *
 * @module server/trpc/routers/auth
 */

import { db } from '../../../../db/client';
import { workos, authConfig } from '../../services/workos.js';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';

/**
 * Auth router for WorkOS authentication
 */
export const authRouter = router({
  /**
   * Get WorkOS authorization URL for login
   * Redirects to hosted AuthKit UI
   */
  getAuthUrl: publicProcedure.query(() => {
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: authConfig.clientId,
      redirectUri: authConfig.redirectUri,
    });

    return { url: authorizationUrl };
  }),

  /**
   * Get current authenticated user
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // ⚡ Bolt: Use explicit column selection to avoid over-fetching Stripe IDs and timestamps.
    // This reduces data transfer for a high-frequency procedure.
    const userData = await (db.query as any).users.findFirst({
      where: (fields: any, { eq }: any) => eq(fields.id, ctx.user.userId),
      columns: {
        email: true,
        plan: true,
        firstName: true,
        lastName: true,
      },
    });

    // WorkOS access tokens carry no `email` claim unless a JWT template adds
    // one, so the users row (written on every OAuth callback) is the source.
    return {
      id: ctx.user.userId,
      email: ctx.user.email || userData?.email || null,
      plan: userData?.plan || 'free',
      firstName: userData?.firstName,
      lastName: userData?.lastName,
    };
  }),
});
