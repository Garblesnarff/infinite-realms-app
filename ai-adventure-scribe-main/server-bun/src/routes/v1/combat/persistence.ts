import { Elysia, t } from 'elysia';

import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { requireAuth } from '../../../middleware/auth.js';
import { planRateLimit } from '../../../middleware/rate-limit.js';
import {
  getCharacterCombatStatus,
  getCombatParticipantStatus,
  saveCombatPersistence,
  updateCombatParticipantStatus,
} from '../../../services/combat/combat-persistence-service.js';

import type {
  CombatParticipantStatusUpdate,
  CombatPersistenceInput,
} from '../../../services/combat/combat-persistence-service.js';

const uuidString = t.String({ format: 'uuid' });

const uuidParam = t.Object({
  id: uuidString,
});

const encounterParam = t.Object({
  encounterId: uuidString,
});

const persistenceParticipant = t.Object({
  id: uuidString,
  characterId: t.Optional(t.Nullable(uuidString)),
  npcId: t.Optional(t.Nullable(uuidString)),
  name: t.String({ minLength: 1, maxLength: 255 }),
  participantType: t.Union([
    t.Literal('player'),
    t.Literal('npc'),
    t.Literal('enemy'),
    t.Literal('monster'),
  ]),
  initiative: t.Integer({ minimum: -1000, maximum: 1000 }),
  initiativeModifier: t.Integer({ minimum: -1000, maximum: 1000 }),
  turnOrder: t.Integer({ minimum: 0, maximum: 1000 }),
  isActive: t.Boolean(),
  armorClass: t.Integer({ minimum: -1000, maximum: 1000 }),
  maxHp: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  speed: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  damageResistances: t.Array(t.String({ maxLength: 100 }), { maxItems: 100 }),
  damageImmunities: t.Array(t.String({ maxLength: 100 }), { maxItems: 100 }),
  damageVulnerabilities: t.Array(t.String({ maxLength: 100 }), { maxItems: 100 }),
});

const persistenceStatus = t.Object({
  participantId: uuidString,
  currentHp: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  maxHp: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  tempHp: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  isConscious: t.Boolean(),
  deathSavesSuccesses: t.Integer({ minimum: 0, maximum: 3 }),
  deathSavesFailures: t.Integer({ minimum: 0, maximum: 3 }),
});

const persistenceCondition = t.Object({
  participantId: uuidString,
  conditionName: t.String({ minLength: 1, maxLength: 100 }),
  durationRounds: t.Optional(t.Nullable(t.Integer({ minimum: 0, maximum: 100_000 }))),
  source: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
});

const persistenceBody = t.Object({
  sessionId: uuidString,
  status: t.Union([t.Literal('active'), t.Literal('paused'), t.Literal('completed')]),
  currentRound: t.Integer({ minimum: 0, maximum: 100_000 }),
  currentTurnOrder: t.Integer({ minimum: 0, maximum: 1000 }),
  location: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  startedAt: t.String({ format: 'date-time' }),
  participants: t.Array(persistenceParticipant, { maxItems: 100 }),
  statuses: t.Array(persistenceStatus, { maxItems: 100 }),
  conditions: t.Array(persistenceCondition, { maxItems: 500 }),
});

const statusUpdateBody = t.Object({
  currentHp: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
  tempHp: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
  isConscious: t.Optional(t.Boolean()),
  deathSavesSuccesses: t.Optional(t.Integer({ minimum: 0, maximum: 3 })),
  deathSavesFailures: t.Optional(t.Integer({ minimum: 0, maximum: 3 })),
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
    async ({ params, body, set, user }) => {
      try {
        const result = await saveCombatPersistence(
          params.encounterId,
          body as CombatPersistenceInput,
          user.userId,
        );
        return { ok: true, ...result };
      } catch (error) {
        return mapError(set, error, 'Failed to persist combat encounter');
      }
    },
    { params: encounterParam, body: persistenceBody },
  )
  .get(
    '/participants/:id/status',
    async ({ params, set, user }) => {
      try {
        return await getCombatParticipantStatus(params.id, user.userId);
      } catch (error) {
        return mapError(set, error, 'Failed to load combat participant status');
      }
    },
    { params: uuidParam },
  )
  .patch(
    '/participants/:id/status',
    async ({ params, body, set, user }) => {
      try {
        return await updateCombatParticipantStatus(
          params.id,
          body as CombatParticipantStatusUpdate,
          user.userId,
        );
      } catch (error) {
        return mapError(set, error, 'Failed to update combat participant status');
      }
    },
    { params: uuidParam, body: statusUpdateBody },
  )
  .get(
    '/characters/:id/combat-status',
    async ({ params, set, user }) => {
      try {
        return await getCharacterCombatStatus(params.id, user.userId);
      } catch (error) {
        return mapError(set, error, 'Failed to load character combat status');
      }
    },
    { params: uuidParam },
  );
