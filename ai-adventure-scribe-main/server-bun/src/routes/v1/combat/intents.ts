import { Elysia } from 'elysia';

import { verifyEncounterOwnership, verifySessionOwnership } from './helpers.js';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { CombatEncounterService } from '../../../services/combat/combat-encounter-service.js';
import { executeCombatIntent, getLegalCombatActions } from '../../../services/combat/combat-intent-service.js';
import { loadActiveTacticalMap } from '../../../services/combat/tactical-map-store.js';

import type { CombatActionSource, CombatIntent } from '../../../services/combat/combat-intent-service.js';

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
  })
  .post('/:encounterId/intent', async ({ request, params, body, set }) => {
    const { user, error } = await authenticateRequest(request);
    if (error || !user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await verifyEncounterOwnership(params.encounterId, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const payload = body as { intent?: CombatIntent; source?: CombatActionSource; dmStartedAt?: number };
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
  })
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
  });
