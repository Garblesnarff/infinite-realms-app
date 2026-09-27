/**
 * Authentication Router
 *
 * tRPC procedures for WorkOS AuthKit authentication including:
 * - Authorization URL generation
 * - OAuth callback handling
 * - User session management
 * - Logout
 *
 * @module server/trpc/routers/auth
 */

import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../../../db/client';
import { users } from '../../../../db/schema/index';
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
   * Handle OAuth callback
   * Exchange authorization code for user session
   */
  callback: publicProcedure
    .input(
      z.object({
        code: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      // Authenticate with WorkOS using the authorization code
      const { user, accessToken, refreshToken } = await workos.userManagement.authenticateWithCode({
        code: input.code,
        clientId: authConfig.clientId,
      });

      // ⚡ Bolt: Optimized N+1 query pattern by replacing 'find-then-upsert-then-find' with a single atomic UPSERT.
      // This reduces database round-trips from 2-3 down to 1 for every authentication callback.
      // Explicitly return only the plan column to avoid over-fetching.
      const [userData] = await db
        .insert(users)
        .values({
          id: user.id,
          email: user.email,
          plan: 'free',
          firstName: user.firstName || null,
          lastName: user.lastName || null,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: user.email,
            firstName: user.firstName || null,
            lastName: user.lastName || null,
            updatedAt: new Date(),
          },
        })
        .returning({
          plan: users.plan,
        });

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          plan: userData.plan,
        },
        accessToken,
        refreshToken,
      };
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

  /**
   * Logout - revoke session
   */
  logout: protectedProcedure.mutation(async () => {
    // WorkOS sessions are stateless JWT tokens
    // No server-side revocation needed
    // Client will remove the token from storage
    return { success: true };
  }),

  /**
   * Refresh access token
   */
  refreshToken: publicProcedure
    .input(
      z.object({
        refreshToken: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const response = await workos.userManagement.authenticateWithRefreshToken({
        clientId: authConfig.clientId,
        refreshToken: input.refreshToken,
      });

      return {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      };
    }),

  /**
   * Sync user from WorkOS to our database
   * Called after WorkOS authentication to ensure user exists in our DB
   */
  syncUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.userId !== ctx.user.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Forbidden' });
      }

      // ⚡ Bolt: Optimized N+1 query pattern by replacing 'find-then-upsert' with a single atomic UPSERT.
      // This reduces database round-trips from 2 down to 1.
      // We use the PostgreSQL 'xmax' system column to determine if a row was inserted (0) or updated (non-zero).
      // This preserves the API contract for 'created' while maintaining O(1) performance.
      const [result] = await db
        .insert(users)
        .values({
          id: input.userId,
          email: input.email,
          firstName: input.firstName || null,
          lastName: input.lastName || null,
          plan: 'free',
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: input.email,
            firstName: input.firstName || null,
            lastName: input.lastName || null,
            updatedAt: new Date(),
          },
        })
        .returning({
          created: sql<boolean>`(xmax = 0)`,
        });

      return { success: true, created: result?.created ?? false };
    }),
});
