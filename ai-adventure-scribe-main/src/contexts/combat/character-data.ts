/**
 * Character Data Builder
 * Builds a CharacterData object from a Character for use in combat participant creation.
 * Extracted from CombatContext.tsx to eliminate duplication.
 */

import type { CharacterData } from './participant-factory';
import type { Character } from '@/types/character';

/**
 * Build a CharacterData object from a Character, or return null if no character provided.
 * Used to enrich player participants with character state when entering combat.
 */
export function buildCharacterData(character: Character | null | undefined): CharacterData | null {
  if (!character) return null;

  return {
    id: character.id,
    spellSlots: character.spellSlots,
    preparedSpells: character.preparedSpells,
    activeConcentration: character.activeConcentration,
    damageResistances: character.damageResistances,
    damageImmunities: character.damageImmunities,
    damageVulnerabilities: character.damageVulnerabilities,
    fightingStyles: character.fightingStyles,
    visionTypes: character.visionTypes,
    obscurement: character.obscurement,
    isHidden: character.isHidden,
    stealthCheckBonus: character.stealthCheckBonus,
  };
}
