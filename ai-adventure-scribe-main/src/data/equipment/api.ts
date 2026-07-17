import { armor } from './armor';
import { allEquipment, resolveEquipmentById, resolveEquipmentByName } from './resolver';
import { weapons } from './weapons';

export { normalizeEquipmentLookupKey } from './resolver';

import type { Equipment } from './types';

import magicItemData from '@/data/srd/magic-items.json';
import startingEquipmentData from '@/data/srd/starting-equipment.json';
import logger from '@/lib/logger';

export const magicItems = magicItemData as Equipment[];

export function calculateArmorClass(
  equippedArmor: Equipment | null,
  equippedShield: Equipment | null,
  dexModifier: number,
  otherBonuses: number = 0,
  characterClass?: string,
  conModifier: number = 0,
  wisModifier: number = 0,
): number {
  const hasUnarmoredDefense =
    characterClass &&
    (characterClass.toLowerCase() === 'barbarian' || characterClass.toLowerCase() === 'monk');
  const isWearingArmor = equippedArmor !== null;
  if (hasUnarmoredDefense && !isWearingArmor) {
    let ac = 10 + dexModifier;
    switch (characterClass!.toLowerCase()) {
      case 'barbarian':
        ac += conModifier;
        break;
      case 'monk':
        ac += wisModifier;
        break;
    }
    if (equippedShield && equippedShield.armorClass) ac += equippedShield.armorClass.base;
    return ac + otherBonuses;
  }
  let ac = 10 + dexModifier;
  if (equippedArmor && equippedArmor.armorClass) {
    const armorAC = equippedArmor.armorClass;
    ac = armorAC.base;
    if (armorAC.dexModifier) {
      const maxDex = armorAC.maxDexModifier !== undefined ? armorAC.maxDexModifier : Infinity;
      ac += Math.min(dexModifier, maxDex);
    }
  }
  if (equippedShield && equippedShield.armorClass) ac += equippedShield.armorClass.base;
  return ac + otherBonuses;
}

export function getEquipmentByCategory(category: Equipment['category']): Equipment[] {
  return allEquipment.filter((item) => item.category === category);
}

export function getWeaponsByType(weaponType: 'simple' | 'martial'): Equipment[] {
  return weapons.filter((weapon) => weapon.weaponType === weaponType);
}

export function getArmorByType(armorType: 'light' | 'medium' | 'heavy'): Equipment[] {
  return armor.filter((a) => a.armorType === armorType);
}

export function convertCurrency(
  amount: number,
  fromCurrency: Equipment['cost']['currency'],
  toCurrency: Equipment['cost']['currency'],
): number {
  const rates: Record<Equipment['cost']['currency'], number> = {
    cp: 1,
    sp: 10,
    ep: 50,
    gp: 100,
    pp: 1000,
  };
  const valueInCopper = amount * rates[fromCurrency];
  return valueInCopper / rates[toCurrency];
}

export function formatCurrency(cost: Equipment['cost']): string {
  const { amount, currency } = cost;
  return `${amount} ${currency}`;
}

export function getStartingEquipment(className: string): Equipment[] {
  const classId = className.toLowerCase();
  const packages: Record<string, string[]> = {
    fighter: ['chain-mail', 'shield', 'longsword', 'handaxe', 'handaxe', 'light-crossbow'],
    wizard: ['dagger', 'quarterstaff'],
    rogue: ['leather-armor', 'dagger', 'dagger', 'thieves-tools', 'shortbow'],
    cleric: ['chain-shirt', 'shield', 'mace', 'light-crossbow'],
    barbarian: ['leather-armor', 'shield', 'handaxe', 'handaxe'],
    bard: ['leather-armor', 'dagger', 'rapier'],
    druid: ['leather-armor', 'shield', 'scimitar'],
    monk: ['dagger'],
    paladin: ['chain-mail', 'shield', 'longsword'],
    ranger: ['leather-armor', 'dagger', 'dagger', 'longbow'],
    sorcerer: ['dagger', 'dagger', 'light-crossbow'],
    warlock: ['leather-armor', 'dagger', 'light-crossbow'],
  };
  const equipmentIds = packages[classId] || [];

  // ⚡ Bolt: Using pre-calculated Map to avoid O(N) allocation on every call.
  return equipmentIds.map(
    (id) =>
      resolveEquipmentById(id) || {
        id,
        name: id.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        category: 'gear' as const,
        cost: { amount: 0, currency: 'gp' as const },
        description: `Starting ${className} equipment`,
      },
  );
}

export interface StartingEquipmentAlternative {
  label: string;
  items: Array<{ equipment: Equipment; quantity: number }>;
}

export interface StartingEquipmentChoice {
  description: string;
  alternatives: StartingEquipmentAlternative[];
}

type SrdOption = {
  option_type: 'counted_reference' | 'choice' | 'multiple';
  count?: number;
  of?: { index: string; name: string };
  items?: SrdOption[];
  choice?: {
    desc: string;
    from: { equipment_category?: { index: string }; options?: SrdOption[] };
  };
};

type SrdStartingClass = {
  id: string;
  fixed: Array<{ id: string; name: string; quantity: number }>;
  choices: Array<{ desc: string; from: { options: SrdOption[] } }>;
};

const startingClasses = startingEquipmentData as SrdStartingClass[];

function equipmentOrPlaceholder(id: string, name: string): Equipment {
  const equipment = resolveEquipmentById(id);
  if (equipment) return equipment;

  logger.error('Unknown starting equipment id from SRD data', { id, name });
  return {
    id,
    name,
    category: 'gear',
    cost: { amount: 0, currency: 'gp' },
    description: 'SRD starting equipment',
  };
}

/**
 * Resolve a template's human-readable equipment name to SRD data.
 * Unknown names are campaign content and are handled by starter seeding as
 * custom inventory items rather than being logged as SRD errors.
 */
export function getEquipmentByName(name: string): Equipment | undefined {
  return resolveEquipmentByName(name);
}

function expandOption(option: SrdOption): StartingEquipmentAlternative[] {
  if (option.option_type === 'counted_reference' && option.of) {
    return [
      {
        label: `${option.count ?? 1}× ${option.of.name}`,
        items: [
          {
            equipment: equipmentOrPlaceholder(option.of.index, option.of.name),
            quantity: option.count ?? 1,
          },
        ],
      },
    ];
  }
  if (option.option_type === 'multiple') {
    const expanded = (option.items ?? []).flatMap(expandOption);
    return [
      {
        label: expanded.map((item) => item.label).join(' + '),
        items: expanded.flatMap((item) => item.items),
      },
    ];
  }
  const nested = option.choice?.from;
  if (nested?.options) return nested.options.flatMap(expandOption);
  const category = nested?.equipment_category?.index ?? '';
  const candidates = category.includes('martial')
    ? weapons.filter((item) => item.weaponType === 'martial')
    : category.includes('simple')
      ? weapons.filter((item) => item.weaponType === 'simple')
      : category.includes('weapon')
        ? weapons
        : allEquipment;
  return candidates.map((equipment) => ({
    label: equipment.name,
    items: [{ equipment, quantity: 1 }],
  }));
}

export function getStartingEquipmentChoices(className: string): {
  fixed: Array<{ equipment: Equipment; quantity: number }>;
  choices: StartingEquipmentChoice[];
} {
  const entry = startingClasses.find((item) => item.id === className.toLowerCase());
  if (!entry) return { fixed: [], choices: [] };
  return {
    fixed: entry.fixed.map((item) => ({
      equipment: equipmentOrPlaceholder(item.id, item.name),
      quantity: item.quantity,
    })),
    choices: entry.choices.map((choice) => ({
      description: choice.desc,
      alternatives: choice.from.options.flatMap(expandOption),
    })),
  };
}
