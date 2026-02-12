/* eslint-disable max-lines */
/**
 * Magic Item Effects System for D&D 5e
 *
 * Handles the application and management of magical item effects on characters
 */

import type { Character } from '@/types/character';
import type { CombatParticipant } from '@/types/combat';

type MagicItemRequirements = {
  attunementRequirements?: string;
  requiresAttunement?: boolean;
};

type SpellEffect = {
  spellName: string;
  spellLevel?: number;
  charges?: number;
  maxCharges?: number;
  rechargeRate?: 'daily' | 'dawn' | 'dusk' | 'weekly' | 'monthly';
};

/**
 * Calculate the total magical bonus to attack rolls from equipped magic weapons
 */
export function getMagicAttackBonus(character: Character): number {
  if (!character.inventory) return 0;

  return character.inventory
    .filter((item) => item.equipped && item.isMagic)
    .reduce((total, item) => {
      if (item.magicEffects?.attackBonus !== undefined) {
        return total + item.magicEffects.attackBonus;
      }
      // Fallback to magicBonus for appropriate item types
      if (['weapon', 'rod', 'staff', 'wand'].includes(item.magicItemType || '')) {
        return total + (item.magicBonus || 0);
      }
      return total;
    }, 0);
}

/**
 * Calculate the total magical bonus to damage rolls from equipped magic weapons
 */
export function getMagicDamageBonus(character: Character): number {
  if (!character.inventory) return 0;

  return character.inventory
    .filter((item) => item.equipped && item.isMagic)
    .reduce((total, item) => {
      if (item.magicEffects?.damageBonus !== undefined) {
        return total + item.magicEffects.damageBonus;
      }
      // Fallback to magicBonus for weapons
      if (item.magicItemType === 'weapon') {
        return total + (item.magicBonus || 0);
      }
      return total;
    }, 0);
}

/**
 * Calculate the total magical bonus to AC from equipped magic armor/items
 */
export function getMagicACBonus(character: Character): number {
  if (!character.inventory) return 0;

  return character.inventory
    .filter((item) => item.equipped && item.isMagic)
    .reduce((total, item) => {
      if (item.magicEffects?.acBonus !== undefined) {
        return total + item.magicEffects.acBonus;
      }
      // Fallback to magicBonus for armor/shields
      if (['armor', 'shield'].includes(item.magicItemType || '')) {
        return total + (item.magicBonus || 0);
      }
      return total;
    }, 0);
}

/**
 * Calculate the total magical bonus to saving throws from equipped magic items
 */
export function getMagicSaveBonus(character: Character): number {
  if (!character.inventory) return 0;

  return character.inventory
    .filter((item) => item.equipped && item.isMagic)
    .reduce((total, item) => {
      if (item.magicEffects?.saveBonus !== undefined) {
        return total + item.magicEffects.saveBonus;
      }
      // Some items like Ring of Protection might just have magicBonus
      // but usually they should have specific effects.
      // We'll only fallback if it's not a weapon/armor
      if (
        !['weapon', 'armor', 'shield'].includes(item.magicItemType || '') &&
        item.magicBonus !== undefined
      ) {
        return total + item.magicBonus;
      }
      return total;
    }, 0);
}

/**
 * Get ability score bonuses from magic items
 */
export function getMagicAbilityBonuses(
  character: Character,
): Partial<
  Record<'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma', number>
> {
  if (!character.inventory) return {};

  const bonuses: Partial<
    Record<
      'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma',
      number
    >
  > = {};

  character.inventory
    .filter((item) => item.equipped && item.isMagic && item.magicEffects?.abilityScoreBonus)
    .forEach((item) => {
      const abilityBonus = item.magicEffects!.abilityScoreBonus!;
      bonuses[abilityBonus.ability] = (bonuses[abilityBonus.ability] || 0) + abilityBonus.bonus;
    });

  return bonuses;
}

/**
 * Get special properties from magic items
 */
export function getMagicSpecialProperties(character: Character): string[] {
  if (!character.inventory) return [];

  const properties: string[] = [];

  character.inventory
    .filter((item) => item.equipped && item.isMagic && item.magicEffects?.specialProperties)
    .forEach((item) => {
      properties.push(...(item.magicEffects!.specialProperties || []));
    });

  return properties;
}

/**
 * Get spell effects from magic items
 */
export function getMagicSpellEffects(character: Character): SpellEffect[] {
  if (!character.inventory) return [];

  const spellEffects: SpellEffect[] = [];

  character.inventory
    .filter((item) => item.equipped && item.isMagic && item.magicEffects?.spellEffects)
    .forEach((item) => {
      spellEffects.push(...(item.magicEffects!.spellEffects || []));
    });

  return spellEffects;
}

/**
 * Check if character has a specific magic item equipped
 */
export function hasEquippedMagicItem(character: Character, itemName: string): boolean {
  if (!character.inventory) return false;

  return character.inventory.some(
    (item) =>
      item.equipped && item.isMagic && item.itemId.toLowerCase().includes(itemName.toLowerCase()),
  );
}

/**
 * Check if character meets attunement requirements for a magic item
 */
export function canAttuneToItem(character: Character, item: MagicItemRequirements): boolean {
  // If no attunement requirements, character can attune
  if (!item.attunementRequirements) return true;

  // Check class requirements
  if (item.attunementRequirements.includes('class:')) {
    if (!character.class) return false;
    const requiredClasses = item.attunementRequirements
      .split('class:')[1]
      .split(',')[0]
      .split('|')
      .map((cls: string) => cls.trim().toLowerCase());

    if (!requiredClasses.includes(character.class.name.toLowerCase())) {
      return false;
    }
  }

  // Check race requirements
  if (item.attunementRequirements.includes('race:')) {
    if (!character.race) return false;
    const requiredRaces = item.attunementRequirements
      .split('race:')[1]
      .split(',')[0]
      .split('|')
      .map((race: string) => race.trim().toLowerCase());

    if (!requiredRaces.includes(character.race.name.toLowerCase())) {
      return false;
    }
  }

  // Check alignment requirements
  if (item.attunementRequirements.includes('alignment:')) {
    if (!character.alignment) return false;
    const requiredAlignments = item.attunementRequirements
      .split('alignment:')[1]
      .split(',')[0]
      .split('|')
      .map((align: string) => align.trim().toLowerCase());

    if (!requiredAlignments.includes(character.alignment.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Apply magic item effects to a combat participant
 */
export function applyMagicItemEffectsToParticipant(
  participant: CombatParticipant,
  character: Character,
): CombatParticipant {
  // Apply attack bonuses
  const attackBonus = getMagicAttackBonus(character);
  if (attackBonus !== 0) {
    // This would be applied during attack calculations
  }

  // Apply damage bonuses
  const damageBonus = getMagicDamageBonus(character);
  if (damageBonus !== 0) {
    // This would be applied during damage calculations
  }

  // Apply AC bonuses
  const acBonus = getMagicACBonus(character);
  if (acBonus !== 0) {
    participant.armorClass += acBonus;
  }

  // Apply save bonuses
  const saveBonus = getMagicSaveBonus(character);
  if (saveBonus !== 0) {
    // This would be applied during saving throw calculations
  }

  // Apply ability score bonuses
  const _abilityBonuses = getMagicAbilityBonuses(character);
  // These would be applied to relevant calculations

  // Apply special properties
  const _specialProperties = getMagicSpecialProperties(character);
  // These would be applied as needed

  return participant;
}

/**
 * Get the number of attuned items for a character
 */
export function getAttunedItemCount(character: Character): number {
  if (!character.inventory) return 0;

  return character.inventory.filter((item) => item.isAttuned).length;
}

/**
 * Check if character can attune to another item (3 item limit)
 */
export function canAttuneToMoreItems(character: Character): boolean {
  return getAttunedItemCount(character) < 3;
}

/**
 * Get attuned items for a character
 */
export function getAttunedItems(character: Character): NonNullable<Character['inventory']> {
  if (!character.inventory) return [];

  return character.inventory.filter((item) => item.isAttuned);
}

/**
 * Validate attunement requirements for a magic item
 */
export function validateAttunementRequirements(
  character: Character,
  item: MagicItemRequirements,
): { canAttune: boolean; reason: string } {
  // Check if item requires attunement
  if (!item.requiresAttunement) {
    return { canAttune: true, reason: 'Item does not require attunement' };
  }

  // Check attunement slot availability
  if (!canAttuneToMoreItems(character)) {
    return { canAttune: false, reason: 'No available attunement slots (maximum of 3)' };
  }

  // Check class requirements
  if (item.attunementRequirements && item.attunementRequirements.includes('class:')) {
    if (!character.class) {
      return { canAttune: false, reason: 'Requires a class for attunement' };
    }
    const requiredClasses = item.attunementRequirements
      .split('class:')[1]
      .split(',')[0]
      .split('|')
      .map((cls: string) => cls.trim().toLowerCase());

    if (!requiredClasses.includes(character.class.name.toLowerCase())) {
      return {
        canAttune: false,
        reason: `Requires class: ${requiredClasses.join(' or ')}`,
      };
    }
  }

  // Check race requirements
  if (item.attunementRequirements && item.attunementRequirements.includes('race:')) {
    if (!character.race) {
      return { canAttune: false, reason: 'Requires a race for attunement' };
    }
    const requiredRaces = item.attunementRequirements
      .split('race:')[1]
      .split(',')[0]
      .split('|')
      .map((race: string) => race.trim().toLowerCase());

    if (!requiredRaces.includes(character.race.name.toLowerCase())) {
      return {
        canAttune: false,
        reason: `Requires race: ${requiredRaces.join(' or ')}`,
      };
    }
  }

  // Check alignment requirements
  if (item.attunementRequirements && item.attunementRequirements.includes('alignment:')) {
    if (!character.alignment) {
      return { canAttune: false, reason: 'Requires an alignment for attunement' };
    }
    const requiredAlignments = item.attunementRequirements
      .split('alignment:')[1]
      .split(',')[0]
      .split('|')
      .map((align: string) => align.trim().toLowerCase());

    if (!requiredAlignments.includes(character.alignment.toLowerCase())) {
      return {
        canAttune: false,
        reason: `Requires alignment: ${requiredAlignments.join(' or ')}`,
      };
    }
  }

  return { canAttune: true, reason: 'Meets all requirements' };
}

/**
 * Get magic item by ID
 */
export function getMagicItemById(
  character: Character,
  itemId: string,
): NonNullable<Character['inventory']>[number] | null {
  if (!character.inventory) return null;

  return character.inventory.find((item) => item.itemId === itemId) || null;
}

/**
 * Check if a magic item is currently active (equipped and attuned if required)
 */
export function isMagicItemActive(character: Character, itemId: string): boolean {
  const item = getMagicItemById(character, itemId);
  if (!item) return false;

  // Item must be equipped
  if (!item.equipped) return false;

  // If item requires attunement, it must be attuned
  if (item.requiresAttunement && !item.isAttuned) return false;

  return true;
}

/**
 * Parse attunement requirements from a string
 */
export function parseAttunementRequirements(requirements: string): string[] {
  if (!requirements) return [];

  // Split by common separators and clean up
  return requirements
    .split(/[,&|]/)
    .map((req) => req.trim())
    .filter((req) => req.length > 0);
}
