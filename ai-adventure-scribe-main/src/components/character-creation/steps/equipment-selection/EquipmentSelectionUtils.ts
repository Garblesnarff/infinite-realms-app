import type { Equipment } from '@/data/equipmentOptions';

import { calculateArmorClass, EQUIPMENT_LOOKUP } from '@/data/equipmentOptions';

/**
 * ⚡ Bolt: Class-based starting equipment packages hoisted to prevent re-allocation.
 */
export const STARTING_PACKAGES: Record<string, string[]> = {
  fighter: [
    'chain-mail',
    'shield',
    'longsword',
    'handaxe',
    'handaxe',
    'light-crossbow',
    'explorers-pack',
  ],
  wizard: ['dagger', 'quarterstaff', 'component-pouch', 'scholars-pack', 'spellbook'],
  rogue: ['leather-armor', 'shortsword', 'shortsword', 'thieves-tools', 'shortbow', 'burglars-pack'],
  cleric: ['chain-shirt', 'shield', 'mace', 'light-crossbow', 'priests-pack', 'holy-symbol'],
  barbarian: ['leather-armor', 'shield', 'handaxe', 'handaxe', 'javelin', 'javelin', 'explorers-pack'],
  bard: ['leather-armor', 'dagger', 'rapier', 'lute', 'entertainers-pack'],
  druid: ['leather-armor', 'shield', 'scimitar', 'shield', 'explorers-pack', 'druidcraft-focus'],
  monk: [
    'shortsword',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'explorers-pack',
  ],
  paladin: [
    'chain-mail',
    'shield',
    'longsword',
    'javelin',
    'javelin',
    'javelin',
    'javelin',
    'javelin',
    'priests-pack',
    'holy-symbol',
  ],
  ranger: ['leather-armor', 'shortsword', 'shortsword', 'longbow', 'explorers-pack'],
  sorcerer: ['dagger', 'dagger', 'component-pouch', 'light-crossbow', 'dungeoneer-pack'],
  warlock: ['leather-armor', 'dagger', 'simple-weapon', 'light-crossbow', 'scholars-pack'],
};

/**
 * ⚡ Bolt: Pure helper function to get starting equipment package.
 */
export const getStartingEquipmentPackage = (classId: string): Equipment[] => {
  const equipmentIds = STARTING_PACKAGES[classId] || [];
  return equipmentIds.map((id) => {
    const item = EQUIPMENT_LOOKUP.get(id);
    return (
      item || {
        id,
        name: id.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        category: 'gear' as const,
        cost: { amount: 0, currency: 'gp' as const },
        description: `Starting ${classId} equipment`,
      }
    );
  });
};

/**
 * ⚡ Bolt: Pure helper to calculate estimated AC from equipment.
 */
export const calculateEstimatedACFromEquipment = (
  startingEquipment: Equipment[],
  character: {
    abilityScores?: {
      dexterity?: { modifier: number };
      constitution?: { modifier: number };
      wisdom?: { modifier: number };
    };
  } | null,
  characterClass: { name: string },
): number => {
  const armor = startingEquipment.find((eq) => eq.category === 'armor');
  const shield = startingEquipment.find((eq) => eq.category === 'shield');
  const dexMod = character?.abilityScores?.dexterity?.modifier || 0;
  const conMod = character?.abilityScores?.constitution?.modifier || 0;
  const wisMod = character?.abilityScores?.wisdom?.modifier || 0;

  return calculateArmorClass(
    armor || null,
    shield || null,
    dexMod,
    0, // otherBonuses
    characterClass.name,
    conMod,
    wisMod,
  );
};
