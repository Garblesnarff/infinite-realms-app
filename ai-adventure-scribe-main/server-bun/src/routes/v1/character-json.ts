/**
 * Character JSON export (#319). The export is the same snake_case body the wizard POSTs to
 * `/v1/characters`, minus every id, owner, campaign link, sharing flag and timestamp, so an
 * import is one more call into the same single writer and can never carry another user's ids.
 */

export const CHARACTER_EXPORT_FORMAT = 'infinite-realms.character';
export const CHARACTER_EXPORT_VERSION = 1;

/** Body fields that are links or engine-owned state, never part of an export. */
export const NON_PORTABLE_CHARACTER_KEYS = ['campaign_id', 'spell_slots', 'pact_slots'] as const;

const STAT_KEYS = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'armor_class',
  'max_hit_points',
  'current_hit_points',
  'temporary_hit_points',
  'initiative_bonus',
  'speed',
] as const;

const EQUIPMENT_KEYS = [
  'item_name',
  'item_type',
  'quantity',
  'equipped',
  'is_magic',
  'magic_bonus',
  'magic_properties',
  'requires_attunement',
  'is_attuned',
  'attunement_requirements',
  'magic_item_type',
  'magic_item_rarity',
] as const;

const INVENTORY_KEYS = [
  'name',
  'item_type',
  'quantity',
  'weight',
  'description',
  'is_equipped',
  'is_attuned',
  'requires_attunement',
  'properties',
] as const;

type Row = Record<string, unknown>;

const present = (value: unknown) => value !== null && value !== undefined;

function pick(source: Row, keys: readonly string[]): Row {
  return Object.fromEntries(
    keys.filter((key) => present(source[key])).map((key) => [key, source[key]]),
  );
}

export interface CharacterExportSources {
  /** The sheet payload from `mapCharacterToApi`. */
  mapped: Row;
  /** Keys the import body accepts for the character itself. */
  characterKeys: readonly string[];
  stats?: Row | null;
  equipment: Array<{
    itemName: string;
    itemType: string | null;
    quantity: number | null;
    equipped: boolean | null;
    isMagic: boolean | null;
    magicBonus: number | null;
    magicProperties: string | null;
    requiresAttunement: boolean | null;
    isAttuned: boolean | null;
    attunementRequirements: string | null;
    magicItemType: string | null;
    magicItemRarity: string | null;
    magicEffects: unknown;
  }>;
  inventory: Array<{
    name: string;
    itemType: string;
    quantity: number;
    weight: string | null;
    description: string | null;
    isEquipped: boolean;
    isAttuned: boolean;
    requiresAttunement: boolean;
    properties: string | null;
  }>;
}

export function buildCharacterExport(sources: CharacterExportSources, exportedAt = new Date()) {
  const { mapped, characterKeys, stats, equipment, inventory } = sources;
  const portableKeys = characterKeys.filter(
    (key) =>
      !(NON_PORTABLE_CHARACTER_KEYS as readonly string[]).includes(key) &&
      key !== 'stats' &&
      key !== 'equipment' &&
      key !== 'inventory_items',
  );

  const character: Row = pick(mapped, portableKeys);
  if (stats) character.stats = pick(stats as Row, STAT_KEYS);

  const equipmentRows = equipment.map((item) => {
    const row = {
      item_name: item.itemName,
      item_type: item.itemType,
      quantity: item.quantity,
      equipped: item.equipped,
      is_magic: item.isMagic,
      magic_bonus: item.magicBonus,
      magic_properties: item.magicProperties,
      requires_attunement: item.requiresAttunement,
      is_attuned: item.isAttuned,
      attunement_requirements: item.attunementRequirements,
      magic_item_type: item.magicItemType,
      magic_item_rarity: item.magicItemRarity,
    };
    return pick(row, EQUIPMENT_KEYS);
  });
  if (equipmentRows.length) character.equipment = equipmentRows;

  const inventoryRows = inventory.map((item) =>
    pick(
      {
        name: item.name,
        item_type: item.itemType,
        quantity: item.quantity,
        weight: present(item.weight) ? Number(item.weight) : null,
        description: item.description,
        is_equipped: item.isEquipped,
        is_attuned: item.isAttuned,
        requires_attunement: item.requiresAttunement,
        properties: item.properties,
      },
      INVENTORY_KEYS,
    ),
  );
  if (inventoryRows.length) character.inventory_items = inventoryRows;

  return {
    format: CHARACTER_EXPORT_FORMAT,
    version: CHARACTER_EXPORT_VERSION,
    exported_at: exportedAt.toISOString(),
    character,
  };
}
