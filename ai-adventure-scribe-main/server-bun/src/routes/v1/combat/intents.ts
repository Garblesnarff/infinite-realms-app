import { Elysia, t } from 'elysia';

import { verifyEncounterOwnership, verifySessionOwnership } from './helpers.js';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { CombatEncounterService } from '../../../services/combat/combat-encounter-service.js';
import { executeCombatIntent, getLegalCombatActions } from '../../../services/combat/combat-intent-service.js';
import { loadActiveTacticalMap } from '../../../services/combat/tactical-map-store.js';

const encounterIdParams = t.Object({
  encounterId: t.String({ minLength: 1, maxLength: 255 }),
});

const sessionIdParams = t.Object({
  sessionId: t.String({ minLength: 1, maxLength: 255 }),
});

const combatIntentSchema = t.Union([
  t.Object({
    type: t.Literal('move'),
    actorId: t.String({ minLength: 1, maxLength: 255 }),
    x: t.Number(),
    y: t.Number(),
  }),
  t.Object({
    type: t.Literal('attack'),
    actorId: t.String({ minLength: 1, maxLength: 255 }),
    targetId: t.String({ minLength: 1, maxLength: 255 }),
    weaponId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
    expectedVersion: t.Number({ minimum: 0 }),
    advantage: t.Optional(t.Boolean()),
    disadvantage: t.Optional(t.Boolean()),
  }),
  t.Object({
    type: t.Literal('spell'),
    actorId: t.String({ minLength: 1, maxLength: 255 }),
    targetIds: t.Array(t.String({ minLength: 1, maxLength: 255 }), { minItems: 1, maxItems: 100 }),
    spellId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
    spellName: t.String({ minLength: 1, maxLength: 255 }),
    slotLevel: t.Optional(t.Number({ minimum: 1, maximum: 9 })),
    expectedVersion: t.Number({ minimum: 0 }),
  }),
  t.Object({
    type: t.Union([t.Literal('dash'), t.Literal('dodge'), t.Literal('disengage')]),
    actorId: t.String({ minLength: 1, maxLength: 255 }),
    expectedVersion: t.Number({ minimum: 0 }),
  }),
  t.Object({
    type: t.Literal('end_turn'),
    actorId: t.String({ minLength: 1, maxLength: 255 }),
  }),
]);

const combatIntentRequestSchema = t.Object({
  // Keep the existing route-level error response for a missing intent.
  intent: t.Optional(combatIntentSchema),
  source: t.Optional(t.Union([t.Literal('player'), t.Literal('dm')])),
  dmStartedAt: t.Optional(t.Number({ minimum: 0 })),
});

// Elysia's status union is intentionally framework-owned and wider than a simple number.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIntentError(set: any, error: unknown) {
  if (error instanceof AppError) {
    set.status = error.statusCode;
    return { error: error.statusCode >= 500 ? 'Combat action failed' : error.message };
  }
  set.status = 500;
  return { error: 'Combat action failed' };
}

export const intentRoutes = new Elysia()
  .get('/:encounterId/legal-actions', async ({ request, params, set }) => {
    const { user, error } = await authenticateRequest(request);
    if (error || !user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await verifyEncounterOwnership(params.encounterId, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    try { return await getLegalCombatActions(params.encounterId, user.userId); }
    catch (cause) { return mapIntentError(set, cause); }
  }, { params: encounterIdParams })
  .post('/:encounterId/intent', async ({ request, params, body, set }) => {
    const { user, error } = await authenticateRequest(request);
    if (error || !user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await verifyEncounterOwnership(params.encounterId, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const payload = body;
    if (!payload.intent?.type || !payload.intent.actorId) {
      set.status = 400;
      return { error: 'A typed combat intent with actorId is required' };
    }
    try {
      const result = await executeCombatIntent(
        params.encounterId, payload.intent, user.userId,
        payload.source === 'dm' ? 'dm' : 'player', payload.dmStartedAt,
      );
      return { accepted: true, result };
    } catch (cause) {
      return mapIntentError(set, cause);
    }
  }, { params: encounterIdParams, body: combatIntentRequestSchema })
  .get('/sessions/:sessionId/active', async ({ request, params, set }) => {
    const { user, error } = await authenticateRequest(request);
    if (error || !user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await verifySessionOwnership(params.sessionId, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const encounter = await CombatEncounterService.getActiveEncounter(params.sessionId, user.userId);
    if (!encounter) { set.status = 404; return { error: 'No active combat encounter' }; }
    return {
      combat: await CombatEncounterService.getCombatState(encounter.id, user.userId),
      tacticalMap: await loadActiveTacticalMap(params.sessionId),
    };
  }, { params: sessionIdParams });
