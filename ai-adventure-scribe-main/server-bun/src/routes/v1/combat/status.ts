/* eslint-disable max-lines, @typescript-eslint/no-explicit-any */
import { Elysia } from 'elysia';

import { db } from '../../../../../db/client';
import {
  gameSessions,
  campaigns,
  characters,
} from '../../../../../db/schema/index';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { ConditionsService } from '../../../services/conditions-service.js';


import type {
  ApplyConditionRequest,
  AttemptSaveRequest,
} from '../../../types/combat.js';

function mapCombatError(
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found'
): any {
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
        verification.encounter.currentRound,
        user.userId
      );

      set.status = 201;
      return {
        success: true,
        condition: result.condition,
        warnings: result.warnings,
      };
    } catch (e) {
      logger.error({ msg: 'Apply condition error', error: e });
      return mapCombatError(set, e, 'Failed to apply condition', 'Combat participant not found');
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

      const removed = await ConditionsService.removeCondition(params.conditionId, params.encounterId, user.userId);

      if (!removed) {
        set.status = 404;
        return { error: 'Condition not found' };
      }

      return { success: true, message: 'Condition removed' };
    } catch (e) {
      logger.error({ msg: 'Remove condition error', error: e });
      return mapCombatError(set, e, 'Failed to remove condition', 'Condition not found');
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

      const result = await ConditionsService.attemptSave(params.conditionId, params.encounterId, saveRoll, user.userId);

      return {
        success: true,
        saved: result.saved,
        conditionRemoved: result.conditionRemoved,
        message: result.message,
      };
    } catch (e) {
      logger.error({ msg: 'Attempt save error', error: e });
      return mapCombatError(set, e, 'Failed to attempt save', 'Condition not found');
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
      // ⚡ Bolt: Consolidate ownership verification, encounter state, and conditions retrieval into a single database round-trip.
      // This reduces database overhead and network latency from 5 queries down to 1 for this frequently-called status endpoint.
      const result = await (db.query as any).combatEncounters.findFirst({
        where: (ce: any, { eq, and, or, exists }: any) => and(
          eq(ce.id, params.encounterId),
          exists(
            db.select().from(gameSessions)
              .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
              .leftJoin(characters, eq(gameSessions.characterId, characters.id))
              .where(and(
                eq(gameSessions.id, ce.sessionId),
                or(
                  eq(campaigns.userId, user.userId),
                  eq(characters.userId, user.userId),
                  eq(characters.ownerId, user.userId)
                )
              ))
          )
        ),
        with: {
          participants: {
            where: (cp: any, { eq }: any) => eq(cp.isActive, true),
            orderBy: (cp: any, { asc }: any) => [asc(cp.turnOrder)],
            with: {
              conditions: {
                where: (cpc: any, { eq }: any) => eq(cpc.isActive, true),
                orderBy: (cpc: any, { desc }: any) => [desc(cpc.appliedAtRound)],
                with: {
                  condition: true
                }
              }
            }
          }
        }
      });

      if (!result) {
        set.status = 404;
        return { error: 'Encounter not found' };
      }

      const participantConditions: Record<string, any> = {};

      for (const participant of result.participants) {
        // Map conditions to the format expected by the frontend (ParticipantConditionWithDetails)
        const conditions = participant.conditions.map((cpc: any) => ({
          ...cpc,
          condition: {
            ...cpc.condition,
            mechanicalEffects: JSON.parse(cpc.condition.mechanicalEffects),
            createdAt: new Date(cpc.condition.createdAt),
          },
          createdAt: new Date(cpc.createdAt)
        }));

        // Calculate aggregated effects in-memory using the service logic
        const aggregatedEffects = ConditionsService.calculateAggregatedEffects(conditions);

        participantConditions[participant.id] = {
          participantName: participant.name,
          conditions,
          aggregatedEffects,
        };
      }

      return {
        encounterId: params.encounterId,
        currentRound: result.currentRound,
        participantConditions,
      };
    } catch (e) {
      logger.error({ msg: 'Get active conditions error', error: e });
      return mapCombatError(set, e, 'Failed to get active conditions', 'Encounter not found');
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
      return mapCombatError(set, e, 'Failed to get conditions library');
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

      // ⚡ Bolt: Use pre-fetched conditions to calculate aggregated effects in-memory.
      // This avoids a second redundant database round-trip for the same participant's conditions.
      const effects = ConditionsService.calculateAggregatedEffects(conditions);

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
        return { error: 'Participant not found' };
      }

      return mapCombatError(set, e, 'Failed to get participant conditions', 'Participant not found');
    }
  });
