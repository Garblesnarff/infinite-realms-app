import type { MulticlassCalculation } from '@/services/spellApi';
import type { CharacterClass, Character } from '@/types/character';
import type { SpellcastingInfo } from '@/utils/spell-validation/types';



import { getClassSpells } from '@/data/spellOptions';
import logger from '@/lib/logger';
import { spellApi } from '@/services/spellApi';
import { getSpellcastingInfo } from '@/utils/spell-validation/spellcasting-info';


/**
 * Get maximum spell counts for a character class
 */
export function getMaxSpellCounts(
  characterClass: CharacterClass,
  level: number = 1,
): { cantrips: number; spells: number } {
  const spellcastingInfo = getSpellcastingInfo(characterClass, level);

  if (!spellcastingInfo) {
    return { cantrips: 0, spells: 0 };
  }

  return {
    cantrips: spellcastingInfo.cantripsKnown,
    spells: spellcastingInfo.spellsKnown || spellcastingInfo.spellsPrepared || 0,
  };
}

/**
 * Checks if a spell is valid for a character's class by calling a placeholder API endpoint.
 * This function is intended to be used in asynchronous validation flows.
 * @param spellId The ID of the spell to validate.
 * @param characterClass The name of the character's class.
 * @returns true if the spell is valid, false otherwise.
 */
export function isSpellValidForClass(
  spellId: string,
  characterClass: string | CharacterClass,
  isCantrip?: boolean,
): boolean {
  try {
    const className = typeof characterClass === 'string' ? characterClass : characterClass?.name;
    if (!className || !spellId) return false;

    const { cantrips, spells } = getClassSpells(className);
    if (isCantrip === true) {
      return cantrips.some((s) => s.id === spellId);
    }
    if (isCantrip === false) {
      return spells.some((s) => s.id === spellId);
    }
    // If not specified, check both
    return cantrips.some((s) => s.id === spellId) || spells.some((s) => s.id === spellId);
  } catch (error) {
    logger.error('[SpellValidation] Local class spell validation failed:', error);
    return false;
  }
}

/**
 * Async variant retained for future backend integration
 */
export const isSpellValidForClassAsync = async (
  spellId: string,
  characterClass: string,
): Promise<boolean> => {
  try {
    const response = await fetch(`/api/spells/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spellId, characterClass }),
    });

    if (!response.ok) {
      logger.error(
        `Spell validation API call failed for ${spellId}/${characterClass}:`,
        response.statusText,
      );
      return false;
    }
    const result = await response.json();
    return result?.isValid || false;
  } catch (error) {
    logger.error(`Error during spell validation API call for ${spellId}/${characterClass}:`, error);
    return false;
  }
};

/**
 * Calculate multiclass caster level for spell slot determination
 */
export async function calculateMulticlassCasterLevel(
  classLevels: { className: string; level: number }[],
): Promise<MulticlassCalculation> {
  try {
    return await spellApi.calculateMulticlassCasterLevel(classLevels);
  } catch (error) {
    logger.error('Failed to calculate multiclass caster level:', error);
    return {
      totalCasterLevel: 0,
      spellSlots: null,
      pactMagicSlots: null,
    };
  }
}

/**
 * Get enhanced spellcasting information that supports multiclassing
 */
export async function getEnhancedSpellcastingInfo(
  character: Character,
): Promise<(SpellcastingInfo & { multiclassInfo?: MulticlassCalculation }) | null> {
  const baseInfo = getSpellcastingInfo(character.class, character.level || 1);

  if (!baseInfo) {
    return baseInfo;
  }

  // Check if character has multiple classes
  if (character.classLevels && character.classLevels.length > 1) {
    const multiclassInfo = await calculateMulticlassCasterLevel(character.classLevels);
    return {
      ...baseInfo,
      multiclassInfo,
    };
  }

  return baseInfo;
}

/**
 * Get spell validation rules summary for UI display
 */
export function getSpellValidationRules(characterClass: CharacterClass): string[] {
  const spellcastingInfo = getSpellcastingInfo(characterClass);

  if (!spellcastingInfo) {
    return [`${characterClass.name} is not a spellcasting class at 1st level.`];
  }

  const rules: string[] = [];

  if (spellcastingInfo.cantripsKnown > 0) {
    rules.push(
      `Must select exactly ${spellcastingInfo.cantripsKnown} cantrip${spellcastingInfo.cantripsKnown > 1 ? 's' : ''}.`,
    );
  }

  if (spellcastingInfo.spellsKnown) {
    rules.push(
      `Must select exactly ${spellcastingInfo.spellsKnown} spell${spellcastingInfo.spellsKnown > 1 ? 's' : ''} known.`,
    );
  }

  if (spellcastingInfo.spellsPrepared) {
    rules.push(
      `Can prepare ${spellcastingInfo.spellsPrepared} spell${spellcastingInfo.spellsPrepared > 1 ? 's' : ''} (minimum 1).`,
    );
  }

  if (spellcastingInfo.hasSpellbook) {
    rules.push('Uses a spellbook to record spells. Can prepare spells daily.');
  }

  if (spellcastingInfo.isPactMagic) {
    rules.push('Uses Pact Magic. Spell slots recharge on short rest.');
  }

  if (spellcastingInfo.ritualCasting) {
    rules.push('Can cast ritual spells without expending spell slots.');
  }

  rules.push(
    `Spellcasting ability: ${spellcastingInfo.spellcastingAbility.charAt(0).toUpperCase() + spellcastingInfo.spellcastingAbility.slice(1)}.`,
  );

  return rules;
}
