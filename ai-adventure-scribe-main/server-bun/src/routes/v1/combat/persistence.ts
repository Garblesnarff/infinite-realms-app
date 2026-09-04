import { Elysia, t } from 'elysia';

import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { requireAuth } from '../../../middleware/auth.js';
import { planRateLimit } from '../../../middleware/rate-limit.js';
import {
  getCharacterCombatStatus,
  getCombatParticipantStatus,
  recordCombatDamageLog,
  updateCombatParticipantStatus,
} from '../../../services/combat/combat-persistence-service.js';

import type {
  CombatDamageLogInput,
  CombatParticipantStatusUpdate,
} from '../../../services/combat/combat-persistence-service.js';

const uuidString = t.String({ format: 'uuid' });

const encounterParam = t.Object({
  encounterId: uuidString,
});

// Must name the path position exactly as the sibling participant routes do.
// status.ts already registers "/participants/:participantId/conditions", and
// memoirist refuses a second route that calls the same position ":id". The
// refusal is a throw inside listen(), not a per-route error, so the entire
// server fails to boot -- which is what took the API down after #1764.
const participantParam = t.Object({
  participantId: uuidString,
});

// Same rule, different position: actions.ts already registers
// "/characters/:characterId/attacks".
const characterParam = t.Object({
  characterId: uuidString,
});

const statusUpdateBody = t.Object({
  currentHp: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
  tempHp: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
  isConscious: t.Optional(t.Boolean()),
  deathSavesSuccesses: t.Optional(t.Integer({ minimum: 0, maximum: 3 })),
  deathSavesFailures: t.Optional(t.Integer({ minimum: 0, maximum: 3 })),
});

const damageLogBody = t.Object({
  participantId: uuidString,
  damageAmount: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  damageType: t.String({ minLength: 1, maxLength: 100 }),
  sourceParticipantId: t.Optional(t.Nullable(uuidString)),
  sourceDescription: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  roundNumber: t.Integer({ minimum: 0, maximum: 100_000 }),
});

function mapError(
  set: { status?: number | string },
  error: unknown,
  fallback: string,
): { error: string } {
  if (error instanceof AppError) {
    set.status = error.statusCode;
    return { error: error.statusCode === 404 ? 'Not found' : error.message };
  }
  logger.error({ msg: 'COMBAT_PERSISTENCE error', error });
  set.status = 500;
  return { error: fallback };
}

export const persistenceRoutes = new Elysia()
  .use(requireAuth)
  .use(planRateLimit('default'))
  .post(
    '/encounters/:encounterId/persistence',
    ({ set }) => {
      set.status = 410;
      return { error: 'Combat persistence endpoint retired; combat state is server-authoritative' };
    },
    { params: encounterParam },
  )
  .post(
    '/encounters/:encounterId/damage-log',
    async ({ params, body, set, user }) => {
      try {
        const log = await recordCombatDamageLog(
          params.encounterId,
          body as CombatDamageLogInput,
          user.userId,
        );
        return { ok: true, ...log };
      } catch (error) {
        return mapError(set, error, 'Failed to log combat damage');
      }
    },
    { params: encounterParam, body: damageLogBody },
  )
  .get(
    '/participants/:participantId/status',
    async ({ params, set, user }) => {
      try {
        return await getCombatParticipantStatus(params.participantId, user.userId);
      } catch (error) {
        return mapError(set, error, 'Failed to load combat participant status');
      }
    },
    { params: participantParam },
  )
  .patch(
    '/participants/:participantId/status',
    async ({ params, body, set, user }) => {
      try {
        return await updateCombatParticipantStatus(
          params.participantId,
          body as CombatParticipantStatusUpdate,
          user.userId,
        );
      } catch (error) {
        return mapError(set, error, 'Failed to update combat participant status');
      }
    },
    { params: participantParam, body: statusUpdateBody },
  )
  .get(
    '/characters/:characterId/combat-status',
    async ({ params, set, user }) => {
      try {
        return await getCharacterCombatStatus(params.characterId, user.userId);
      } catch (error) {
        return mapError(set, error, 'Failed to load character combat status');
      }
    },
    { params: characterParam },
  );
