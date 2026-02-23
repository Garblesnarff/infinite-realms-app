/* eslint-disable max-lines */
/**
 * Chronicles Router
 *
 * tRPC procedures for Session Chronicle operations including:
 * - Fetching chronicles by session ID
 * - Generating chronicles (Pro/Free tier)
 * - Polling chronicle generation status
 * - "Previously On" summaries for session continuity
 * - Public share token access (no auth required)
 */

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../../../db/client';
import {
  sessionChronicles,
  gameSessions,
  campaigns,
  characters,
} from '../../../../db/schema/index';
import { chronicleGenerator } from '../../services/chronicle-generator.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

import type { Context } from '../context.js';

// ─── Ownership helper ────────────────────────────────────────────────────────

/**
 * Verify that the requesting user owns the given session.
 * Ownership is determined by the campaign's userId or the character's userId.
 * Throws NOT_FOUND (masked) if the session doesn't exist or isn't owned by the user.
 */
export async function verifySessionOwnership(
  ctx: Context & { user: NonNullable<Context['user']> },
  sessionId: string,
): Promise<{
  sessionId: string;
  campaignId: string | null;
  sessionNumber: number | null;
  campaignUserId: string | null;
  characterUserId: string | null;
  characterOwnerId: string | null;
}> {
  const rows = await ctx.db
    .select({
      sessionId: gameSessions.id,
      campaignId: gameSessions.campaignId,
      sessionNumber: gameSessions.sessionNumber,
      campaignUserId: campaigns.userId,
      characterUserId: characters.userId,
      characterOwnerId: characters.ownerId,
    })
    .from(gameSessions)
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(eq(gameSessions.id, sessionId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  const userId = ctx.user.userId;
  const ownsViaCampaign = row.campaignUserId === userId;
  const ownsViaCharacter = row.characterUserId === userId || row.characterOwnerId === userId;

  if (!ownsViaCampaign && !ownsViaCharacter) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  return row;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const chroniclesRouter = router({
  /**
   * getBySessionId
   * Fetch the chronicle for a specific session (owned by the calling user).
   */
  getBySessionId: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await verifySessionOwnership(ctx, input.sessionId);

      const rows = await ctx.db
        .select()
        .from(sessionChronicles)
        .where(eq(sessionChronicles.sessionId, input.sessionId))
        .limit(1);

      return rows[0] ?? null;
    }),

  /**
   * generate
   * Trigger chronicle generation for a session.
   * Returns immediately; generation happens in the background.
   */
  generate: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionId } = input;

      await verifySessionOwnership(ctx, sessionId);

      // Check for an existing chronicle
      const existing = await ctx.db
        .select({
          id: sessionChronicles.id,
          status: sessionChronicles.status,
        })
        .from(sessionChronicles)
        .where(eq(sessionChronicles.sessionId, sessionId))
        .limit(1);

      const existingRow = existing[0];

      if (existingRow?.status === 'ready') {
        return { chronicleId: existingRow.id, alreadyExists: true };
      }

      if (existingRow?.status === 'generating') {
        return { chronicleId: existingRow.id, generating: true };
      }

      // Upsert: insert new row or update a failed/pending one to 'generating'
      let chronicleId: string;

      if (existingRow) {
        // Update failed/pending row back to generating
        await ctx.db
          .update(sessionChronicles)
          .set({ status: 'generating', errorMessage: null, updatedAt: new Date() })
          .where(eq(sessionChronicles.id, existingRow.id));
        chronicleId = existingRow.id;
      } else {
        const [inserted] = await ctx.db
          .insert(sessionChronicles)
          .values({
            sessionId,
            userId: ctx.user.userId,
            status: 'generating',
          })
          .returning({ id: sessionChronicles.id });
        chronicleId = inserted.id;
      }

      // Capture values needed in the background IIFE before ctx may GC
      const userPlan = ctx.user.plan;
      const capturedChronicleId = chronicleId;
      const capturedSessionId = sessionId;

      // Fire-and-forget background generation
      (async () => {
        try {
          if (userPlan === 'pro' || userPlan === 'enterprise') {
            const content = await chronicleGenerator.generateProChronicle(capturedSessionId);
            const illustrationUrl = await chronicleGenerator.generateIllustration(
              content.illustrationPrompt,
            );
            const shareToken = chronicleGenerator.generateShareToken();

            await db
              .update(sessionChronicles)
              .set({
                status: 'ready',
                chronicleText: content.chronicleText,
                chapterTitle: content.chapterTitle,
                previouslyOn: content.previouslyOn,
                illustrationUrl,
                shareToken,
                generatedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(sessionChronicles.id, capturedChronicleId));
          } else {
            // Free tier: plain summary, no illustration, no shareToken
            const content = await chronicleGenerator.generateFreeChronicle(capturedSessionId);

            await db
              .update(sessionChronicles)
              .set({
                status: 'ready',
                chronicleText: content.summaryText,
                previouslyOn: content.previouslyOn,
                generatedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(sessionChronicles.id, capturedChronicleId));
          }
        } catch (err) {
          await db
            .update(sessionChronicles)
            .set({
              status: 'failed',
              errorMessage: err instanceof Error ? err.message : String(err),
              updatedAt: new Date(),
            })
            .where(eq(sessionChronicles.id, capturedChronicleId));
        }
      })();

      return { chronicleId, generating: true };
    }),

  /**
   * getStatus
   * Poll a specific chronicle by ID (must belong to the calling user).
   */
  getStatus: protectedProcedure
    .input(z.object({ chronicleId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select()
        .from(sessionChronicles)
        .where(
          and(
            eq(sessionChronicles.id, input.chronicleId),
            eq(sessionChronicles.userId, ctx.user.userId),
          ),
        )
        .limit(1);

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      return rows[0];
    }),

  /**
   * getPreviouslyOn
   * Fetch the "Previously On" text from the chronicle of the session prior to
   * the given new session within the same campaign.
   */
  getPreviouslyOn: protectedProcedure
    .input(
      z.object({
        newSessionId: z.string().uuid(),
        campaignId: z.string().uuid(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { newSessionId, campaignId } = input;

      // 🛡️ Sentinel: Verify ownership of the session while fetching its data.
      // This incorporates dual-ownership (userId/ownerId) checks and masks existence.
      const session = await verifySessionOwnership(ctx, newSessionId);

      // Verify that the session belongs to the provided campaignId
      if (session.campaignId !== campaignId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      if (!session.sessionNumber || session.sessionNumber <= 1) {
        return null;
      }

      const previousSessionNumber = session.sessionNumber - 1;

      // Find the prior session in the same campaign, with ownership verification for defense-in-depth
      const priorSessionRows = await ctx.db
        .select({ id: gameSessions.id })
        .from(gameSessions)
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .leftJoin(characters, eq(gameSessions.characterId, characters.id))
        .where(
          and(
            eq(gameSessions.campaignId, campaignId),
            eq(gameSessions.sessionNumber, previousSessionNumber),
            or(
              eq(campaigns.userId, ctx.user.userId),
              eq(characters.userId, ctx.user.userId),
              eq(characters.ownerId, ctx.user.userId),
            ),
          ),
        )
        .limit(1);

      const priorSession = priorSessionRows[0];
      if (!priorSession) {
        return null;
      }

      // Find the ready chronicle for the prior session, with explicit user filtering
      const chronicleRows = await ctx.db
        .select({ previouslyOn: sessionChronicles.previouslyOn })
        .from(sessionChronicles)
        .where(
          and(
            eq(sessionChronicles.sessionId, priorSession.id),
            eq(sessionChronicles.status, 'ready'),
            eq(sessionChronicles.userId, ctx.user.userId),
          ),
        )
        .limit(1);

      const chronicle = chronicleRows[0];
      if (!chronicle) {
        return null;
      }

      return { previouslyOn: chronicle.previouslyOn };
    }),

  /**
   * getByShareToken
   * Public access — no auth required.
   * Returns safe public data for a shared chronicle.
   */
  getByShareToken: publicProcedure
    .input(z.object({ token: z.string().min(32).max(32) }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          chapterTitle: sessionChronicles.chapterTitle,
          chronicleText: sessionChronicles.chronicleText,
          illustrationUrl: sessionChronicles.illustrationUrl,
          generatedAt: sessionChronicles.generatedAt,
          sessionId: sessionChronicles.sessionId,
          previouslyOn: sessionChronicles.previouslyOn,
        })
        .from(sessionChronicles)
        .where(
          and(eq(sessionChronicles.shareToken, input.token), eq(sessionChronicles.status, 'ready')),
        )
        .limit(1);

      const chronicle = rows[0];

      if (!chronicle || !chronicle.chapterTitle) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      // Join to get session number and campaign name
      const sessionRows = await ctx.db
        .select({
          sessionNumber: gameSessions.sessionNumber,
          campaignName: campaigns.name,
        })
        .from(gameSessions)
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .where(eq(gameSessions.id, chronicle.sessionId))
        .limit(1);

      const sessionInfo = sessionRows[0];

      return {
        chapterTitle: chronicle.chapterTitle,
        chronicleText: chronicle.chronicleText,
        illustrationUrl: chronicle.illustrationUrl,
        generatedAt: chronicle.generatedAt,
        previouslyOn: chronicle.previouslyOn,
        sessionNumber: sessionInfo?.sessionNumber ?? null,
        campaignName: sessionInfo?.campaignName ?? null,
      };
    }),
});

export type ChroniclesRouter = typeof chroniclesRouter;
