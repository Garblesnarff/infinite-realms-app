import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { db } from '../../../../db/client';
import { combatEncounters } from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { rollDie } from '../../lib/rng.js';
import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { CharacterVitalsService } from '../../services/character-vitals-service.js';
import { SessionService } from '../../services/session-service.js';

import type { EngineResultCard } from '../../../../shared/engine-result-card.js';
import type { CharacterVitals } from '../../services/character-vitals-math.js';

type AuthedUser = { userId: string };

function deathSaveCards(
  lines: string[],
  tallies: { successes: number; failures: number },
): EngineResultCard[] {
  return lines.map((line, index) => ({
    kind: 'death_save',
    side: 'party',
    line,
    title: index === 0 ? 'Death saving throw' : 'Stable',
    deathSave: { successes: tallies.successes, failures: tallies.failures },
  }));
}

export const deathSaveRoutes = new Elysia()
  .use(requireAuth)
  .use(planRateLimit('default'))
  .post(
    '/:id/death-save',
    async ({ params, set, user }) => {
      const userId = (user as AuthedUser).userId;
      const sessionId = params.id;

      let session;
      try {
        session = await SessionService.getSessionById(sessionId, userId);
      } catch (error) {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: 'Not found' };
        }
        throw error;
      }

      const [open] = await db
        .select({ id: combatEncounters.id })
        .from(combatEncounters)
        .where(
          and(eq(combatEncounters.sessionId, sessionId), eq(combatEncounters.status, 'active')),
        )
        .limit(1);
      if (open) {
        set.status = 409;
        return { error: 'Already in a fight' };
      }

      const characterId = session.characterId;
      if (!characterId) {
        set.status = 400;
        return { error: 'Session has no character' };
      }

      let current: CharacterVitals;
      try {
        current = await CharacterVitalsService.getVitals(characterId, userId);
      } catch {
        set.status = 404;
        return { error: 'Not found' };
      }

      if (current.currentHitPoints > 0 || current.vitalState !== 'dying') {
        set.status = 409;
        return {
          error: current.vitalState === 'dead' ? 'Already dead' : 'Not dying',
        };
      }

      let written: Awaited<ReturnType<typeof CharacterVitalsService.applyDeathSave>>;
      try {
        written = await CharacterVitalsService.applyDeathSave(characterId, userId, { rollDie });
      } catch (error) {
        if (error instanceof TRPCError && error.code === 'CONFLICT') {
          set.status = 409;
          return { error: error.message || 'Compare-and-set failed' };
        }
        throw error;
      }

      const { resolution, ...vitals } = written;
      const lines = resolution.lines;
      const engineCards = deathSaveCards(lines, {
        successes: resolution.successes,
        failures: resolution.failures,
      });

      try {
        const { publishStoryCharacterUpdate } =
          await import('../../services/dm/story-broadcast.js');
        publishStoryCharacterUpdate(sessionId, 'story_death_save');
      } catch (broadcastError) {
        logger.warn({
          msg: 'DEATH_SAVE_BROADCAST_FAILED',
          sessionId,
          characterId,
          error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
        });
      }

      return {
        roll: resolution.natural,
        successes: resolution.successes,
        failures: resolution.failures,
        vitalState: vitals.vitalState,
        currentHitPoints: vitals.currentHitPoints,
        maxHitPoints: vitals.maxHitPoints,
        terminal: resolution.isDead,
        hours: resolution.hours,
        engineLines: lines,
        engineCards,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({}),
    },
  );
