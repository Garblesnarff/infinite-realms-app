/**
 * Magic Item Attunement Logic for D&D 5e
 *
 * Handles attunement requirement checks, slot tracking, and item lookup.
 */

import type { Character } from '@/types/character';

type MagicItemRequirements = {
  attunementRequirements?: string;
  requiresAttunement?: boolean;
};

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
