import type { Character } from '@/types/character';
import type { RollRequest } from '@/types/roll-request';

import logger from '@/lib/logger';
import {
  calculateRollWithBreakdown,
  SKILL_ABILITIES,
  type AbilityName,
  type RollCalculation,
} from '@/utils/characterModifiers';
import { findDeclaredAbility, findDeclaredSkill } from '@/utils/roll-request/declared-roll';

/** Shown instead of rolling a d20+0 when the character that owns the modifier is not loaded. */
export const MODIFIER_UNKNOWN_LABEL = 'modifier unknown';

/** Returns true when the formula is safe to pass to the dice engine (no unresolved symbolic modifiers). */
export function isNumericFormula(formula: string): boolean {
  return !/\b(cha|int|wis|str|dex|con|mod|modifier)\b/i.test(formula);
}

export interface DialogRollFormula extends RollCalculation {
  modifierUnknown: boolean;
}

const CHARACTER_MODIFIER_TYPES = new Set<RollRequest['type']>([
  'save',
  'check',
  'skill_check',
  'attack',
  'initiative',
]);

/**
 * The one place a DM roll request becomes the formula the dialog rolls.
 *
 * Saves, ability checks, skill checks and attacks use the loaded character's
 * modifier (ability, plus proficiency when the character has it). Damage keeps
 * the DM's formula. A modifier-bearing roll with no character is labelled
 * instead of rolled as +0.
 */
export function resolveDialogRollFormula(
  request: RollRequest,
  character: Character | null,
): DialogRollFormula {
  // An engine prompt carries the bonus the engine itself proposed (a DEX crossbow is +3, not the
  // STR +5 recomputed here) and the engine adds it to the natural die (#2641).
  if (request.engineOwned || !CHARACTER_MODIFIER_TYPES.has(request.type)) {
    return rawFormula(request.formula);
  }

  if (!character) {
    // A symbolic formula is still waiting on the character. A non-zero number is the
    // no-character fallback. Anything else would roll as +0.
    if (!isNumericFormula(request.formula) || explicitNonZeroModifier(request.formula)) {
      return rawFormula(request.formula);
    }
    return unknownFormula();
  }

  try {
    const { rollType, ability, skillName } = identifyRoll(request);
    // A save with no named ability is a flat d20 (a death save). Rolling it as
    // "modifier unknown" leaves the prompt with no roll and no cancel.
    if (rollType === 'save' && !ability) {
      return rawFormula(request.formula);
    }
    const calculation = calculateRollWithBreakdown(character, rollType, ability, skillName);
    return { ...calculation, modifierUnknown: false };
  } catch (error) {
    logger.warn('Error calculating roll with character modifiers:', error);
    // No named ability or skill: the calculator refuses, and on main the dialog
    // rolled the bare formula. "modifier unknown" would hide Roll and manual entry.
    if (isUnnamedRoll(error)) return rawFormula(request.formula);
    return explicitNonZeroModifier(request.formula)
      ? rawFormula(request.formula)
      : unknownFormula();
  }
}

function rawFormula(formula: string): DialogRollFormula {
  return {
    formula,
    breakdown: [formula],
    baseModifier: 0,
    abilityModifier: 0,
    proficiencyBonus: 0,
    totalModifier: 0,
    isProficient: false,
    modifierUnknown: false,
  };
}

function unknownFormula(): DialogRollFormula {
  return {
    formula: MODIFIER_UNKNOWN_LABEL,
    breakdown: [MODIFIER_UNKNOWN_LABEL],
    baseModifier: 0,
    abilityModifier: 0,
    proficiencyBonus: 0,
    totalModifier: 0,
    isProficient: false,
    modifierUnknown: true,
  };
}

function isUnnamedRoll(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message.startsWith('Ability required') || message.startsWith('Skill name required');
}

/** A formula such as 1d20+5. 1d20+0 is not a modifier; it is a bare d20. */
function explicitNonZeroModifier(formula: string): boolean {
  const match = formula.match(/\d+d\d+([+-]\d+)/);
  if (!match) return false;
  return Number.parseInt(match[1], 10) !== 0;
}

function identifyRoll(request: RollRequest): {
  rollType: 'attack' | 'save' | 'check' | 'skill' | 'initiative';
  ability: AbilityName | undefined;
  skillName: string | undefined;
} {
  // Same word-boundary parser the queue uses. A substring match treats "strong"
  // as Strength and then overwrites the modifier the queue already got right.
  if (request.type === 'attack') {
    return {
      rollType: 'attack',
      ability: findDeclaredAbility(request) || 'strength',
      skillName: undefined,
    };
  }
  if (request.type === 'initiative') {
    return { rollType: 'initiative', ability: 'dexterity', skillName: undefined };
  }
  if (request.type === 'save') {
    return { rollType: 'save', ability: findDeclaredAbility(request), skillName: undefined };
  }

  const skillName = findDeclaredSkill(request);
  if (skillName) {
    return { rollType: 'skill', ability: SKILL_ABILITIES[skillName], skillName };
  }
  return { rollType: 'check', ability: findDeclaredAbility(request), skillName: undefined };
}
