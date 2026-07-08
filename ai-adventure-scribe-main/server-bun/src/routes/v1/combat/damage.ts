import { Elysia } from 'elysia';

// @deprecated Temp HP, death-save, and damage-log extras have no frontend callers as of 2026-07-08.

import { verifyEncounterOwnership } from './helpers.js';
import { authenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { CombatHPService } from '../../../services/combat-hp-service.js';


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

export const damageRoutes = new Elysia()
  /**
   * POST /v1/combat/:encounterId/damage
   * Apply damage to a participant
   */
  .post('/:encounterId/damage', async ({ request, params, body, set }) => {
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

      const {
        participantId,
        damageAmount,
        damageType,
        sourceParticipantId,
        sourceDescription,
        ignoreResistances,
        ignoreImmunities,
      } = body as any;

      if (!participantId) {
        set.status = 400;
        return { error: 'participantId is required' };
      }

      if (damageAmount === undefined || damageAmount < 0) {
        set.status = 400;
        return { error: 'damageAmount must be non-negative' };
      }

      // 🛡️ Sentinel: Pass user.userId to applyDamage for defense-in-depth atomic ownership verification.
      const result = await CombatHPService.applyDamage(
        participantId,
        params.encounterId,
        {
          damageAmount,
          damageType,
          sourceParticipantId,
          sourceDescription,
          ignoreResistances,
          ignoreImmunities,
        },
        user.userId
      );

      return result;
    } catch (e) {
      logger.error({ msg: 'Apply damage error', error: e });
      return mapCombatError(set, e, 'Failed to apply damage', 'Combat participant not found');
    }
  })

  /**
   * POST /v1/combat/:encounterId/heal
   * Heal a participant
   */
  .post('/:encounterId/heal', async ({ request, params, body, set }) => {
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

      const { participantId, healingAmount, sourceDescription } = body as any;

      if (!participantId) {
        set.status = 400;
        return { error: 'participantId is required' };
      }

      if (healingAmount === undefined || healingAmount < 0) {
        set.status = 400;
        return { error: 'healingAmount must be non-negative' };
      }

      // 🛡️ Sentinel: Pass user.userId to healDamage for defense-in-depth atomic ownership verification.
      const result = await CombatHPService.healDamage(
        participantId,
        params.encounterId,
        healingAmount,
        sourceDescription,
        user.userId
      );

      return result;
    } catch (e) {
      logger.error({ msg: 'Heal damage error', error: e });
      return mapCombatError(set, e, 'Failed to heal damage', 'Combat participant not found');
    }
  })

  /**
   * POST /v1/combat/:encounterId/temp-hp
   * Set temporary HP for a participant
   */
  .post('/:encounterId/temp-hp', async ({ request, params, body, set }) => {
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

      const { participantId, tempHp } = body as any;

      if (!participantId) {
        set.status = 400;
        return { error: 'participantId is required' };
      }

      if (tempHp === undefined || tempHp < 0) {
        set.status = 400;
        return { error: 'tempHp must be non-negative' };
      }

      // 🛡️ Sentinel: Pass user.userId to setTempHP for defense-in-depth atomic ownership verification.
      const result = await CombatHPService.setTempHP(participantId, params.encounterId, tempHp, user.userId);
      return result;
    } catch (e) {
      logger.error({ msg: 'Set temp HP error', error: e });
      return mapCombatError(set, e, 'Failed to set temp HP', 'Combat participant not found');
    }
  })

  /**
   * POST /v1/combat/:encounterId/death-save
   * Roll a death save for an unconscious participant
   */
  .post('/:encounterId/death-save', async ({ request, params, body, set }) => {
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

      const { participantId } = body as any;

      if (!participantId) {
        set.status = 400;
        return { error: 'participantId is required' };
      }

      // 🛡️ Sentinel: Pass user.userId to rollDeathSave for defense-in-depth atomic ownership verification.
      const result = await CombatHPService.rollDeathSave(participantId, params.encounterId, user.userId);
      return result;
    } catch (e) {
      logger.error({ msg: 'Death save error', error: e });
      return mapCombatError(set, e, 'Failed to roll death save', 'Combat participant not found');
    }
  })

  /**
   * GET /v1/combat/:encounterId/damage-log
   * Get damage log for an encounter
   */
  .get('/:encounterId/damage-log', async ({ request, params, query, set }) => {
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

      const participantId = query.participantId as string | undefined;
      const roundStr = query.round as string | undefined;
      const roundNum = roundStr !== undefined ? parseInt(roundStr, 10) : undefined;

      // 🛡️ Sentinel: Pass user.userId to getDamageLog for defense-in-depth atomic ownership verification.
      const damageLog = await CombatHPService.getDamageLog(
        params.encounterId,
        participantId,
        roundNum,
        user.userId
      );

      return damageLog;
    } catch (e) {
      logger.error({ msg: 'Get damage log error', error: e });
      return mapCombatError(set, e, 'Failed to get damage log', 'Encounter not found');
    }
  });
