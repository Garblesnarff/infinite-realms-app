import { Elysia } from 'elysia';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { CombatInitiativeService } from '../../../services/combat-initiative-service.js';
import { verifyEncounterOwnership, verifySessionOwnership } from './helpers.js';
import type { CreateParticipantInput } from '../../../types/combat.js';

function mapCombatError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found'
) {
  if (error instanceof AppError) {
    if (error.statusCode === 404) {
      set.status = 404;
      return { error: notFoundMessage };
    }

    set.status = error.statusCode;
    if (error.statusCode >= 500) {
      return { error: fallbackMessage };
    }
    return { error: error.message };
  }

  set.status = 500;
  return { error: fallbackMessage };
}

export const initiativeRoutes = new Elysia()
  /**
   * POST /v1/combat/sessions/:sessionId/start
   * Start a new combat encounter
   */
  .post('/sessions/:sessionId/start', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const verification = await verifySessionOwnership(params.sessionId, user.userId);
      if (!verification.success) {
        set.status = verification.error!.status;
        return { error: verification.error!.message };
      }

      const { participants, surpriseRound } = body as {
        participants: CreateParticipantInput[];
        surpriseRound?: boolean;
      };

      if (!participants || !Array.isArray(participants) || participants.length === 0) {
        set.status = 400;
        return { error: 'Participants array is required and must not be empty' };
      }

      const combatState = await CombatInitiativeService.startCombat(
        params.sessionId,
        participants,
        surpriseRound || false
      );

      set.status = 201;
      return combatState;
    } catch (e) {
      logger.error({ msg: 'Start combat error', error: e });
      return mapCombatError(set, e, 'Failed to start combat encounter', 'Session not found');
    }
  })

  /**
   * POST /v1/combat/:encounterId/roll-initiative
   * Roll initiative for a participant
   */
  .post('/:encounterId/roll-initiative', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
      if (!verification.success) {
        set.status = verification.error!.status;
        return { error: verification.error!.message };
      }

      const { participantId, roll, modifier } = body as {
        participantId: string;
        roll?: number;
        modifier?: number;
      };

      if (!participantId) {
        set.status = 400;
        return { error: 'participantId is required' };
      }

      if (roll !== undefined && (roll < 1 || roll > 20)) {
        set.status = 400;
        return { error: 'roll must be between 1 and 20' };
      }

      const result = await CombatInitiativeService.rollInitiative(
        params.encounterId,
        participantId,
        roll,
        modifier
      );

      return result;
    } catch (e) {
      logger.error({ msg: 'Roll initiative error', error: e });
      return mapCombatError(set, e, 'Failed to roll initiative', 'Combat participant not found');
    }
  })

  /**
   * POST /v1/combat/:encounterId/next-turn
   * Advance to the next turn
   */
  .post('/:encounterId/next-turn', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
      if (!verification.success) {
        set.status = verification.error!.status;
        return { error: verification.error!.message };
      }

      const result = await CombatInitiativeService.advanceTurn(params.encounterId);
      return result;
    } catch (e) {
      logger.error({ msg: 'Advance turn error', error: e });
      return mapCombatError(set, e, 'Failed to advance turn', 'Encounter not found');
    }
  })

  /**
   * PATCH /v1/combat/:encounterId/reorder
   * Manually adjust initiative order
   */
  .patch('/:encounterId/reorder', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
      if (!verification.success) {
        set.status = verification.error!.status;
        return { error: verification.error!.message };
      }

      const { participantId, newInitiative } = body as {
        participantId: string;
        newInitiative: number;
      };

      if (!participantId || newInitiative === undefined) {
        set.status = 400;
        return { error: 'participantId and newInitiative are required' };
      }

      await CombatInitiativeService.reorderInitiative(params.encounterId, participantId, newInitiative);
      const combatState = await CombatInitiativeService.getCombatState(params.encounterId);

      return combatState;
    } catch (e) {
      logger.error({ msg: 'Reorder initiative error', error: e });
      return mapCombatError(set, e, 'Failed to reorder initiative', 'Combat participant not found');
    }
  })

  /**
   * POST /v1/combat/:encounterId/end
   * End a combat encounter
   */
  .post('/:encounterId/end', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
      if (!verification.success) {
        set.status = verification.error!.status;
        return { error: verification.error!.message };
      }

      const updatedEncounter = await CombatInitiativeService.endCombat(params.encounterId);
      return updatedEncounter;
    } catch (e) {
      logger.error({ msg: 'End combat error', error: e });
      return mapCombatError(set, e, 'Failed to end combat encounter', 'Encounter not found');
    }
  })

  /**
   * GET /v1/combat/:encounterId/status
   * Get current combat state
   */
  .get('/:encounterId/status', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const verification = await verifyEncounterOwnership(params.encounterId, user.userId);
      if (!verification.success) {
        set.status = verification.error!.status;
        return { error: verification.error!.message };
      }

      const combatState = await CombatInitiativeService.getCombatState(params.encounterId);
      return combatState;
    } catch (e) {
      logger.error({ msg: 'Get combat status error', error: e });
      return mapCombatError(set, e, 'Failed to get combat status', 'Encounter not found');
    }
  });
