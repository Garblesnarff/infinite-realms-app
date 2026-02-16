/**
 * Condition Mechanics Logic
 *
 * Extracted from ConditionsService.
 * Handles the pure logic of D&D 5E condition mechanics,
 * aggregating effects and calculating roll modifiers.
 */

import type {
  AggregatedMechanicalEffects,
  MechanicalEffects,
  SaveAbility,
  ParticipantConditionWithDetails,
} from '../../types/combat.js';

/**
 * Conditions that include or supersede other conditions
 */
export const CONDITION_HIERARCHY: Record<string, string[]> = {
  'Paralyzed': ['Incapacitated'],
  'Petrified': ['Incapacitated'],
  'Stunned': ['Incapacitated'],
  'Unconscious': ['Incapacitated', 'Prone'],
};

/**
 * Mutually incompatible conditions
 */
export const INCOMPATIBLE_CONDITIONS: Record<string, string[]> = {
  'Invisible': ['Blinded'], // Being invisible doesn't help if you're blind
  'Prone': ['Flying'], // Can't be prone while flying
};

export class ConditionMechanics {
  /**
   * Calculate aggregated mechanical effects from a list of conditions
   */
  static calculateAggregatedEffects(
    conditions: ParticipantConditionWithDetails[]
  ): AggregatedMechanicalEffects {
    const aggregated: AggregatedMechanicalEffects = {
      appliedConditions: [],
    };

    // Merge all mechanical effects
    for (const condition of conditions) {
      aggregated.appliedConditions.push(condition.condition.name);
      const effects = condition.condition.mechanicalEffects;

      // Merge effects - most restrictive wins
      for (const [key, value] of Object.entries(effects)) {
        if (key === 'appliedConditions') {
          continue;
        }

        const currentValue = (aggregated as Record<string, unknown>)[key];
        if (currentValue === undefined) {
          // TypeScript index signature handling
          (aggregated as Record<string, unknown>)[key] = value;
        } else {
          // Apply precedence rules
          (aggregated as Record<string, unknown>)[key] = this.mergeEffectValues(
            currentValue as string | number | boolean | undefined,
            value,
            key
          );
        }
      }
    }

    return aggregated;
  }

  /**
   * Merge two effect values, choosing the most restrictive
   */
  private static mergeEffectValues(
    current: string | number | boolean | undefined,
    incoming: string | number | boolean | undefined,
    key: string
  ): string | number | boolean | undefined {
    // For auto_fail, that always takes precedence
    if (current === 'auto_fail' || incoming === 'auto_fail') {
      return 'auto_fail';
    }

    // For advantage/disadvantage, disadvantage takes precedence
    if (
      (current === 'disadvantage' || incoming === 'disadvantage') &&
      (key.includes('attack') || key.includes('check') || key.includes('save'))
    ) {
      return 'disadvantage';
    }

    // For speed, the lowest (most restrictive) wins
    if (key === 'speed' && typeof current === 'number' && typeof incoming === 'number') {
      return Math.min(current, incoming);
    }

    // For actions/reactions 'none', that takes precedence
    if (current === 'none' || incoming === 'none') {
      return 'none';
    }

    // For boolean flags, true (more restrictive) takes precedence
    if (typeof current === 'boolean' && typeof incoming === 'boolean') {
      if (key.includes('cannot') || key.includes('negated')) {
        return current || incoming; // Either restriction applies
      }
    }

    // Default: incoming overrides
    return incoming;
  }

  /**
   * Calculate attack roll modifiers for an attacker based on their effects
   */
  static calculateAttackerModifiers(effects: AggregatedMechanicalEffects): {
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let hasAdvantage = false;
    let hasDisadvantage = false;

    // Check attacker's own conditions affecting their attacks
    if (effects.attack_rolls === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Attacker has disadvantage from: ${effects.appliedConditions.join(', ')}`);
    } else if (effects.attack_rolls === 'advantage') {
      hasAdvantage = true;
      reasons.push(`Attacker has advantage from: ${effects.appliedConditions.join(', ')}`);
    }

    // Blinded attackers have disadvantage
    if (effects.appliedConditions.includes('Blinded')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Blinded'))) {
        reasons.push('Attacker is Blinded (disadvantage on attacks)');
      }
    }

    // Poisoned attackers have disadvantage
    if (effects.appliedConditions.includes('Poisoned')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Poisoned'))) {
        reasons.push('Attacker is Poisoned (disadvantage on attacks)');
      }
    }

    // Prone attackers have disadvantage on attacks
    if (effects.appliedConditions.includes('Prone')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Prone'))) {
        reasons.push('Attacker is Prone (disadvantage on attacks)');
      }
    }

    // Restrained attackers have disadvantage
    if (effects.appliedConditions.includes('Restrained')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Restrained'))) {
        reasons.push('Attacker is Restrained (disadvantage on attacks)');
      }
    }

    return { hasAdvantage, hasDisadvantage, reasons };
  }

  /**
   * Calculate attack modifiers against a target based on their effects
   */
  static calculateTargetModifiers(
    effects: AggregatedMechanicalEffects,
    attackType: 'melee' | 'ranged' | 'spell',
    distanceInFeet?: number
  ): {
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    isAutoCrit: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let hasAdvantage = false;
    let hasDisadvantage = false;
    let isAutoCrit = false;

    const isWithin5Feet = distanceInFeet === undefined || distanceInFeet <= 5;
    const isMelee = attackType === 'melee' || isWithin5Feet;

    // Check target's conditions that affect attacks against them
    if (effects.attacks_against === 'advantage') {
      hasAdvantage = true;
      reasons.push(`Advantage from target conditions: ${effects.appliedConditions.join(', ')}`);
    } else if (effects.attacks_against === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Disadvantage from target conditions: ${effects.appliedConditions.join(', ')}`);
    }

    // Blinded targets: Attackers have advantage
    if (effects.appliedConditions.includes('Blinded')) {
      hasAdvantage = true;
      reasons.push('Target is Blinded (advantage on attacks vs)');
    }

    // Restrained targets: Attackers have advantage
    if (effects.appliedConditions.includes('Restrained')) {
      hasAdvantage = true;
      reasons.push('Target is Restrained (advantage on attacks vs)');
    }

    // Stunned targets: Attackers have advantage
    if (effects.appliedConditions.includes('Stunned')) {
      hasAdvantage = true;
      reasons.push('Target is Stunned (advantage on attacks vs)');
    }

    // Prone targets: melee within 5ft = advantage, ranged = disadvantage
    if (effects.appliedConditions.includes('Prone')) {
      if (isMelee && isWithin5Feet) {
        hasAdvantage = true;
        reasons.push('Target is Prone (advantage on melee attacks within 5ft)');
      } else if (attackType === 'ranged' && !isWithin5Feet) {
        hasDisadvantage = true;
        reasons.push('Target is Prone (disadvantage on ranged attacks beyond 5ft)');
      }
    }

    // Paralyzed/Unconscious within 5ft: Auto-crit
    if (effects.attacks_against_within_5ft === 'critical_on_hit' && isWithin5Feet) {
      isAutoCrit = true;
      reasons.push('Target is Paralyzed/Unconscious within 5ft (auto-crit on hit)');
    }

    // Direct check for paralyzed/unconscious
    if (
      (effects.appliedConditions.includes('Paralyzed') ||
        effects.appliedConditions.includes('Unconscious')) &&
      isWithin5Feet
    ) {
      isAutoCrit = true;
      hasAdvantage = true;
      if (!reasons.some(r => r.includes('auto-crit'))) {
        reasons.push('Target is Paralyzed/Unconscious within 5ft (auto-crit on hit, advantage)');
      }
    }

    return { hasAdvantage, hasDisadvantage, isAutoCrit, reasons };
  }

  /**
   * Calculate saving throw modifiers based on effects
   */
  static calculateSaveModifiers(
    effects: AggregatedMechanicalEffects,
    saveAbility: SaveAbility
  ): {
    autoFail: boolean;
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let autoFail = false;
    let hasAdvantage = false;
    let hasDisadvantage = false;

    // Map save ability to mechanical effect key
    const saveKey = `saving_throws_${saveAbility.slice(0, 3).toLowerCase()}` as keyof MechanicalEffects;
    const saveEffect = effects[saveKey];

    if (saveEffect === 'auto_fail') {
      autoFail = true;
      reasons.push(`Auto-fail ${saveAbility.toUpperCase()} saves from: ${effects.appliedConditions.join(', ')}`);
    } else if (saveEffect === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Disadvantage on ${saveAbility.toUpperCase()} saves from: ${effects.appliedConditions.join(', ')}`);
    } else if (saveEffect === 'advantage') {
      hasAdvantage = true;
      reasons.push(`Advantage on ${saveAbility.toUpperCase()} saves from: ${effects.appliedConditions.join(', ')}`);
    }

    // Paralyzed: Auto-fail STR and DEX saves
    if (
      effects.appliedConditions.includes('Paralyzed') &&
      (saveAbility === 'strength' || saveAbility === 'dexterity')
    ) {
      autoFail = true;
      if (!reasons.some(r => r.includes('Paralyzed'))) {
        reasons.push('Paralyzed (auto-fail STR/DEX saves)');
      }
    }

    // Unconscious: Auto-fail STR and DEX saves
    if (
      effects.appliedConditions.includes('Unconscious') &&
      (saveAbility === 'strength' || saveAbility === 'dexterity')
    ) {
      autoFail = true;
      if (!reasons.some(r => r.includes('Unconscious'))) {
        reasons.push('Unconscious (auto-fail STR/DEX saves)');
      }
    }

    // Stunned: Auto-fail STR and DEX saves
    if (
      effects.appliedConditions.includes('Stunned') &&
      (saveAbility === 'strength' || saveAbility === 'dexterity')
    ) {
      autoFail = true;
      if (!reasons.some(r => r.includes('Stunned'))) {
        reasons.push('Stunned (auto-fail STR/DEX saves)');
      }
    }

    // Restrained: Disadvantage on DEX saves
    if (effects.appliedConditions.includes('Restrained') && saveAbility === 'dexterity') {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Restrained'))) {
        reasons.push('Restrained (disadvantage on DEX saves)');
      }
    }

    return { autoFail, hasAdvantage, hasDisadvantage, reasons };
  }

  /**
   * Calculate ability check modifiers based on effects
   */
  static calculateAbilityCheckModifiers(effects: AggregatedMechanicalEffects): {
    hasDisadvantage: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let hasDisadvantage = false;

    // Poisoned: Disadvantage on ability checks
    if (effects.appliedConditions.includes('Poisoned')) {
      hasDisadvantage = true;
      reasons.push('Poisoned (disadvantage on ability checks)');
    }

    // General ability check effects
    if (effects.ability_checks === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Disadvantage on ability checks from: ${effects.appliedConditions.join(', ')}`);
    }

    return { hasDisadvantage, reasons };
  }

  /**
   * Calculate action and reaction restrictions based on effects
   */
  static calculateActionRestrictions(effects: AggregatedMechanicalEffects): {
    canAct: boolean;
    canReact: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let canAct = true;
    let canReact = true;

    // Check for incapacitated conditions
    const incapacitatingConditions = ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'];
    for (const condition of incapacitatingConditions) {
      if (effects.appliedConditions.includes(condition)) {
        canAct = false;
        canReact = false;
        reasons.push(`${condition} (cannot take actions or reactions)`);
        break;
      }
    }

    // Check explicit action restrictions
    if (effects.actions === 'none') {
      canAct = false;
      reasons.push('Cannot take actions');
    }

    if (effects.reactions === 'none') {
      canReact = false;
      reasons.push('Cannot take reactions');
    }

    return { canAct, canReact, reasons };
  }

  /**
   * Calculate speed modifiers based on effects
   */
  static calculateSpeedModifiers(effects: AggregatedMechanicalEffects): {
    speedMultiplier: number;
    speedOverride?: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let speedMultiplier = 1;
    let speedOverride: number | undefined;

    // Check for speed = 0 conditions
    if (
      effects.appliedConditions.includes('Paralyzed') ||
      effects.appliedConditions.includes('Petrified') ||
      effects.appliedConditions.includes('Stunned') ||
      effects.appliedConditions.includes('Unconscious') ||
      effects.appliedConditions.includes('Grappled') ||
      effects.appliedConditions.includes('Restrained')
    ) {
      speedOverride = 0;
      reasons.push('Speed reduced to 0 by condition');
    }

    // Prone: Must use crawl (costs extra movement)
    if (effects.appliedConditions.includes('Prone')) {
      speedMultiplier = 0.5; // Crawling costs double movement
      reasons.push('Prone (crawling costs extra movement)');
    }

    // Explicit speed value
    if (typeof effects.speed === 'number') {
      speedOverride = effects.speed;
      reasons.push(`Speed set to ${effects.speed} by condition`);
    }

    return { speedMultiplier, speedOverride, reasons };
  }
}
