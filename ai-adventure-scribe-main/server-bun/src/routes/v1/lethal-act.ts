import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { db } from '../../../../db/client';
import { characterStats, combatEncounters } from '../../../../db/schema/index';
import { isClearlyLethalAction } from '../../../../shared/lethal-action-detector.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { rollDie } from '../../lib/rng.js';
import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { CharacterVitalsService } from '../../services/character-vitals-service.js';
import {
  defaultLethalActProposal,
  resolveLethalAct,
  type LethalActProposal,
} from '../../services/session/lethal-act-resolution.js';
import { SessionService } from '../../services/session-service.js';

type AuthedUser = { userId: string };

export type ProposeLethalAct = (text: string) => LethalActProposal | Promise<LethalActProposal>;

/** Injectable so tests can stub the DM. Production uses the 2014 default. */
let proposeLethalAct: ProposeLethalAct = defaultLethalActProposal;

export function setProposeLethalAct(next: ProposeLethalAct): void {
  proposeLethalAct = next;
}

export function resetProposeLethalAct(): void {
  proposeLethalAct = defaultLethalActProposal;
}

export const lethalActRoutes = new Elysia()
  .use(requireAuth)
  .use(planRateLimit('default'))
  .post(
    '/:id/lethal-act',
    async ({ params, body, set, user }) => {
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
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

      if (!isClearlyLethalAction(text)) {
        set.status = 400;
        return { error: 'Not a clearly lethal act' };
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

      const current = await CharacterVitalsService.getVitals(characterId, userId);
      if (current.currentHitPoints <= 0 || current.vitalState === 'dead') {
        set.status = 409;
        return {
          error: current.vitalState === 'dead' ? 'Already dead' : 'Already at 0 HP',
        };
      }

      const proposal = await proposeLethalAct(text);
      const [stats] = await db
        .select()
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId))
        .limit(1);
      const rawScore = stats ? stats[proposal.ability] : undefined;
      const abilityScore =
        typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : 10;

      const natural = rollDie(20);
      const resolved = resolveLethalAct({
        proposal,
        abilityScore,
        vitals: current,
        natural,
      });

      const written =
        resolved.damage > 0
          ? await CharacterVitalsService.applyDamage(characterId, userId, resolved.damage)
          : current;

      logger.info({
        msg: 'LETHAL_ACT_RESOLVED',
        sessionId,
        characterId,
        success: resolved.success,
        total: resolved.total,
        dc: resolved.dc,
        vitalState: written.vitalState,
      });

      return {
        success: resolved.success,
        natural: resolved.natural,
        modifier: resolved.modifier,
        total: resolved.total,
        dc: resolved.dc,
        damage: resolved.damage,
        vitalState: written.vitalState,
        currentHitPoints: written.currentHitPoints,
        maxHitPoints: written.maxHitPoints,
        engineCard: resolved.engineCard,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ text: t.String() }),
    },
  );
