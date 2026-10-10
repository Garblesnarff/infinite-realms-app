import { armor } from './armor';
import { adventuringGear } from './gear';
import { shields } from './shields';
import { weapons } from './weapons';

import type { Equipment } from './types';

import magicItemData from '@/data/srd/magic-items.json';
import startingEquipmentData from '@/data/srd/starting-equipment.json';

type StartingEquipmentReference = { index: string; name: string };

const magicItems = magicItemData as Equipment[];
const localEquipment: Equipment[] = [
  ...weapons,
  ...armor,
  ...shields,
  ...adventuringGear,
  ...magicItems,
];

/**
 * The app's detailed equipment files intentionally contain only the equipment
 * needed by the character sheet. The SRD starting-equipment file still gives
 * us the authoritative id/name pairs for the rest of the standard equipment.
 * Keep those references available for name resolution without pretending they
 * are campaign-custom items.
 */
function collectStartingEquipmentReferences(
  value: unknown,
  references: StartingEquipmentReference[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStartingEquipmentReferences(entry, references));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const of = record.of;
  if (
    of &&
    typeof of === 'object' &&
    typeof (of as Record<string, unknown>).index === 'string' &&
    typeof (of as Record<string, unknown>).name === 'string'
  ) {
    references.push({
      index: (of as Record<string, string>).index,
      name: (of as Record<string, string>).name,
    });
  }
  Object.values(record).forEach((entry) => collectStartingEquipmentReferences(entry, references));
}

const startingEquipmentReferences: StartingEquipmentReference[] = [];
collectStartingEquipmentReferences(startingEquipmentData, startingEquipmentReferences);

const referenceEquipment = new Map<string, Equipment>();
for (const reference of startingEquipmentReferences) {
  if (!referenceEquipment.has(reference.index)) {
    referenceEquipment.set(reference.index, {
      id: reference.index,
      name: reference.name,
      category: 'gear',
      cost: { amount: 0, currency: 'gp' },
      weight: 0,
      description: `Standard SRD equipment: ${reference.name}.`,
    });
  }
}

export const allEquipment: Equipment[] = [
  ...localEquipment,
  ...[...referenceEquipment.values()].filter(
    (reference) => !localEquipment.some((equipment) => equipment.id === reference.id),
  ),
];

export const EQUIPMENT_LOOKUP = new Map(allEquipment.map((equipment) => [equipment.id, equipment]));

/** Normalize names and SRD ids to the same hyphenated key. */
export function normalizeEquipmentLookupKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function singularizeLastToken(key: string): string {
  const tokens = key.split('-');
  const last = tokens[tokens.length - 1] || '';
  let singular = last;
  if (last.endsWith('axes')) singular = last.slice(0, -1);
  else if (last.endsWith('ies')) singular = `${last.slice(0, -3)}y`;
  else if (last.endsWith('sses')) singular = last.slice(0, -2);
  else if (last.endsWith('s') && !last.endsWith('ss') && !last.endsWith('us')) {
    singular = last.slice(0, -1);
  }
  return [...tokens.slice(0, -1), singular].join('-');
}

function lookupKeys(value: string): string[] {
  const key = normalizeEquipmentLookupKey(value);
  if (!key) return [];
  const singular = singularizeLastToken(key);
  return singular === key ? [key] : [key, singular];
}

/** Genuine naming differences, rather than spelling/pluralization variants. */
export const EQUIPMENT_NAME_ALIASES: Record<string, string> = {
  [normalizeEquipmentLookupKey('holy symbol')]: 'amulet',
  [normalizeEquipmentLookupKey('fine clothes')]: 'clothes-fine',
  [normalizeEquipmentLookupKey('quiver with 20 arrows')]: 'arrows-20',
  [normalizeEquipmentLookupKey("ranger's pack")]: 'explorers-pack',
  [normalizeEquipmentLookupKey('journal')]: 'book',
  [normalizeEquipmentLookupKey('pan pipes')]: 'pan-flute',
  [normalizeEquipmentLookupKey('costume collection')]: 'clothes-costume',
  [normalizeEquipmentLookupKey('wine flask')]: 'flask-or-tankard',
  // SRD "Noun, adjective" names, as a player or author writes them.
  [normalizeEquipmentLookupKey('light crossbow')]: 'crossbow-light',
  [normalizeEquipmentLookupKey('heavy crossbow')]: 'crossbow-heavy',
  [normalizeEquipmentLookupKey('hand crossbow')]: 'crossbow-hand',
  [normalizeEquipmentLookupKey('hooded lantern')]: 'lantern-hooded',
  [normalizeEquipmentLookupKey('bullseye lantern')]: 'lantern-bullseye',
  [normalizeEquipmentLookupKey('crossbow bolts (20)')]: 'bolts-20',
  [normalizeEquipmentLookupKey('case with 20 crossbow bolts')]: 'bolts-20',
  [normalizeEquipmentLookupKey('two shortswords')]: 'shortsword',
};

const equipmentByLookupKey = new Map<string, Equipment>();
for (const equipment of allEquipment) {
  for (const key of [...lookupKeys(equipment.name), ...lookupKeys(equipment.id)]) {
    if (!equipmentByLookupKey.has(key)) equipmentByLookupKey.set(key, equipment);
  }
}

for (const [alias, targetId] of Object.entries(EQUIPMENT_NAME_ALIASES)) {
  const target = EQUIPMENT_LOOKUP.get(targetId);
  if (target) equipmentByLookupKey.set(normalizeEquipmentLookupKey(alias), target);
}

export function resolveEquipmentById(id: string): Equipment | undefined {
  return EQUIPMENT_LOOKUP.get(id) || equipmentByLookupKey.get(normalizeEquipmentLookupKey(id));
}

/** Resolve a human-readable template name or an SRD id to canonical equipment. */
export function resolveEquipmentByName(name: string): Equipment | undefined {
  for (const key of lookupKeys(name)) {
    const aliasTarget = EQUIPMENT_NAME_ALIASES[key];
    if (aliasTarget) return EQUIPMENT_LOOKUP.get(aliasTarget);
    const equipment = equipmentByLookupKey.get(key);
    if (equipment) return equipment;
  }
  return undefined;
}
