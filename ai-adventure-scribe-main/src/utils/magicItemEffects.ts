/**
 * Magic Item Effects System for D&D 5e
 *
 * Handles the application and management of magical item effects on characters
 */

import type { Character } from '@/types/character';
import type { CombatParticipant } from '@/types/combat';

// Re-export for backward compatibility
export {
  canAttuneToItem,
  getAttunedItemCount,
  canAttuneToMoreItems,
  getAttunedItems,
  validateAttunementRequirements,
  getMagicItemById,
  isMagicItemActive,
  parseAttunementRequirements,
} from './magic-item-attunement';

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
