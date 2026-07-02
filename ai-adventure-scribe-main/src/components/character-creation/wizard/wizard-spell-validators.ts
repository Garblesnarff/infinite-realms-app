/**
 * Character Creation Wizard Spellcasting Step Validators
 *
 * Split out of wizard-validators.ts: validators specific to spell/cantrip
 * selection and class-specific spellcasting mechanics (prepared spells,
 * metamagic, pact magic).
 */

import { type ValidationResult } from './wizard-validators';

import type { Character } from '@/types/character';

import logger from '@/lib/logger';
import { getSpellcastingInfo, getRacialSpells } from '@/utils/spell-validation';

const VALID: ValidationResult = { isValid: true, message: '' };

function invalid(message: string): ValidationResult {
  return { isValid: false, message };
}

export function validateSpells(character: Character): ValidationResult {
  if (!character.class?.spellcasting) {
    return VALID;
  }

  const spellcastingInfo = getSpellcastingInfo(character.class, character.level || 1);
  if (!spellcastingInfo) {
    logger.warn('No spellcasting info found for class');
    return VALID;
  }

  const racialSpells = getRacialSpells(character.race?.name || '', character.subrace);

  if (spellcastingInfo.cantripsKnown > 0) {
    const expectedCantrips =
      spellcastingInfo.cantripsKnown + racialSpells.cantrips.length + racialSpells.bonusCantrips;
    const cantripCount = character.cantrips?.length || 0;
    if (cantripCount < expectedCantrips) {
      logger.warn('Not all cantrips selected, but allowing continuation');
    }
  }

  if (spellcastingInfo.spellsKnown && spellcastingInfo.spellsKnown > 0) {
    const spellCount = character.knownSpells?.length || 0;
    if (spellCount < spellcastingInfo.spellsKnown) {
      logger.warn('Not all spells selected, but allowing continuation');
    }
  }

  return VALID;
}

export function validateAdvancedSpellcasting(character: Character): ValidationResult {
  const spellcasting = character.class?.spellcasting;
  if (!spellcasting) return VALID;

  const classId = character.class?.id?.toLowerCase() || '';
  const level = character.level || 1;

  // Spell preparation (Cleric, Druid, Paladin, Wizard)
  if (['cleric', 'druid', 'paladin', 'wizard'].includes(classId)) {
    const maxPreparedSpells = Math.max(
      1,
      level + (character.abilityScores?.[spellcasting.ability]?.modifier || 0),
    );
    const preparedCount = character.preparedSpells?.length || 0;
    if (preparedCount < maxPreparedSpells) {
      return invalid(
        `Please prepare ${maxPreparedSpells} spells for your ${character.class?.name}`,
      );
    }
  }

  // Metamagic (Sorcerer level 3+)
  if (classId === 'sorcerer' && level >= 3) {
    const maxMetamagicOptions = level < 10 ? 2 : level < 17 ? 3 : 4;
    const metamagicCount = character.metamagicOptions?.length || 0;
    if (metamagicCount < maxMetamagicOptions) {
      return invalid(
        `Please select ${maxMetamagicOptions} metamagic option${maxMetamagicOptions > 1 ? 's' : ''} for your ${character.class?.name}`,
      );
    }
  }

  // Pact Magic (Warlock)
  if (classId === 'warlock') {
    const pactProgression =
      level === 1
        ? { spellsKnown: 2 }
        : level === 2
          ? { spellsKnown: 3 }
          : level === 3
            ? { spellsKnown: 4 }
            : { spellsKnown: Math.min(15, 2 + level) };
    const pactSpellCount = character.pactMagicSpells?.length || 0;
    if (pactSpellCount < pactProgression.spellsKnown) {
      return invalid(
        `Please select ${pactProgression.spellsKnown} pact magic spell${pactProgression.spellsKnown > 1 ? 's' : ''} for your ${character.class?.name}`,
      );
    }
  }

  return VALID;
}
