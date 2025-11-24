/**
 * Waitlist API Routes
 *
 * Handles waitlist signups from the landing page.
 * POST /v1/waitlist - Add email to waitlist and send confirmation
 */

import { Router } from 'express';
import { db } from '../../../../db/client.js';
import { waitlist } from '../../../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { sendWaitlistConfirmation } from '../../services/email-service.js';

export default function waitlistRouter() {
  const router = Router();

  /**
   * Add email to waitlist
   * POST /v1/waitlist
   */
  router.post('/', async (req, res) => {
    try {
      const { email, name, source = 'launch_page' } = req.body;

      // Validate email
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }

      // Check if email already exists
      const existingEntry = await db.query.waitlist.findFirst({
        where: eq(waitlist.email, email.toLowerCase()),
      });

      if (existingEntry) {
        // Return success even if already exists (security best practice)
        // But don't send duplicate email
        res.status(200).json({
          success: true,
          message: 'Successfully joined the waitlist',
          alreadyExists: true,
        });
        return;
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
        console.error('Failed to send confirmation email:', emailError);
        // Don't fail the request if email fails - user is still on the list
        // Log it for manual follow-up
      }

      console.log(`✅ New waitlist signup: ${email} (${source})`);

      res.status(201).json({
        success: true,
        message: 'Successfully joined the waitlist',
        id: newEntry.id,
      });
    } catch (error) {
      console.error('Waitlist signup error:', error);
      res.status(500).json({ error: 'Failed to process waitlist signup' });
    }
  });

  /**
   * Get waitlist stats (admin endpoint - could add auth later)
   * GET /v1/waitlist/stats
   */
  router.get('/stats', async (_req, res) => {
    try {
      const total = await db.query.waitlist.findMany();
      const byStatus = total.reduce(
        (acc, entry) => {
          acc[entry.status] = (acc[entry.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      res.json({
        total: total.length,
        byStatus,
      });
    } catch (error) {
      console.error('Error fetching waitlist stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  return router;
}
