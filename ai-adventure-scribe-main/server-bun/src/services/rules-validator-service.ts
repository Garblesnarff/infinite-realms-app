/**
 * Rules Validator Service
 *
 * Light-touch validation layer for critical D&D 5E rules.
 * This is the "Hybrid Light" approach - validates only rules
 * that MUST be correct, leaving softer rules to AI prompts.
 *
 * CRITICAL RULES VALIDATED:
 * 1. Death saves at 0 HP
 * 2. Damage at 0 HP → death save failures
 * 3. Action economy violations
 * 4. Two-weapon fighting damage
 *
 * @module server/services/rules-validator-service
 */

import { CombatActionService, type TurnActionState, type WeaponForTWF } from './combat-action-service.js';
import { ConditionsService } from './conditions-service.js';
import { ExhaustionService, type ExhaustionLevel } from './exhaustion-service.js';

/**
 * Death save validation result
 */
export interface DeathSaveValidation {
  required: boolean;
  reason?: string;
  currentSuccesses: number;
  currentFailures: number;
  isStable: boolean;
  isDead: boolean;
}

/**
 * Damage at 0 HP validation result
 */
export interface DamageAt0HPValidation {
  isAt0HP: boolean;
  deathSaveFailuresToAdd: number;
  message: string;
  wouldKill: boolean;
}

/**
 * Action economy validation result
 */
export interface ActionEconomyValidation {
  isValid: boolean;
  violations: string[];
  warnings: string[];
  canProceed: boolean;
}

/**
 * TWF damage validation result
 */
export interface TWFDamageValidation {
  isValid: boolean;
  correctedDamageFormula: string;
  abilityModifierIncluded: boolean;
  message: string;
}

/**
 * Overall combat action validation
 */
export interface CombatActionValidation {
  isValid: boolean;
  criticalViolations: string[];
  warnings: string[];
  autoCorrections: string[];
  canProceed: boolean;
}

/**
 * Participant combat state for validation
 */
export interface ParticipantCombatState {
  participantId: string;
  currentHp: number;
  maxHp: number;
  tempHp: number;
  isConscious: boolean;
  isStable: boolean;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  exhaustionLevel: ExhaustionLevel;
  conditions: string[];
}

export class CriticalRulesValidator {
  /**
   * CRITICAL RULE 1: Validate death save requirement
   *
   * D&D 5E (PHB p.197): When you start your turn with 0 HP,
   * you must make a death saving throw.
   */
  static validateDeathSaveRequired(participant: ParticipantCombatState): DeathSaveValidation {
    const { currentHp, isConscious, isStable, deathSaveSuccesses, deathSaveFailures } = participant;

    // Already dead
    if (deathSaveFailures >= 3) {
      return {
        required: false,
        reason: 'Character is dead (3 death save failures)',
        currentSuccesses: deathSaveSuccesses,
        currentFailures: deathSaveFailures,
        isStable: false,
        isDead: true,
      };
    }

    // Stabilized
    if (isStable) {
      return {
        required: false,
        reason: 'Character is stable and no longer making death saves',
        currentSuccesses: deathSaveSuccesses,
        currentFailures: deathSaveFailures,
        isStable: true,
        isDead: false,
      };
    }

    // At 0 HP and not conscious
    if (currentHp === 0 && !isConscious) {
      return {
        required: true,
        reason: 'Character is at 0 HP and must make a death saving throw',
        currentSuccesses: deathSaveSuccesses,
        currentFailures: deathSaveFailures,
        isStable: false,
        isDead: false,
      };
    }

    // HP > 0 or conscious
    return {
      required: false,
      reason: 'Character is conscious with HP > 0',
      currentSuccesses: deathSaveSuccesses,
      currentFailures: deathSaveFailures,
      isStable: false,
      isDead: false,
    };
  }

  /**
   * CRITICAL RULE 2: Validate damage at 0 HP → death save failures
   *
   * D&D 5E (PHB p.197): If you take damage while at 0 HP,
   * you suffer a death saving throw failure.
   * Critical hit = 2 failures.
   */
  static validateDamageAt0HP(
    participant: ParticipantCombatState,
    incomingDamage: number,
    isCriticalHit: boolean
  ): DamageAt0HPValidation {
    const { currentHp, deathSaveFailures, isConscious } = participant;

    // Not at 0 HP - normal damage rules apply
    if (currentHp > 0 || isConscious) {
      return {
        isAt0HP: false,
        deathSaveFailuresToAdd: 0,
        message: 'Character is not at 0 HP - normal damage rules apply',
        wouldKill: false,
      };
    }

    // At 0 HP and taking damage
    if (incomingDamage <= 0) {
      return {
        isAt0HP: true,
        deathSaveFailuresToAdd: 0,
        message: 'No damage dealt',
        wouldKill: false,
      };
    }

    // Calculate failures to add
    const failuresToAdd = isCriticalHit ? 2 : 1;
    const totalFailures = deathSaveFailures + failuresToAdd;
    const wouldKill = totalFailures >= 3;

    let message: string;
    if (isCriticalHit) {
      message = `Critical hit on unconscious character! Adding 2 death save failures (${deathSaveFailures} → ${Math.min(3, totalFailures)})`;
    } else {
      message = `Damage to unconscious character! Adding 1 death save failure (${deathSaveFailures} → ${Math.min(3, totalFailures)})`;
    }

    if (wouldKill) {
      message += ' - Character dies!';
    }

    return {
      isAt0HP: true,
      deathSaveFailuresToAdd: failuresToAdd,
      message,
      wouldKill,
    };
  }

  /**
   * CRITICAL RULE 3: Validate action economy
   *
   * Checks:
   * - Can't use action if already used
   * - BA spell limits action to cantrip
   * - Can't take action if incapacitated
   */
  static async validateActionEconomy(
    participantId: string,
    turnState: TurnActionState,
    proposedAction: {
      type: 'action' | 'bonus_action' | 'reaction';
      isSpell?: boolean;
      spellLevel?: number;
    },
    userId?: string
  ): Promise<ActionEconomyValidation> {
    const violations: string[] = [];
    const warnings: string[] = [];

    // Check conditions
    const { canAct, canReact, reasons } = await ConditionsService.canTakeActions(participantId, userId);

    if (proposedAction.type === 'action' || proposedAction.type === 'bonus_action') {
      if (!canAct) {
        violations.push(`Cannot take ${proposedAction.type}: ${reasons.join(', ')}`);
      }
    }

    if (proposedAction.type === 'reaction' && !canReact) {
      violations.push(`Cannot take reaction: ${reasons.join(', ')}`);
    }

    // Check already used
    if (proposedAction.type === 'action' && turnState.actionUsed) {
      violations.push('Action already used this turn');
    }

    if (proposedAction.type === 'bonus_action' && turnState.bonusActionUsed) {
      violations.push('Bonus action already used this turn');
    }

    if (proposedAction.type === 'reaction' && turnState.reactionUsed) {
      violations.push('Reaction already used since last turn');
    }

    // Check BA spell restriction
    if (proposedAction.type === 'action' && proposedAction.isSpell && turnState.bonusActionSpellCast) {
      if (proposedAction.spellLevel && proposedAction.spellLevel > 0) {
        violations.push(
          `Cannot cast a level ${proposedAction.spellLevel} spell as action after casting a bonus action spell. ` +
          'You can only cast a cantrip (level 0) as your action.'
        );
      }
    }

    // Warning for BA spell restriction (even if cantrip is valid)
    if (turnState.bonusActionSpellCast && proposedAction.type === 'action' && proposedAction.isSpell) {
      warnings.push('Remember: After casting a bonus action spell, your action can only be a cantrip');
    }

    return {
      isValid: violations.length === 0,
      violations,
      warnings,
      canProceed: violations.length === 0,
    };
  }

  /**
   * CRITICAL RULE 4: Validate Two-Weapon Fighting damage
   *
   * D&D 5E (PHB p.195): No ability modifier on off-hand damage
   * unless character has Two-Weapon Fighting style.
   */
  static validateTWFDamage(
    offHandWeapon: WeaponForTWF,
    abilityModifier: number,
    hasTwoWeaponFightingStyle: boolean,
    proposedDamageFormula: string
  ): TWFDamageValidation {
    // Calculate correct damage
    const validation = CombatActionService.validateTwoWeaponFighting(
      { name: 'main', damageDice: '1d6', damageBonus: 0, properties: ['light'], isLight: true },
      offHandWeapon,
      abilityModifier,
      hasTwoWeaponFightingStyle
    );

    // Check if proposed formula matches correct formula
    const isValid = proposedDamageFormula === validation.offHandDamageFormula;

    let message: string;
    if (isValid) {
      message = 'Damage formula is correct';
    } else if (hasTwoWeaponFightingStyle) {
      message = `With Two-Weapon Fighting style, ability modifier IS included. Correct formula: ${validation.offHandDamageFormula}`;
    } else {
      message = `Without Two-Weapon Fighting style, ability modifier is NOT included${abilityModifier < 0 ? ' (except negative modifiers)' : ''}. Correct formula: ${validation.offHandDamageFormula}`;
    }

    return {
      isValid,
      correctedDamageFormula: validation.offHandDamageFormula,
      abilityModifierIncluded: validation.includesAbilityModifier,
      message,
    };
  }

  /**
   * Comprehensive combat action validation
   *
   * Runs all critical rule checks for a proposed combat action.
   */
  static async validateCombatAction(
    participant: ParticipantCombatState,
    turnState: TurnActionState,
    action: {
      type: 'attack' | 'spell' | 'action' | 'bonus_action' | 'reaction' | 'movement';
      targetId?: string;
      targetState?: ParticipantCombatState;
      damage?: number;
      isCritical?: boolean;
      isSpell?: boolean;
      spellLevel?: number;
      isTWFOffHand?: boolean;
      offHandWeapon?: WeaponForTWF;
      abilityModifier?: number;
      hasTWFStyle?: boolean;
    },
    userId?: string
  ): Promise<CombatActionValidation> {
    const criticalViolations: string[] = [];
    const warnings: string[] = [];
    const autoCorrections: string[] = [];

    // Check death save requirement at start of turn
    if (action.type === 'action' || action.type === 'bonus_action') {
      const deathSaveValidation = this.validateDeathSaveRequired(participant);
      if (deathSaveValidation.required) {
        warnings.push('Death saving throw required at start of turn');
      }
      if (deathSaveValidation.isDead) {
        criticalViolations.push('Character is dead and cannot take actions');
      }
    }

    // Check action economy
    if (['action', 'bonus_action', 'reaction'].includes(action.type)) {
      const economyValidation = await this.validateActionEconomy(
        participant.participantId,
        turnState,
        {
          type: action.type as 'action' | 'bonus_action' | 'reaction',
          isSpell: action.isSpell,
          spellLevel: action.spellLevel,
        },
        userId
      );
      criticalViolations.push(...economyValidation.violations);
      warnings.push(...economyValidation.warnings);
    }

    // Check damage at 0 HP for target
    if (action.targetState && action.damage && action.damage > 0) {
      const damageValidation = this.validateDamageAt0HP(
        action.targetState,
        action.damage,
        action.isCritical || false
      );
      if (damageValidation.isAt0HP && damageValidation.deathSaveFailuresToAdd > 0) {
        autoCorrections.push(damageValidation.message);
      }
    }

    // Check TWF damage
    if (action.isTWFOffHand && action.offHandWeapon && action.abilityModifier !== undefined) {
      const twfValidation = this.validateTWFDamage(
        action.offHandWeapon,
        action.abilityModifier,
        action.hasTWFStyle || false,
        '' // We'll auto-correct regardless
      );
      if (!twfValidation.abilityModifierIncluded && action.abilityModifier > 0) {
        autoCorrections.push(`Off-hand damage auto-corrected: ${twfValidation.message}`);
      }
    }

    // Check exhaustion effects
    const exhaustionMods = ExhaustionService.getExhaustionModifiers(participant.exhaustionLevel);
    if (exhaustionMods.isDead) {
      criticalViolations.push('Character is dead from exhaustion');
    }
    if (exhaustionMods.cannotMove && action.type === 'movement') {
      criticalViolations.push('Cannot move: Exhaustion level 5 (speed = 0)');
    }
    if (exhaustionMods.attackDisadvantage && action.type === 'attack') {
      warnings.push('Exhaustion level 3+: Disadvantage on attack rolls');
    }

    return {
      isValid: criticalViolations.length === 0,
      criticalViolations,
      warnings,
      autoCorrections,
      canProceed: criticalViolations.length === 0,
    };
  }

  /**
   * Quick validation for common scenarios
   */
  static quickValidate = {
    /**
     * Can this participant take their turn?
     */
    canTakeTurn: async (participant: ParticipantCombatState, userId?: string): Promise<{ can: boolean; reason?: string }> => {
      // Dead from exhaustion
      const exhaustionMods = ExhaustionService.getExhaustionModifiers(participant.exhaustionLevel);
      if (exhaustionMods.isDead) {
        return { can: false, reason: 'Dead from exhaustion' };
      }

      // Dead from death saves
      if (participant.deathSaveFailures >= 3) {
        return { can: false, reason: 'Dead (3 death save failures)' };
      }

      // Check conditions
      const { canAct, reasons } = await ConditionsService.canTakeActions(participant.participantId, userId);
      if (!canAct) {
        return { can: false, reason: reasons.join(', ') };
      }

      return { can: true };
    },

    /**
     * Does this participant need a death save?
     */
    needsDeathSave: (participant: ParticipantCombatState): boolean => {
      return CriticalRulesValidator.validateDeathSaveRequired(participant).required;
    },

    /**
     * Will this damage kill an unconscious target?
     */
    wouldKillUnconscious: (
      participant: ParticipantCombatState,
      damage: number,
      isCritical: boolean
    ): boolean => {
      return CriticalRulesValidator.validateDamageAt0HP(participant, damage, isCritical).wouldKill;
    },
  };
}

// Export singleton-style access
export const criticalRulesValidator = CriticalRulesValidator;
