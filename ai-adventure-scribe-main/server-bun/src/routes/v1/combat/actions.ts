import { Elysia } from 'elysia';

import { verifyEncounterOwnership } from './helpers.js';
import { AppError, NotFoundError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { requireAuth } from '../../../middleware/auth.js';
import { CharacterService } from '../../../services/character-service.js';
import { trackCombatEvent } from '../../../services/combat/combat-events.js';
import { publishCombatState } from '../../../services/combat/combat-sync-service.js';
import { CombatAttackService } from '../../../services/combat-attack-service.js';

import type {
  AttackRollInput,
  SpellAttackInput,
  CreateWeaponAttackInput,
} from '../../../types/combat.js';

function mapActionError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found',
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

export const actionRoutes = new Elysia()
  .use(requireAuth)
  .onBeforeHandle(async ({ params, user, set }) => {
    if (params?.encounterId) {
      const verification = await verifyEncounterOwnership(params.encounterId, user!.userId);
      if (!verification.success) {
        set.status = verification.error!.status;
        return { error: verification.error!.message };
      }
    }
    if (params?.characterId) {
      const character = await CharacterService.getById(params.characterId, user!.userId);
      if (!character) {
        set.status = 404;
        return { error: 'Character not found' };
      }
    }
  })

  /**
   * POST /v1/combat/:encounterId/attack
   * Resolve a weapon/melee attack
   */
  .post('/:encounterId/attack', async ({ params, body, set, user }) => {
    try {
      const attackInput = body as AttackRollInput;

      if (
        !attackInput.attackerId ||
        !attackInput.targetId ||
        !Number.isInteger(attackInput.expectedVersion)
      ) {
        set.status = 400;
        return { error: 'attackerId, targetId, and expectedVersion are required' };
      }

      const attackService = new CombatAttackService();
      const result = await attackService.resolveAttack(
        params.encounterId,
        attackInput,
        user!.userId,
      );

      trackCombatEvent('action_accepted', {
        encounterId: params.encounterId,
        actorId: attackInput.attackerId,
        action: 'attack',
        source: 'legacy_route',
      });
      if (result.finalDamage > 0)
        trackCombatEvent('damage_applied', {
          encounterId: params.encounterId,
          actorId: attackInput.attackerId,
          damage: result.finalDamage,
        });
      await publishCombatState(params.encounterId, user!.userId, 'attack');

      return result;
    } catch (e) {
      logger.error({ msg: 'Resolve attack error', error: e });
      return mapActionError(set, e, 'Failed to resolve attack', 'Combat target not found');
    }
  })

  /**
   * POST /v1/combat/:encounterId/spell-attack
   * Resolve a spell attack against targets
   */
  .post('/:encounterId/spell-attack', async ({ params, body, set, user }) => {
    try {
      const spellInput = body as SpellAttackInput;

      if (!spellInput.casterId || !spellInput.targetIds || !Array.isArray(spellInput.targetIds)) {
        set.status = 400;
        return { error: 'casterId and targetIds (array) are required' };
      }

      if (!spellInput.spellName) {
        set.status = 400;
        return { error: 'spellName is required' };
      }
      if (!Number.isInteger(spellInput.expectedVersion)) {
        set.status = 400;
        return { error: 'expectedVersion is required' };
      }

      const attackService = new CombatAttackService();
      const result = await attackService.resolveSpellAttack(
        params.encounterId,
        spellInput,
        user!.userId,
      );

      trackCombatEvent('action_accepted', {
        encounterId: params.encounterId,
        actorId: spellInput.casterId,
        action: 'spell',
        source: 'legacy_route',
      });
      const damage = result.results.reduce((total, outcome) => total + outcome.finalDamage, 0);
      if (damage > 0)
        trackCombatEvent('damage_applied', {
          encounterId: params.encounterId,
          actorId: spellInput.casterId,
          damage,
        });
      await publishCombatState(params.encounterId, user!.userId, 'spell');

      return result;
    } catch (e) {
      logger.error({ msg: 'Resolve spell attack error', error: e });
      return mapActionError(set, e, 'Failed to resolve spell attack', 'Combat target not found');
    }
  })

  /**
   * GET /v1/combat/characters/:characterId/attacks
   * Get all weapon attacks for a character
   */
  .get('/characters/:characterId/attacks', async ({ params, set, user }) => {
    try {
      const attackService = new CombatAttackService();
      const attacks = await attackService.getCharacterWeapons(params.characterId, user!.userId);

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
  .post('/characters/:characterId/attacks', async ({ params, body, set, user }) => {
    try {
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
      const attack = await attackService.createWeaponAttack(
        {
          characterId: params.characterId,
          ...weaponInput,
        },
        user!.userId,
      );

      set.status = 201;
      return { attack };
    } catch (e) {
      if (e instanceof NotFoundError) {
        set.status = 404;
        return { error: e.message };
      }
      logger.error({ msg: 'Create weapon attack error', error: e });
      return mapActionError(set, e, 'Failed to create weapon attack', 'Character not found');
    }
  });
