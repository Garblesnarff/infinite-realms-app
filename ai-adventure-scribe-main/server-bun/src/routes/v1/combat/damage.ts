import { Elysia } from 'elysia';
import { authenticateRequest } from '../../../lib/auth.js';
import { logger } from '../../../lib/logger.js';
import { CombatHPService } from '../../../services/combat-hp-service.js';
import { verifyEncounterOwnership } from './helpers.js';

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

      const result = await CombatHPService.applyDamage(participantId, {
        damageAmount,
        damageType,
        sourceParticipantId,
        sourceDescription,
        ignoreResistances,
        ignoreImmunities,
      });

      return result;
    } catch (e) {
      logger.error({ msg: 'Apply damage error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to apply damage';
      set.status = 500;
      return { error: message };
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

      const result = await CombatHPService.healDamage(
        participantId,
        healingAmount,
        sourceDescription
      );

      return result;
    } catch (e) {
      logger.error({ msg: 'Heal damage error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to heal damage';
      set.status = 500;
      return { error: message };
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

      const result = await CombatHPService.setTempHP(participantId, tempHp);
      return result;
    } catch (e) {
      logger.error({ msg: 'Set temp HP error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to set temp HP';
      set.status = 500;
      return { error: message };
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

      const { participantId, roll } = body as any;

      if (!participantId) {
        set.status = 400;
        return { error: 'participantId is required' };
      }

      if (roll === undefined || roll < 1 || roll > 20) {
        set.status = 400;
        return { error: 'roll must be between 1 and 20' };
      }

      const result = await CombatHPService.rollDeathSave(participantId, roll);
      return result;
    } catch (e) {
      logger.error({ msg: 'Death save error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to roll death save';
      set.status = 500;
      return { error: message };
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

      const damageLog = await CombatHPService.getDamageLog(
        params.encounterId,
        participantId,
        roundNum
      );

      return damageLog;
    } catch (e) {
      logger.error({ msg: 'Get damage log error', error: e });
      set.status = 500;
      return { error: 'Failed to get damage log' };
    }
  });
