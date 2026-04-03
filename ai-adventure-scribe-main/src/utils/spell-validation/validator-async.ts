import type { Character } from '@/types/character';
import type { SpellValidationResult, SpellValidationError } from '@/utils/spell-validation/types';

import { getRacialSpells } from '@/utils/spell-validation/racial-spells';
import { getSpellcastingInfo } from '@/utils/spell-validation/spellcasting-info';

/**
 * Async version of validateSpellSelection that validates against API data
 */
export async function validateSpellSelectionAsync(
  character: Character | null,
  selectedCantrips: string[] = [],
  selectedSpells: string[] = [],
  availableCantripIds: string[] = [],
  availableSpellIds: string[] = [],
): Promise<SpellValidationResult> {
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

      // Validate racial cantrips against available list
      cantrips.forEach((cantripId) => {
        const isRacialCantrip = racialSpells.cantrips.includes(cantripId);
        let isValidBonusCantrip = false;

        if (racialSpells.bonusCantrips > 0 && racialSpells.bonusCantripSource === 'wizard') {
          // Validate against available cantrips if we have the data
          isValidBonusCantrip =
            availableCantripIds.length === 0 || availableCantripIds.includes(cantripId);
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
    return { valid: errors.length === 0, errors, warnings };
  }

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

  // Validate each selected cantrip against available list
  cantrips.forEach((cantripId) => {
    // Check if it's a racial cantrip
    const isRacialCantrip = racialSpells.cantrips.includes(cantripId);

    // Check if it's a bonus cantrip from racial feature
    let isValidBonusCantrip = false;
    if (racialSpells.bonusCantrips > 0 && racialSpells.bonusCantripSource === 'wizard') {
      isValidBonusCantrip =
        availableCantripIds.length === 0 || availableCantripIds.includes(cantripId);
    }

    // Validate availability using API data
    if (
      !isRacialCantrip &&
      !isValidBonusCantrip &&
      availableCantripIds.length > 0 &&
      !availableCantripIds.includes(cantripId)
    ) {
      errors.push({
        type: 'INVALID_SPELL',
        message: `${cantripId} is not available as a cantrip for ${character.class.name}`,
        spellId: cantripId,
      });
    }
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

  // Validate each selected spell against available list
  spells.forEach((spellId) => {
    if (availableSpellIds.length > 0 && !availableSpellIds.includes(spellId)) {
      errors.push({
        type: 'INVALID_SPELL',
        message: `${spellId} is not available as a 1st level spell for ${character.class.name}`,
        spellId: spellId,
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
