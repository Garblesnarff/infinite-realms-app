/**
 * Waitlist Routes for Elysia
 *
 * Handles waitlist signups from the landing page:
 * - POST /v1/waitlist - Add email to waitlist and send confirmation
 * - GET /v1/waitlist/stats - Get waitlist statistics
 *
 * Ported from /server/src/routes/v1/waitlist.ts
 */

import { Elysia, t } from 'elysia';
import { db } from '../../../../db/client.js';
import { waitlist } from '../../../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { sendWaitlistConfirmation } from '../../services/email-service.js';
import { logger } from '../../lib/logger.js';

export const waitlistRoutes = new Elysia({ prefix: '/v1/waitlist' })

  /**
   * POST /v1/waitlist
   * Add email to waitlist
   */
  .post('/', async ({ body, set }) => {
    try {
      const { email, name, source = 'launch_page' } = body as {
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
   * Get waitlist stats (could add auth later)
   */
  .get('/stats', async ({ set }) => {
    try {
      const total = await db.query.waitlist.findMany();
      const byStatus = total.reduce(
        (acc, entry) => {
          acc[entry.status] = (acc[entry.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      return {
        total: total.length,
        byStatus,
      };
    } catch (error) {
      logger.error({ msg: 'Error fetching waitlist stats', error });
      set.status = 500;
      return { error: 'Failed to fetch stats' };
    }
  });
