/**
 * Combat Action Service
 *
 * Handles D&D 5E action economy enforcement including:
 * - Two-Weapon Fighting validation
 * - Bonus action spell restrictions
 * - Ready action concentration tracking
 * - Action availability checking
 *
 * @module server/services/combat-action-service
 */

import { ConditionsService } from './conditions-service.js';

/**
 * Action types available in combat
 */
export type ActionType = 'action' | 'bonus_action' | 'reaction' | 'movement' | 'free_action';

/**
 * Two-weapon fighting validation result
 */
export interface TWFValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  /**
   * Damage formula for off-hand attack
   * D&D 5E: No ability modifier unless character has Two-Weapon Fighting style
   */
  offHandDamageFormula: string;
  includesAbilityModifier: boolean;
}

/**
 * Spell casting validation result
 */
export interface SpellCastingValidationResult {
  isValid: boolean;
  violation?: string;
  warnings: string[];
  /**
   * After casting a bonus action spell, action can only be a cantrip
   */
  actionRestrictedToCantrip: boolean;
}

/**
 * Ready action validation result
 */
export interface ReadyActionValidationResult {
  isValid: boolean;
  errors: string[];
  /**
   * If readied action requires concentration, current concentration ends
   */
  concentrationEnds: boolean;
  warning?: string;
}

/**
 * Turn action state tracking
 */
export interface TurnActionState {
  participantId: string;
  round: number;
  actionUsed: boolean;
  bonusActionUsed: boolean;
  reactionUsed: boolean;
  movementUsed: number;
  maxMovement: number;
  bonusActionSpellCast: boolean;
  actionSpellCast: boolean;
  concentratingOn?: string;
}

/**
 * Weapon properties relevant for TWF
 */
export interface WeaponForTWF {
  name: string;
  damageDice: string;
  damageBonus: number;
  properties: string[];
  isLight: boolean;
}

export class CombatActionService {
  /**
   * Validate Two-Weapon Fighting attack
   *
   * D&D 5E Rules (PHB p.195):
   * - When you take the Attack action with a light melee weapon in one hand,
   *   you can use your bonus action to attack with a different light melee
   *   weapon in the other hand
   * - You don't add your ability modifier to the damage of the bonus attack,
   *   unless that modifier is negative
   * - If you have the Two-Weapon Fighting style, you add your ability modifier
   *
   * @param mainHandWeapon - The weapon used for the Attack action
   * @param offHandWeapon - The weapon used for the bonus action attack
   * @param abilityModifier - The relevant ability modifier (usually STR or DEX)
   * @param hasTwoWeaponFightingStyle - Whether character has the Fighting Style
   */
  static validateTwoWeaponFighting(
    mainHandWeapon: WeaponForTWF,
    offHandWeapon: WeaponForTWF,
    abilityModifier: number,
    hasTwoWeaponFightingStyle: boolean = false
  ): TWFValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if both weapons are light
    if (!mainHandWeapon.isLight) {
      errors.push(`${mainHandWeapon.name} must be a light weapon for Two-Weapon Fighting`);
    }
    if (!offHandWeapon.isLight) {
      errors.push(`${offHandWeapon.name} must be a light weapon for Two-Weapon Fighting`);
    }

    // Calculate off-hand damage
    let offHandDamageBonus = offHandWeapon.damageBonus;
    let includesAbilityModifier = false;

    if (hasTwoWeaponFightingStyle) {
      // With Fighting Style: add ability modifier
      offHandDamageBonus = offHandWeapon.damageBonus + abilityModifier;
      includesAbilityModifier = true;
    } else {
      // Without Fighting Style: only add negative ability modifiers
      if (abilityModifier < 0) {
        offHandDamageBonus = offHandWeapon.damageBonus + abilityModifier;
        includesAbilityModifier = true;
        warnings.push('Negative ability modifier applied to off-hand damage');
      } else {
        // Don't add positive ability modifier
        warnings.push('Off-hand attack does not include ability modifier to damage (no Two-Weapon Fighting style)');
      }
    }

    // Build damage formula
    const offHandDamageFormula = offHandDamageBonus >= 0
      ? `${offHandWeapon.damageDice}+${offHandDamageBonus}`
      : `${offHandWeapon.damageDice}${offHandDamageBonus}`;

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      offHandDamageFormula,
      includesAbilityModifier,
    };
  }

  /**
   * Validate spell casting action economy
   *
   * D&D 5E Rules (PHB p.202):
   * - If you cast a spell as a bonus action, you can't cast another spell
   *   during the same turn, except for a cantrip with a casting time of 1 action
   *
   * @param bonusActionSpell - Spell being cast as bonus action (or null if not casting BA spell)
   * @param actionSpell - Spell being cast as action (or null if not casting action spell)
   * @param bonusActionSpellLevel - Level of BA spell (0 = cantrip)
   * @param actionSpellLevel - Level of action spell (0 = cantrip)
   */
  static validateSpellCasting(
    bonusActionSpell?: string | null,
    actionSpell?: string | null,
    bonusActionSpellLevel: number = 0,
    actionSpellLevel: number = 0
  ): SpellCastingValidationResult {
    const warnings: string[] = [];
    let actionRestrictedToCantrip = false;

    // If casting a bonus action spell
    if (bonusActionSpell && bonusActionSpellLevel > 0) {
      actionRestrictedToCantrip = true;
      warnings.push('Casting a bonus action spell restricts your action to cantrips only');

      // Check if action spell is allowed
      if (actionSpell && actionSpellLevel > 0) {
        return {
          isValid: false,
          violation: `Cannot cast ${actionSpell} (level ${actionSpellLevel}) as an action when you've cast ${bonusActionSpell} as a bonus action. You can only cast a cantrip as your action.`,
          warnings,
          actionRestrictedToCantrip,
        };
      }
    }

    // Bonus action cantrips still restrict to cantrips (same rule applies)
    if (bonusActionSpell && bonusActionSpellLevel === 0) {
      // Technically even BA cantrips trigger this rule, but it's less restrictive
      // since you can still cast a cantrip as your action
      actionRestrictedToCantrip = true;
      if (actionSpell && actionSpellLevel > 0) {
        return {
          isValid: false,
          violation: `Cannot cast ${actionSpell} (level ${actionSpellLevel}) as an action when you've cast a bonus action spell. You can only cast a cantrip as your action.`,
          warnings,
          actionRestrictedToCantrip,
        };
      }
    }

    return {
      isValid: true,
      warnings,
      actionRestrictedToCantrip,
    };
  }

  /**
   * Validate ready action
   *
   * D&D 5E Rules (PHB p.193):
   * - Ready uses your action to wait for a trigger
   * - If you ready a spell, you must concentrate on it until you release it
   * - If your concentration is broken, the spell is lost
   *
   * @param character - Character info for the ready action
   * @param readiedActionType - What type of action is being readied
   * @param isReadiedSpell - Whether the readied action is a spell
   * @param currentConcentration - Current concentration spell (if any)
   */
  static validateReadyAction(
    readiedActionType: 'attack' | 'spell' | 'movement' | 'other',
    isReadiedSpell: boolean,
    currentConcentration?: string | null
  ): ReadyActionValidationResult {
    const errors: string[] = [];
    let concentrationEnds = false;
    let warning: string | undefined;

    if (isReadiedSpell) {
      // Readying a spell requires concentration
      if (currentConcentration) {
        concentrationEnds = true;
        warning = `Readying a spell ends concentration on ${currentConcentration}`;
      }

      // Note: The spell slot is expended when you ready the spell, not when you cast it
      // If you don't use your reaction to release it, the spell is wasted
    }

    return {
      isValid: errors.length === 0,
      errors,
      concentrationEnds,
      warning,
    };
  }

  /**
   * Create initial turn action state
   */
  static createTurnState(
    participantId: string,
    round: number,
    maxMovement: number,
    concentratingOn?: string
  ): TurnActionState {
    return {
      participantId,
      round,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      movementUsed: 0,
      maxMovement,
      bonusActionSpellCast: false,
      actionSpellCast: false,
      concentratingOn,
    };
  }

  /**
   * Check if a specific action can be taken
   */
  static async canTakeAction(
    participantId: string,
    turnState: TurnActionState,
    actionType: ActionType
  ): Promise<{
    canTake: boolean;
    reason?: string;
  }> {
    // Check conditions first
    const { canAct, canReact, reasons } = await ConditionsService.canTakeActions(participantId);

    switch (actionType) {
      case 'action':
        if (!canAct) {
          return { canTake: false, reason: reasons.join(', ') };
        }
        if (turnState.actionUsed) {
          return { canTake: false, reason: 'Action already used this turn' };
        }
        return { canTake: true };

      case 'bonus_action':
        if (!canAct) {
          return { canTake: false, reason: reasons.join(', ') };
        }
        if (turnState.bonusActionUsed) {
          return { canTake: false, reason: 'Bonus action already used this turn' };
        }
        return { canTake: true };

      case 'reaction':
        if (!canReact) {
          return { canTake: false, reason: reasons.join(', ') };
        }
        if (turnState.reactionUsed) {
          return { canTake: false, reason: 'Reaction already used since your last turn' };
        }
        return { canTake: true };

      case 'movement':
        if (turnState.movementUsed >= turnState.maxMovement) {
          return { canTake: false, reason: 'No movement remaining' };
        }
        // Check for speed = 0 conditions
        const speedMods = await ConditionsService.getSpeedModifiers(participantId);
        if (speedMods.speedOverride === 0) {
          return { canTake: false, reason: speedMods.reasons.join(', ') };
        }
        return { canTake: true };

      case 'free_action':
        // Free actions (like dropping an item) are almost always available
        return { canTake: true };

      default:
        return { canTake: false, reason: 'Unknown action type' };
    }
  }

  /**
   * Record that an action was taken
   */
  static recordAction(
    turnState: TurnActionState,
    actionType: ActionType,
    isSpell: boolean = false,
    spellLevel: number = 0,
    movementUsed: number = 0
  ): TurnActionState {
    const newState = { ...turnState };

    switch (actionType) {
      case 'action':
        newState.actionUsed = true;
        if (isSpell) {
          newState.actionSpellCast = true;
        }
        break;

      case 'bonus_action':
        newState.bonusActionUsed = true;
        if (isSpell) {
          newState.bonusActionSpellCast = true;
        }
        break;

      case 'reaction':
        newState.reactionUsed = true;
        break;

      case 'movement':
        newState.movementUsed += movementUsed;
        break;
    }

    return newState;
  }

  /**
   * Get remaining movement considering conditions
   */
  static async getRemainingMovement(
    participantId: string,
    turnState: TurnActionState
  ): Promise<{
    remaining: number;
    effectiveSpeed: number;
    reasons: string[];
  }> {
    const speedMods = await ConditionsService.getSpeedModifiers(participantId);

    let effectiveSpeed = turnState.maxMovement;
    const reasons: string[] = [];

    if (speedMods.speedOverride !== undefined) {
      effectiveSpeed = speedMods.speedOverride;
      reasons.push(...speedMods.reasons);
    } else if (speedMods.speedMultiplier !== 1) {
      effectiveSpeed = Math.floor(turnState.maxMovement * speedMods.speedMultiplier);
      reasons.push(...speedMods.reasons);
    }

    const remaining = Math.max(0, effectiveSpeed - turnState.movementUsed);

    return { remaining, effectiveSpeed, reasons };
  }
}

// Export singleton-style access (class has all static methods)
export const combatActionService = CombatActionService;
