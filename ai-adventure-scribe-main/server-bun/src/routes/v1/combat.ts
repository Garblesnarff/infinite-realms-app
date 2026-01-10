/**
 * Combat Routes (Elysia/Bun)
 *
 * RESTful API endpoints for D&D 5E combat initiative and turn order management.
 * Ported from /server/src/routes/v1/combat.ts
 */

import { Elysia, t } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';

// Import services from Bun server
import { CombatInitiativeService } from '../../services/combat-initiative-service.js';
import { CombatHPService } from '../../services/combat-hp-service.js';
import { CombatAttackService } from '../../services/combat-attack-service.js';
import { ConditionsService } from '../../services/conditions-service.js';
import { supabaseService } from '../../lib/supabase.js';

// Import types from Express server (shared)
import type {
  CreateParticipantInput,
  AttackRollInput,
  SpellAttackInput,
  CreateWeaponAttackInput,
  ApplyConditionRequest,
  AttemptSaveRequest,
} from '../../types/combat.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface VerificationResult {
  success: boolean;
  encounter?: any;
  session?: any;
  error?: { status: number; message: string };
}

/**
 * Verify that the user owns the encounter's session
 */
async function verifyEncounterOwnership(
  encounterId: string | undefined,
  userId: string
): Promise<VerificationResult> {
  if (!encounterId) {
    return { success: false, error: { status: 400, message: 'encounterId is required' } };
  }

  const encounter = await CombatInitiativeService.getEncounterById(encounterId);
  if (!encounter) {
    return { success: false, error: { status: 404, message: 'Encounter not found' } };
  }

  const { data: session, error: sessionErr } = await supabaseService
    .from('game_sessions')
    .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id)')
    .eq('id', encounter.sessionId)
    .single();

  if (sessionErr || !session) {
    return { success: false, error: { status: 404, message: 'Session not found' } };
  }

  const campaignOwner = (session as any).campaigns?.user_id;
  const characterOwner = (session as any).characters?.user_id;

  if (campaignOwner !== userId && characterOwner !== userId) {
    return { success: false, error: { status: 403, message: 'Access denied' } };
  }

  return { success: true, encounter, session };
}

/**
 * Verify session ownership for starting combat
 */
async function verifySessionOwnership(
  sessionId: string | undefined,
  userId: string
): Promise<VerificationResult> {
  if (!sessionId) {
    return { success: false, error: { status: 400, message: 'sessionId is required' } };
  }

  const { data: session, error: sessionErr } = await supabaseService
    .from('game_sessions')
    .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id)')
    .eq('id', sessionId)
    .single();

  if (sessionErr || !session) {
    return { success: false, error: { status: 404, message: 'Session not found' } };
  }

  const campaignOwner = (session as any).campaigns?.user_id;
  const characterOwner = (session as any).characters?.user_id;

  if (campaignOwner !== userId && characterOwner !== userId) {
    return { success: false, error: { status: 403, message: 'Access denied' } };
  }

  return { success: true, session };
}

// ============================================================================
// COMBAT ROUTES
// ============================================================================

export const combatRoutes = new Elysia({ prefix: '/v1/combat' })

  // ==========================================
  // Initiative & Turn Management (6 endpoints)
  // ==========================================

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
      set.status = 500;
      return { error: 'Failed to start combat encounter' };
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
      set.status = 500;
      return { error: 'Failed to roll initiative' };
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
      const message = e instanceof Error ? e.message : 'Failed to advance turn';
      set.status = 500;
      return { error: message };
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
      set.status = 500;
      return { error: 'Failed to reorder initiative' };
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
      set.status = 500;
      return { error: 'Failed to end combat encounter' };
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
      set.status = 500;
      return { error: 'Failed to get combat status' };
    }
  })

  // ==========================================
  // Attack & Damage Resolution (4 endpoints)
  // ==========================================

  /**
   * POST /v1/combat/:encounterId/attack
   * Resolve a weapon/melee attack
   */
  .post('/:encounterId/attack', async ({ request, params, body, set }) => {
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

      const attackInput = body as AttackRollInput;

      if (!attackInput.attackerId || !attackInput.targetId || attackInput.attackRoll === undefined) {
        set.status = 400;
        return { error: 'attackerId, targetId, and attackRoll are required' };
      }

      if (attackInput.attackRoll < 1 || attackInput.attackRoll > 20) {
        set.status = 400;
        return { error: 'attackRoll must be between 1 and 20' };
      }

      const attackService = new CombatAttackService();
      const result = await attackService.resolveAttack(params.encounterId, attackInput);

      return result;
    } catch (e) {
      logger.error({ msg: 'Resolve attack error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to resolve attack';
      set.status = 500;
      return { error: message };
    }
  })

  /**
   * POST /v1/combat/:encounterId/spell-attack
   * Resolve a spell attack against targets
   */
  .post('/:encounterId/spell-attack', async ({ request, params, body, set }) => {
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

      const spellInput = body as SpellAttackInput;

      if (!spellInput.casterId || !spellInput.targetIds || !Array.isArray(spellInput.targetIds)) {
        set.status = 400;
        return { error: 'casterId and targetIds (array) are required' };
      }

      if (!spellInput.spellName) {
        set.status = 400;
        return { error: 'spellName is required' };
      }

      const attackService = new CombatAttackService();
      const result = await attackService.resolveSpellAttack(params.encounterId, spellInput);

      return result;
    } catch (e) {
      logger.error({ msg: 'Resolve spell attack error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to resolve spell attack';
      set.status = 500;
      return { error: message };
    }
  })

  /**
   * GET /v1/combat/characters/:characterId/attacks
   * Get all weapon attacks for a character
   */
  .get('/characters/:characterId/attacks', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { data: character, error: charErr } = await supabaseService
        .from('characters')
        .select('user_id')
        .eq('id', params.characterId)
        .single();

      if (charErr || !character) {
        set.status = 404;
        return { error: 'Character not found' };
      }

      if (character.user_id !== user.userId) {
        set.status = 403;
        return { error: 'Access denied' };
      }

      const attackService = new CombatAttackService();
      const attacks = await attackService.getCharacterWeapons(params.characterId);

      return { attacks };
    } catch (e) {
      logger.error({ msg: 'Get character attacks error', error: e });
      set.status = 500;
      return { error: 'Failed to get character attacks' };
    }
  })

  /**
   * POST /v1/combat/characters/:characterId/attacks
   * Create a new weapon attack for a character
   */
  .post('/characters/:characterId/attacks', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { data: character, error: charErr } = await supabaseService
        .from('characters')
        .select('user_id')
        .eq('id', params.characterId)
        .single();

      if (charErr || !character) {
        set.status = 404;
        return { error: 'Character not found' };
      }

      if (character.user_id !== user.userId) {
        set.status = 403;
        return { error: 'Access denied' };
      }

      const weaponInput = body as Omit<CreateWeaponAttackInput, 'characterId'>;

      if (!weaponInput.name || !weaponInput.damageDice || !weaponInput.damageType) {
        set.status = 400;
        return { error: 'name, damageDice, and damageType are required' };
      }

      if (weaponInput.attackBonus === undefined) {
        set.status = 400;
        return { error: 'attackBonus is required' };
      }

      const attackService = new CombatAttackService();
      const attack = await attackService.createWeaponAttack({
        characterId: params.characterId,
        ...weaponInput,
      });

      set.status = 201;
      return { attack };
    } catch (e) {
      logger.error({ msg: 'Create weapon attack error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to create weapon attack';
      set.status = 500;
      return { error: message };
    }
  })

  // ==========================================
  // HP & Damage Tracking (5 endpoints)
  // ==========================================

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
  })

  // ==========================================
  // Conditions System (8 endpoints)
  // ==========================================

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

      const removed = await ConditionsService.removeCondition(params.conditionId);

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

      const result = await ConditionsService.attemptSave(params.conditionId, saveRoll);

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
      const participantConditions: Record<string, any> = {};

      for (const participant of combatState.participants) {
        const conditions = await ConditionsService.getActiveConditions(participant.id);
        const effects = await ConditionsService.getMechanicalEffects(participant.id);

        participantConditions[participant.id] = {
          participantName: participant.name,
          conditions,
          aggregatedEffects: effects,
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
      const { data: participant } = await supabaseService
        .from('combat_participants')
        .select('*, combat_encounters!combat_participants_encounter_id_fkey(*)')
        .eq('id', params.participantId)
        .single();

      if (!participant) {
        set.status = 404;
        return { error: 'Participant not found' };
      }

      const encounter = (participant as any).combat_encounters;

      const { data: session, error: sessionErr } = await supabaseService
        .from('game_sessions')
        .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id)')
        .eq('id', encounter.session_id)
        .single();

      if (sessionErr || !session) {
        set.status = 404;
        return { error: 'Session not found' };
      }

      const campaignOwner = (session as any).campaigns?.user_id;
      const characterOwner = (session as any).characters?.user_id;

      if (campaignOwner !== user.userId && characterOwner !== user.userId) {
        set.status = 403;
        return { error: 'Access denied' };
      }

      const conditions = await ConditionsService.getActiveConditions(params.participantId);
      const effects = await ConditionsService.getMechanicalEffects(params.participantId);

      return {
        participantId: params.participantId,
        conditions,
        aggregatedEffects: effects,
      };
    } catch (e) {
      logger.error({ msg: 'Get participant conditions error', error: e });
      const message = e instanceof Error ? e.message : 'Failed to get participant conditions';
      set.status = 500;
      return { error: message };
    }
  });
