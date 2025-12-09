/**
 * D&D 5e Class Equipment Reference
 * Provides default equipment and weapon damage dice for each class
 * Used by AI to generate accurate damage roll requests
 * Extracted from ai-service.ts for modularity
 */

export interface ClassEquipment {
  weapons: string[];
  armor: string;
}

/**
 * Get default equipment for a D&D character class
 * Returns weapons with damage dice and armor with AC
 */
export function getClassEquipment(className: string): ClassEquipment {
  const classLower = className.toLowerCase();

  switch (classLower) {
    case 'fighter':
      return {
        weapons: ['Longsword (1d8)', 'Shortsword (1d6)', 'Handaxe (1d6)', 'Light Crossbow (1d8)'],
        armor: 'Chain mail (AC 16)',
      };

    case 'rogue':
      return {
        weapons: ['Shortsword (1d6)', 'Dagger (1d4)', 'Shortbow (1d6)', 'Rapier (1d8)'],
        armor: 'Leather armor (AC 11)',
      };

    case 'ranger':
      return {
        weapons: ['Longsword (1d8)', 'Shortsword (1d6)', 'Longbow (1d8)', 'Handaxe (1d6)'],
        armor: 'Studded leather (AC 12)',
      };

    case 'barbarian':
      return {
        weapons: ['Greataxe (1d12)', 'Handaxe (1d6)', 'Javelin (1d6)'],
        armor: 'Unarmored (AC 10 + Dex + Con)',
      };

    case 'wizard':
      return {
        weapons: ['Dagger (1d4)', 'Dart (1d4)', 'Light Crossbow (1d8)', 'Quarterstaff (1d6)'],
        armor: 'No armor (AC 10)',
      };

    case 'sorcerer':
      return {
        weapons: ['Dagger (1d4)', 'Dart (1d4)', 'Light Crossbow (1d8)', 'Quarterstaff (1d6)'],
        armor: 'No armor (AC 10)',
      };

    case 'warlock':
      return {
        weapons: ['Dagger (1d4)', 'Light Crossbow (1d8)', 'Scimitar (1d6)'],
        armor: 'Leather armor (AC 11)',
      };

    case 'cleric':
      return {
        weapons: ['Mace (1d6)', 'Warhammer (1d8)', 'Light Crossbow (1d8)', 'Shield'],
        armor: 'Scale mail (AC 14)',
      };

    case 'druid':
      return {
        weapons: ['Scimitar (1d6)', 'Shield', 'Dart (1d4)', 'Javelin (1d6)'],
        armor: 'Leather armor (AC 11)',
      };

    case 'paladin':
      return {
        weapons: ['Longsword (1d8)', 'Javelin (1d6)', 'Shield'],
        armor: 'Chain mail (AC 16)',
      };

    case 'bard':
      return {
        weapons: ['Rapier (1d8)', 'Shortsword (1d6)', 'Dagger (1d4)', 'Hand Crossbow (1d6)'],
        armor: 'Leather armor (AC 11)',
      };

    case 'monk':
      return {
        weapons: ['Shortsword (1d6)', 'Dart (1d4)', 'Unarmed Strike (1d4)'],
        armor: 'Unarmored (AC 10 + Dex + Wis)',
      };

    default:
      return {
        weapons: ['Longsword (1d8)', 'Shortsword (1d6)', 'Dagger (1d4)'],
        armor: 'Leather armor (AC 11)',
      };
  }
}
