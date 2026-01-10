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

import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { workos, authConfig } from '../../services/workos.js';
import { db } from '../../../../db/client.js';
import { users } from '../../../../db/schema/index.js';
import { eq } from 'drizzle-orm';

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
      })
    )
    .mutation(async ({ input }) => {
      // Authenticate with WorkOS using the authorization code
      const { user, accessToken, refreshToken } =
        await workos.userManagement.authenticateWithCode({
          code: input.code,
          clientId: authConfig.clientId,
        });

      // Create or update user in database
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, user.id),
      });

      if (!existingUser) {
        // Create new user with free plan by default
        await db.insert(users).values({
          id: user.id,
          email: user.email,
          plan: 'free',
          firstName: user.firstName || null,
          lastName: user.lastName || null,
        });
      }

      // Get user plan from database
      const userData = await db.query.users.findFirst({
        where: eq(users.id, user.id),
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          plan: userData?.plan || 'free',
        },
        accessToken,
        refreshToken,
      };
    }),

  /**
   * Get current authenticated user
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // User is already verified in context
    // Fetch additional user data from database
    const userData = await db.query.users.findFirst({
      where: eq(users.id, ctx.user.userId),
    });

    return {
      id: ctx.user.userId,
      email: ctx.user.email,
      plan: userData?.plan || 'free',
      firstName: userData?.firstName,
      lastName: userData?.lastName,
    };
  }),

  /**
   * Logout - revoke session
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
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
      })
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
  syncUser: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if user already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });

      if (existingUser) {
        // User exists, update their info
        await db
          .update(users)
          .set({
            email: input.email,
            firstName: input.firstName || null,
            lastName: input.lastName || null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, input.userId));

        return { success: true, created: false };
      }

      // Create new user
      await db.insert(users).values({
        id: input.userId,
        email: input.email,
        firstName: input.firstName || null,
        lastName: input.lastName || null,
        plan: 'free',
      });

      return { success: true, created: true };
    }),
});
