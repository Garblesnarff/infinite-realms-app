import { Elysia } from 'elysia';

import { authenticateRequest } from '../../../lib/auth.js';
import { logger } from '../../../lib/logger.js';
import { CombatInitiativeService } from '../../../services/combat-initiative-service.js';
import { ConditionsService } from '../../../services/conditions-service.js';

import { verifyEncounterOwnership } from './helpers.js';

import type {
  ApplyConditionRequest,
  AttemptSaveRequest,
} from '../../../types/combat.js';

export const statusRoutes = new Elysia()
  /**
   * POST /v1/combat/:encounterId/conditions/apply
   * Apply a condition to a combat participant
   */
  .post('/:encounterId/conditions/apply', async ({ request, params, body, set }) => {
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

      const conditionRequest = body as ApplyConditionRequest;

      if (!conditionRequest.participantId || !conditionRequest.conditionName || !conditionRequest.durationType) {
        set.status = 400;
        return { error: 'participantId, conditionName, and durationType are required' };
      }

      const result = await ConditionsService.applyCondition(
        conditionRequest.participantId,
        params.encounterId,
        conditionRequest.conditionName,
        conditionRequest.durationType,
        conditionRequest.durationValue,
        conditionRequest.saveDc,
        conditionRequest.saveAbility,
        conditionRequest.source,
        verification.encounter.currentRound
      );

      set.status = 201;
      return {
        success: true,
        condition: result.condition,
        warnings: result.warnings,
      };
    } catch (e) {
      logger.error({ msg: 'Apply condition error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to apply condition';
      set.status = 500;
      return { error: message };
    }
  })

  /**
   * DELETE /v1/combat/:encounterId/conditions/:conditionId
   * Remove a condition from a participant
   */
  .delete('/:encounterId/conditions/:conditionId', async ({ request, params, set }) => {
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

      if (!params.conditionId) {
        set.status = 400;
        return { error: 'conditionId is required' };
      }

      const removed = await ConditionsService.removeCondition(params.conditionId, params.encounterId);

      if (!removed) {
        set.status = 404;
        return { error: 'Condition not found' };
      }

      return { success: true, message: 'Condition removed' };
    } catch (e) {
      logger.error({ msg: 'Remove condition error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to remove condition';
      set.status = 500;
      return { error: message };
    }
  })

  /**
   * POST /v1/combat/:encounterId/conditions/:conditionId/save
   * Attempt a saving throw against a condition
   */
  .post('/:encounterId/conditions/:conditionId/save', async ({ request, params, body, set }) => {
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

      if (!params.conditionId) {
        set.status = 400;
        return { error: 'conditionId is required' };
      }

      const { saveRoll } = body as AttemptSaveRequest;

      if (saveRoll === undefined || saveRoll < 1 || saveRoll > 20) {
        set.status = 400;
        return { error: 'saveRoll must be between 1 and 20' };
      }

      const result = await ConditionsService.attemptSave(params.conditionId, params.encounterId, saveRoll);

      return {
        success: true,
        saved: result.saved,
        conditionRemoved: result.conditionRemoved,
        message: result.message,
      };
    } catch (e) {
      logger.error({ msg: 'Attempt save error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to attempt save';
      set.status = 500;
      return { error: message };
    }
  })

  /**
   * GET /v1/combat/:encounterId/conditions/active
   * Get all active conditions in an encounter
   */
  .get('/:encounterId/conditions/active', async ({ request, params, set }) => {
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
      const encounterConditions = await ConditionsService.getEncounterConditions(
        params.encounterId
      );
      const participantConditions: Record<string, any> = {};

      for (const participant of combatState.participants) {
        const data = encounterConditions[participant.id] || {
          conditions: [],
          aggregatedEffects: { appliedConditions: [] },
        };

        participantConditions[participant.id] = {
          participantName: participant.name,
          conditions: data.conditions,
          aggregatedEffects: data.aggregatedEffects,
        };
      }

      return {
        encounterId: params.encounterId,
        currentRound: verification.encounter.currentRound,
        participantConditions,
      };
    } catch (e) {
      logger.error({ msg: 'Get active conditions error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to get active conditions';
      set.status = 500;
      return { error: message };
    }
  })

  /**
   * GET /v1/combat/conditions/library
   * Get all available conditions from the library
   */
  .get('/conditions/library', async ({ request, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const conditions = await ConditionsService.getConditionsLibrary();
      return { conditions };
    } catch (e) {
      logger.error({ msg: 'Get conditions library error', error: e });
      set.status = 500;
      return { error: 'Failed to get conditions library' };
    }
  })

  /**
   * GET /v1/combat/participants/:participantId/conditions
   * Get active conditions for a specific participant
   */
  .get('/participants/:participantId/conditions', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      // 🛡️ Sentinel: Use updated service methods that incorporate ownership checks
      // and prevent existence leakage by throwing NotFoundError instead of Access Denied.
      const conditions = await ConditionsService.getActiveConditions(
        params.participantId,
        user.userId
      );
      const effects = await ConditionsService.getMechanicalEffects(
        params.participantId,
        user.userId
      );

      return {
        participantId: params.participantId,
        conditions,
        aggregatedEffects: effects,
      };
    } catch (e: any) {
      logger.error({ msg: 'Get participant conditions error', error: e });

      // 🛡️ Sentinel: Properly map NotFoundError to 404 to avoid existence leakage
      if (e.name === 'NotFoundError' || e.statusCode === 404) {
        set.status = 404;
        return { error: e.message || 'Participant not found' };
      }

      const message = e instanceof Error ? e.message : 'Failed to get participant conditions';
      set.status = 500;
      return { error: message };
    }
  });
