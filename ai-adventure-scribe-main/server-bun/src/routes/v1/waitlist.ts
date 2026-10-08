/**
 * Waitlist Routes for Elysia
 *
 * Handles waitlist signups from the landing page:
 * - POST /v1/waitlist - Add email to waitlist and send confirmation
 * - GET /v1/waitlist/stats - Get waitlist statistics
 *
 * Ported from /server/src/routes/v1/waitlist.ts
 */

import { eq, count } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { db } from '../../../../db/client';
import { waitlist } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../middleware/admin.js';
import { requireAuth } from '../../middleware/auth.js';
import { createSimpleRateLimit } from '../../middleware/rate-limit.js';
import { sendWaitlistConfirmation } from '../../services/email-service.js';

export const waitlistRoutes = new Elysia({ prefix: '/v1/waitlist' })

  /**
   * POST /v1/waitlist
   * Add email to waitlist
   *
   * Unauthenticated endpoint that inserts a DB row and sends a confirmation
   * email per request, so it must be rate limited to prevent email-bomb /
   * DB-flood abuse from a single IP.
   */
  .use(createSimpleRateLimit({ windowMs: 60_000, max: 5, key: 'waitlist:post' }))
  .post('/', async ({ body, set }) => {
    try {
      const {
        email,
        name,
        source = 'launch_page',
      } = body as {
        email?: string;
        name?: string;
        source?: string;
      };

      // Validate email
      if (!email || typeof email !== 'string') {
        set.status = 400;
        return { error: 'Email is required' };
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        set.status = 400;
        return { error: 'Invalid email format' };
      }

      // Check if email already exists
      const existingEntry = await db.query.waitlist.findFirst({
        where: eq(waitlist.email, email.toLowerCase()),
      });

      if (existingEntry) {
        // Return success even if already exists (security best practice)
        // But don't send duplicate email
        return {
          success: true,
          message: 'Successfully joined the waitlist',
          alreadyExists: true,
        };
      }

      // Insert into waitlist
      const result = await db
        .insert(waitlist)
        .values({
          email: email.toLowerCase(),
          name: name || null,
          source,
          status: 'pending',
        })
        .returning();

      const newEntry = result[0];

      if (!newEntry) {
        throw new Error('Failed to create waitlist entry');
      }

      // Send confirmation email
      try {
        await sendWaitlistConfirmation({
          email: email.toLowerCase(),
          name: name || undefined,
        });
      } catch (emailError) {
        logger.error({ msg: 'Failed to send confirmation email', error: emailError });
        // Don't fail the request if email fails - user is still on the list
      }

      logger.info({ msg: `New waitlist signup: ${email} (${source})` });

      set.status = 201;
      return {
        success: true,
        message: 'Successfully joined the waitlist',
        id: newEntry.id,
      };
    } catch (error) {
      logger.error({ msg: 'Waitlist signup error', error });
      set.status = 500;
      return { error: 'Failed to process waitlist signup' };
    }
  })

  /**
   * GET /v1/waitlist/stats
   * Get waitlist stats (auth-protected, admin only)
   */
  .use(requireAuth)
  .use(requireAdmin)
  .use(createSimpleRateLimit({ windowMs: 60_000, max: 10, key: 'waitlist:stats' }))
  .get('/stats', async ({ set }) => {
    try {
      // Use aggregate query instead of loading all rows into memory
      const rows = await db
        .select({
          status: waitlist.status,
          count: count(),
        })
        .from(waitlist)
        .groupBy(waitlist.status);

      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const row of rows) {
        byStatus[row.status] = row.count;
        total += row.count;
      }

      return { total, byStatus };
    } catch (error) {
      logger.error({ msg: 'Error fetching waitlist stats', error });
      set.status = 500;
      return { error: 'Failed to fetch stats' };
    }
  });
