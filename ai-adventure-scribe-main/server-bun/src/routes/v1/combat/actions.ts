import { Elysia } from 'elysia';
import { authenticateRequest } from '../../../lib/auth.js';
import { logger } from '../../../lib/logger.js';
import { CombatAttackService } from '../../../services/combat-attack-service.js';
import { verifyEncounterOwnership } from './helpers.js';
import { supabaseService } from '../../../lib/supabase.js';
import type {
  AttackRollInput,
  SpellAttackInput,
  CreateWeaponAttackInput,
} from '../../../types/combat.js';

export const actionRoutes = new Elysia()
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
        .eq('user_id', user.userId)
        .single();

      if (charErr || !character) {
        set.status = 404;
        return { error: 'Character not found' };
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
        .eq('user_id', user.userId)
        .single();

      if (charErr || !character) {
        set.status = 404;
        return { error: 'Character not found' };
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
  });
