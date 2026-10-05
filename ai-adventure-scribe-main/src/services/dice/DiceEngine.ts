import { DiceRoll } from '@dice-roller/rpg-dice-roller';

import { parseLibraryRoll } from './parse-library-roll';

import type { Character } from '@/types/character';

import { calculateProficiencyBonus } from '@/utils/character/basic-math';

export interface DiceRollResult {
  expression: string;
  total: number;
  rolls: Array<{
    dice: number;
    value: number;
    /** +1, or -1 when this face comes from a subtracted dice group. */
    sign?: 1 | -1;
    /** False for a die dropped by an advantage/disadvantage keep modifier. */
    useInTotal?: boolean;
    critical?: boolean;
  }>;
  modifiers: number;
  advantage?: boolean;
  disadvantage?: boolean;
  critical?: boolean;
  naturalRoll?: number;
  timestamp: number;
  purpose?: string;
  actorId?: string;
  secret?: boolean;
}

export interface DiceRollOptions {
  advantage?: boolean;
  disadvantage?: boolean;
  purpose?: string;
  actorId?: string;
  secret?: boolean;
}

export class DiceEngine {
  /**
   * Roll dice using the improved dice roller
   */
  static roll(expression: string, options: DiceRollOptions = {}): DiceRollResult {
    const { advantage, disadvantage, purpose, actorId, secret } = options;

    // Advantage and disadvantage cancel out (SRD 5.1): the roll stays a plain d20.
    const keepMode = !!advantage !== !!disadvantage && /(\d*)d20/.test(expression);
    let finalExpression = expression;
    if (keepMode) {
      const count = expression.match(/(\d*)d20/)?.[1] || '1';
      finalExpression = expression.replace(/(\d*)d20/, `${count}d20${advantage ? 'kh1' : 'kl1'}`);
    }

    // rpg-dice-roller drops the unkept face of `1d20kh1`/`kl1`, so roll the
    // formula as written and add one extra d20. Every other dice group keeps
    // its own faces, and the selected d20 is marked so both dice can be shown.
    const roll = new DiceRoll(expression);
    let rolls = parseLibraryRoll(roll.rolls, expression);
    let total = roll.total;
    const firstD20 = keepMode ? rolls.findIndex((f) => f.dice === 20 && f.sign !== -1) : -1;
    if (firstD20 >= 0) {
      const first = rolls[firstD20];
      const extra = new DiceRoll('1d20').total;
      const extraWins = advantage ? extra > first.value : extra < first.value;
      rolls = [
        ...rolls.slice(0, firstD20),
        { ...first, useInTotal: !extraWins },
        {
          ...first,
          value: extra,
          useInTotal: extraWins,
          critical: extra === 1 || extra === 20,
        },
        ...rolls.slice(firstD20 + 1),
      ];
      if (extraWins) total += extra - first.value;
    }
    const naturalRoll = rolls.find(
      (face) => face.dice === 20 && face.sign !== -1 && face.useInTotal,
    )?.value;
    const signedSum = rolls.reduce(
      (sum, face) => sum + (face.useInTotal ? face.value * face.sign : 0),
      0,
    );
    const modifiers = rolls.length > 0 ? total - signedSum : 0;

    return {
      expression: finalExpression,
      total,
      rolls,
      modifiers,
      advantage: (advantage && !disadvantage) || false,
      disadvantage: (disadvantage && !advantage) || false,
      critical: naturalRoll === 20,
      naturalRoll,
      timestamp: Date.now(),
      purpose,
      actorId,
      secret,
    };
  }

  /**
   * Parse a string to find dice expressions
   * Used for parsing DM messages with embedded dice
   */
  static findDiceExpressions(text: string): Array<{
    expression: string;
    purpose?: string;
    index: number;
    length: number;
  }> {
    // Match patterns like [DICE: 1d20+5 attack] or [DICE: 2d6+3]
    const dicePattern = /\[DICE:\s*([^\]]+?)(?:\s+([^\]]+?))?\]/g;
    const matches = [];
    let match;

    while ((match = dicePattern.exec(text)) !== null) {
      const expression = match[1].trim();
      const purpose = match[2]?.trim();

      matches.push({
        expression,
        purpose,
        index: match.index,
        length: match[0].length,
      });
    }

    return matches;
  }

  /**
   * Calculate critical damage according to 5e rules
   * Double the dice, not the total
   */
  static calculateCriticalDamage(baseDamageExpression: string): DiceRollResult {
    // Parse the expression to double only the dice portions
    const criticalExpression = baseDamageExpression.replace(
      /(\d+)d(\d+)/g,
      (match, count, sides) => `${parseInt(count) * 2}d${sides}`,
    );

    return this.roll(criticalExpression, { purpose: 'critical damage' });
  }

  /**
   * Get weapon damage formula by weapon name with actual character modifiers
   */
  static getWeaponDamageFormula(
    weaponName: string,
    character?: Character,
    preferredAbility?: 'str' | 'dex',
  ): string {
    const weaponData: Record<
      string,
      { damage: string; versatile?: string; finesse?: boolean; ranged?: boolean }
    > = {
      // Simple melee weapons
      club: { damage: '1d4' },
      dagger: { damage: '1d4', finesse: true },
      dart: { damage: '1d4', ranged: true },
      javelin: { damage: '1d6' },
      mace: { damage: '1d6' },
      staff: { damage: '1d6', versatile: '1d8' },
      spear: { damage: '1d6', versatile: '1d8' },

      // Martial melee weapons
      battleaxe: { damage: '1d8', versatile: '1d10' },
      longsword: { damage: '1d8', versatile: '1d10' },
      rapier: { damage: '1d8', finesse: true },
      scimitar: { damage: '1d6', finesse: true },
      shortsword: { damage: '1d6', finesse: true },
      warhammer: { damage: '1d8', versatile: '1d10' },
      greatsword: { damage: '2d6' },
      greataxe: { damage: '1d12' },
      maul: { damage: '2d6' },

      // Ranged weapons
      shortbow: { damage: '1d6', ranged: true },
      longbow: { damage: '1d8', ranged: true },
      crossbow: { damage: '1d8', ranged: true },
      handcrossbow: { damage: '1d6', ranged: true },
    };

    const weapon = weaponData[weaponName.toLowerCase()];
    if (!weapon) {
      // Default weapon - use character's STR if available
      const modifier = character?.abilityScores?.strength?.modifier ?? 0;
      return modifier >= 0 ? `1d6+${modifier}` : `1d6${modifier}`;
    }

    // Determine which ability to use
    let abilityToUse: 'strength' | 'dexterity' = 'strength';

    if (weapon.ranged) {
      // Ranged weapons always use dex
      abilityToUse = 'dexterity';
    } else if (weapon.finesse) {
      // Finesse weapons can use either STR or DEX - choose the better one
      if (character?.abilityScores) {
        const strMod = character.abilityScores.strength?.modifier ?? 0;
        const dexMod = character.abilityScores.dexterity?.modifier ?? 0;
        abilityToUse = preferredAbility === 'dex' || dexMod > strMod ? 'dexterity' : 'strength';
      } else {
        abilityToUse = preferredAbility === 'dex' ? 'dexterity' : 'strength';
      }
    }

    // Get the actual modifier value
    const modifier = character?.abilityScores?.[abilityToUse]?.modifier ?? 0;

    // Format the damage formula with proper +/- signs
    if (modifier === 0) {
      return weapon.damage;
    } else if (modifier > 0) {
      return `${weapon.damage}+${modifier}`;
    } else {
      return `${weapon.damage}${modifier}`;
    }
  }

  /**
   * Create an attack roll request with proper formula using character data
   */
  static createAttackRollRequest(
    weaponName: string,
    character?: Character,
    preferredAbility?: 'str' | 'dex',
  ): {
    formula: string;
    purpose: string;
  } {
    const weaponData: Record<string, { finesse?: boolean; ranged?: boolean }> = {
      dagger: { finesse: true },
      rapier: { finesse: true },
      scimitar: { finesse: true },
      shortsword: { finesse: true },
      shortbow: { ranged: true },
      longbow: { ranged: true },
      crossbow: { ranged: true },
      handcrossbow: { ranged: true },
      dart: { ranged: true },
    };

    const weapon = weaponData[weaponName.toLowerCase()];

    // Determine which ability to use for attack roll
    let abilityToUse: 'strength' | 'dexterity' = 'strength';

    if (weapon?.ranged) {
      abilityToUse = 'dexterity';
    } else if (weapon?.finesse && character?.abilityScores) {
      const strMod = character.abilityScores.strength?.modifier ?? 0;
      const dexMod = character.abilityScores.dexterity?.modifier ?? 0;
      abilityToUse = preferredAbility === 'dex' || dexMod > strMod ? 'dexterity' : 'strength';
    } else if (weapon?.finesse) {
      abilityToUse = preferredAbility === 'dex' ? 'dexterity' : 'strength';
    }

    // Calculate attack bonus: ability modifier + proficiency bonus
    const abilityMod = character?.abilityScores?.[abilityToUse]?.modifier ?? 0;
    const proficiencyBonus = calculateProficiencyBonus(character?.level || 1);
    const attackBonus = abilityMod + proficiencyBonus;

    // Format the attack formula
    const formula = attackBonus >= 0 ? `1d20+${attackBonus}` : `1d20${attackBonus}`;

    return {
      formula,
      purpose: `Attack roll with ${weaponName}`,
    };
  }

  /**
   * Create a damage roll request with proper formula using character data
   */
  static createDamageRollRequest(
    weaponName: string,
    critical: boolean = false,
    character?: Character,
    preferredAbility?: 'str' | 'dex',
  ): {
    formula: string;
    purpose: string;
  } {
    const baseFormula = this.getWeaponDamageFormula(weaponName, character, preferredAbility);

    if (critical) {
      const criticalFormula = baseFormula.replace(
        /(\d+)d(\d+)/g,
        (match, count, sides) => `${parseInt(count) * 2}d${sides}`,
      );
      return {
        formula: criticalFormula,
        purpose: `Critical damage roll for ${weaponName}`,
      };
    }

    return {
      formula: baseFormula,
      purpose: `Damage roll for ${weaponName}`,
    };
  }

  /**
   * Check if a roll result is a critical hit
   */
  static isCriticalHit(result: DiceRollResult): boolean {
    return result.naturalRoll === 20 && result.rolls.some((r) => r.dice === 20);
  }

  /**
   * Check if a roll result is a critical miss
   */
  static isCriticalMiss(result: DiceRollResult): boolean {
    return result.naturalRoll === 1 && result.rolls.some((r) => r.dice === 20);
  }

  /**
   * Resolve advantage/disadvantage from multiple sources
   */
  static resolveAdvantage(
    sources: Array<{ advantage?: boolean; disadvantage?: boolean; source: string }>,
  ): {
    advantage: boolean;
    disadvantage: boolean;
    canceledOut: boolean;
  } {
    const advantageSources = sources.filter((s) => s.advantage);
    const disadvantageSources = sources.filter((s) => s.disadvantage);

    const hasAdvantage = advantageSources.length > 0;
    const hasDisadvantage = disadvantageSources.length > 0;

    return {
      advantage: hasAdvantage && !hasDisadvantage,
      disadvantage: hasDisadvantage && !hasAdvantage,
      canceledOut: hasAdvantage && hasDisadvantage,
    };
  }
}
