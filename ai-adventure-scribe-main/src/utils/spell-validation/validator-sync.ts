import type { Character } from '@/types/character';
import type { SpellValidationResult, SpellValidationError } from '@/utils/spell-validation/types';

import { getClassSpells } from '@/data/spellOptions';
import { getRacialSpells } from '@/utils/spell-validation/racial-spells';
import { getSpellcastingInfo } from '@/utils/spell-validation/spellcasting-info';




/**
 * Validate spell selection for a character
 */
export function validateSpellSelection(
  character: Character | null,
  selectedCantrips: string[] = [],
  selectedSpells: string[] = [],
): SpellValidationResult {
  // Normalize potentially bad inputs
  const cantrips = Array.isArray(selectedCantrips) ? selectedCantrips : [];
  const spells = Array.isArray(selectedSpells) ? selectedSpells : [];

  const errors: SpellValidationError[] = [];
  const warnings: string[] = [];

  // Handle null or missing character
  if (!character) {
    if (cantrips.length > 0 || spells.length > 0) {
      errors.push({
        type: 'LEVEL_REQUIREMENT',
        message: 'Cannot validate spells without a character',
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  // Early return for non-spellcasters - but check racial spells first
  if (!character.class?.spellcasting) {
    const racialSpells = getRacialSpells(
      character.race?.name || '',
      character.subrace || undefined,
    );
    const hasRacialSpells = racialSpells.cantrips.length > 0 || racialSpells.bonusCantrips > 0;

    if (!hasRacialSpells && (cantrips.length > 0 || spells.length > 0)) {
      errors.push({
        type: 'LEVEL_REQUIREMENT',
        message: `${character.class?.name} is not a spellcasting class at level 1`,
      });
    } else if (hasRacialSpells) {
      // Validate only racial spells for non-spellcasters
      const expectedRacialCantrips = racialSpells.cantrips.length + racialSpells.bonusCantrips;

      if (cantrips.length !== expectedRacialCantrips) {
        errors.push({
          type: 'COUNT_MISMATCH',
          message: `Expected ${expectedRacialCantrips} racial cantrips, but got ${cantrips.length}`,
          expected: expectedRacialCantrips,
          actual: cantrips.length,
        });
      }

      // Validate racial cantrips
      cantrips.forEach((cantripId) => {
        const isRacialCantrip = racialSpells.cantrips.includes(cantripId);
        let isValidBonusCantrip = false;

        if (racialSpells.bonusCantrips > 0 && racialSpells.bonusCantripSource) {
          if (racialSpells.bonusCantripSource === 'wizard') {
            // For validation during character creation, we'll use a simplified approach
            // This will need to be updated to use async API calls in the future
            // For now, we'll assume any cantrip ID is valid if it's from the wizard source
            isValidBonusCantrip = true; // Placeholder - will be replaced with API validation
          }
        }

        if (!isRacialCantrip && !isValidBonusCantrip) {
          errors.push({
            type: 'INVALID_SPELL',
            message: `${cantripId} is not a valid racial cantrip for ${character.race?.name}`,
            spellId: cantripId,
          });
        }
      });

      if (spells.length > 0) {
        errors.push({
          type: 'LEVEL_REQUIREMENT',
          message: `${character.class?.name} cannot cast spells at level ${character.level || 1}`,
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // Now check if this is a spellcaster at this level
  const spellcastingInfo = getSpellcastingInfo(character.class, character.level || 1);
  if (
    !spellcastingInfo ||
    (spellcastingInfo.cantripsKnown === 0 && spellcastingInfo.spellsKnown === 0)
  ) {
    // This should not happen since we handled non-spellcasters above
    return { valid: errors.length === 0, errors, warnings };
  }

  // Local availability from static spell data for deterministic validation
  const classLists = getClassSpells(character.class.name);
  const availableCantripIds: string[] = classLists.cantrips.map((s) => s.id);
  const availableSpellIds: string[] = classLists.spells.map((s) => s.id);

  // Get racial bonus spells
  const racialSpells = getRacialSpells(character.race?.name || '', character.subrace || undefined);

  // Validate cantrip count
  const expectedCantrips = spellcastingInfo.cantripsKnown;
  const racialCantripsCount = racialSpells.cantrips.length + racialSpells.bonusCantrips;
  const totalExpectedCantrips = expectedCantrips + racialCantripsCount;

  if (cantrips.length !== totalExpectedCantrips) {
    errors.push({
      type: 'COUNT_MISMATCH',
      message: `Expected ${totalExpectedCantrips} cantrips (${expectedCantrips} class + ${racialCantripsCount} racial), but got ${cantrips.length}`,
      expected: totalExpectedCantrips,
      actual: cantrips.length,
    });
  }

  // Validate each selected cantrip against class list and racial allowances
  let bonusRemaining = racialSpells.bonusCantrips || 0;
  const bonusSource = racialSpells.bonusCantripSource;
  const bonusAllowedIds =
    bonusSource === 'wizard' ? getClassSpells('Wizard').cantrips.map((s) => s.id) : [];

  cantrips.forEach((cantripId) => {
    const isRacialFixed = racialSpells.cantrips.includes(cantripId);
    const isClassCantrip = availableCantripIds.includes(cantripId);
    if (isRacialFixed || isClassCantrip) return;

    if (bonusRemaining > 0 && bonusAllowedIds.includes(cantripId)) {
      bonusRemaining -= 1;
      return;
    }

    errors.push({
      type: 'INVALID_SPELL',
      message: `${cantripId} is not available as a cantrip for ${character.class?.name}`,
      spellId: cantripId,
    });
  });

  // Validate spell count
  if (spellcastingInfo.spellsKnown !== undefined && spellcastingInfo.spellsKnown > 0) {
    const expectedSpells = spellcastingInfo.spellsKnown;
    if (spells.length !== expectedSpells) {
      errors.push({
        type: 'COUNT_MISMATCH',
        message: `Expected ${expectedSpells} spells known, but got ${spells.length}`,
        expected: expectedSpells,
        actual: spells.length,
      });
    }
  }

  // Validate each selected spell against class list
  spells.forEach((spellId) => {
    if (!availableSpellIds.includes(spellId)) {
      errors.push({
        type: 'INVALID_SPELL',
        message: `${spellId} is not available as a 1st level spell for ${character.class.name}`,
        spellId,
      });
    }
  });

  // Add helpful warnings
  if (spellcastingInfo.hasSpellbook) {
    warnings.push(
      'As a Wizard, these spells will be recorded in your spellbook. You can prepare spells equal to your Intelligence modifier + 1 (minimum 1) each day.',
    );
  }

  if (spellcastingInfo.isPactMagic) {
    warnings.push('As a Warlock, you use Pact Magic. Your spell slots recharge on a short rest.');
  }

  if (spellcastingInfo.ritualCasting) {
    warnings.push(
      'Your class can cast spells as rituals if they have the ritual tag, without expending a spell slot.',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate spell selection during character creation
 */
export function validateCharacterSpellSelection(character: Character): SpellValidationResult {
  return validateSpellSelection(character, character.cantrips || [], character.knownSpells || []);
}
