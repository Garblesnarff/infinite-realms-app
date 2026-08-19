/**
 * Armour class, computed once from what a character is wearing.
 *
 * `character_stats.armor_class` is the stored, authoritative number — the combat engine reads
 * it and never derives one (see `server-bun/src/services/combat/equipped-loadout.ts`). This
 * module is the single place that decides what that number should be, so the three writers of
 * it — the starter seeder, the server-side equipment write path, and
 * `scripts/backfill-armor-class.ts` — cannot drift apart. Before #1858 the seeder wrote
 * `10 + DEX` two lines after building the equipment it ignored, and nothing ever recomputed:
 * "The Faithful" fought at AC 10 wearing Scale Mail and a Shield.
 *
 * The SRD armour table is spelled out here rather than imported from
 * `src/data/equipment/armor.ts` so that this module stays dependency-free and importable from
 * the browser bundle, the Bun server and a script alike. The two are pinned to each other by
 * `tests/armor-class.test.ts`, which fails if either side gains, loses or renumbers an entry.
 */

/**
 * An equipment row as the two tables actually store it.
 *
 * `character_equipment` uses `item_name`/`equipped`; `inventory_items` uses `name`/
 * `is_equipped`. Both shapes are accepted because both feed the same character sheet, and a
 * caller should never have to reshape rows just to ask what they add up to.
 */
export interface ArmorClassEquipmentItem {
  item_name?: string | null;
  name?: string | null;
  item_type?: string | null;
  equipped?: boolean | null;
  is_equipped?: boolean | null;
}

export type SrdArmorCategory = 'light' | 'medium' | 'heavy';

export interface SrdArmorEntry {
  name: string;
  category: SrdArmorCategory;
  base: number;
}

/**
 * Where an unrecognized piece of armour is reported.
 *
 * Injected rather than imported: the browser, the Bun server and the backfill script each have
 * their own logger, and this module belongs to none of them.
 */
export type ArmorClassWarning = (message: string, context: Record<string, unknown>) => void;

export interface ArmorClassOptions {
  warn?: ArmorClassWarning;
}

/** Unarmoured AC before any dexterity bonus (PHB pg. 14). */
export const UNARMORED_ARMOR_CLASS = 10;

/** Medium armour caps the dexterity bonus; heavy armour allows none. */
export const MEDIUM_ARMOR_MAX_DEXTERITY_BONUS = 2;

/** A shield is +2 however many are somehow equipped. */
export const SHIELD_ARMOR_CLASS_BONUS = 2;

/** SRD armour, by the names the equipment catalog and the campaign templates use. */
export const SRD_ARMOR: SrdArmorEntry[] = [
  { name: 'Padded Armor', category: 'light', base: 11 },
  { name: 'Leather Armor', category: 'light', base: 11 },
  { name: 'Studded Leather', category: 'light', base: 12 },
  { name: 'Hide Armor', category: 'medium', base: 12 },
  { name: 'Chain Shirt', category: 'medium', base: 13 },
  { name: 'Scale Mail', category: 'medium', base: 14 },
  { name: 'Breastplate', category: 'medium', base: 14 },
  { name: 'Half Plate', category: 'medium', base: 15 },
  { name: 'Ring Mail', category: 'heavy', base: 14 },
  { name: 'Chain Mail', category: 'heavy', base: 16 },
  { name: 'Splint Armor', category: 'heavy', base: 17 },
  { name: 'Plate Armor', category: 'heavy', base: 18 },
];

/**
 * Genuine naming differences, not spelling variants — the SRD id (`plate-armor`), the shop
 * name (`Plate Armor`) and the table name (`plate mail`) are one item. Anything not listed
 * here or above is treated as unknown rather than guessed at.
 */
const ARMOR_NAME_ALIASES: Record<string, string> = {
  padded: 'Padded Armor',
  leather: 'Leather Armor',
  'studded leather armor': 'Studded Leather',
  hide: 'Hide Armor',
  'scale armor': 'Scale Mail',
  'half plate armor': 'Half Plate',
  splint: 'Splint Armor',
  'splint mail': 'Splint Armor',
  plate: 'Plate Armor',
  'plate mail': 'Plate Armor',
  'full plate': 'Plate Armor',
};

/** The item types that mean "this row was supposed to protect someone". */
const ARMOR_ITEM_TYPES = new Set(['armor', 'shield']);

const SHIELD_KEY = 'shield';

/**
 * Lowercase, strip punctuation, collapse whitespace. `Scale Mail`, `scale-mail`, `SCALE MAIL`
 * and the SRD id `scale_mail` all have to reach the same row, because all four spellings are
 * in the database today.
 */
function normalizeArmorKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ARMOR_BY_KEY = new Map<string, SrdArmorEntry>();
for (const entry of SRD_ARMOR) {
  ARMOR_BY_KEY.set(normalizeArmorKey(entry.name), entry);
}
for (const [alias, name] of Object.entries(ARMOR_NAME_ALIASES)) {
  const entry = SRD_ARMOR.find((row) => row.name === name);
  if (entry) ARMOR_BY_KEY.set(normalizeArmorKey(alias), entry);
}

const defaultWarn: ArmorClassWarning = (message, context) => {
  // eslint-disable-next-line no-console -- shared code has no logger of its own; every caller
  // that has one passes it in through `options.warn`.
  console.warn(message, context);
};

function itemName(item: ArmorClassEquipmentItem): string {
  return (item.item_name ?? item.name ?? '').trim();
}

function isEquipped(item: ArmorClassEquipmentItem): boolean {
  return item.equipped === true || item.is_equipped === true;
}

function looksLikeArmor(item: ArmorClassEquipmentItem): boolean {
  return ARMOR_ITEM_TYPES.has((item.item_type ?? '').trim().toLowerCase());
}

function dexterityBonusFor(category: SrdArmorCategory, dexterityModifier: number): number {
  if (category === 'heavy') return 0;
  if (category === 'medium') return Math.min(dexterityModifier, MEDIUM_ARMOR_MAX_DEXTERITY_BONUS);
  return dexterityModifier;
}

/** The 5e ability modifier, so callers holding a raw score do not each reinvent it. */
export function abilityScoreModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export interface ArmorClassBreakdown {
  armorClass: number;
  /** The armour that was worn, or null when the character is unarmoured. */
  armor: SrdArmorEntry | null;
  /** The dexterity actually applied — capped for medium armour, dropped for heavy. */
  dexterityBonus: number;
  shieldBonus: number;
  /** Equipped rows typed as armour whose name is not in the SRD table. Never guessed at. */
  unrecognizedArmorNames: string[];
}

/**
 * The full working, for callers that have to explain themselves — the backfill prints it, and
 * the tests assert on it.
 *
 * Only equipped rows count. Two equipped armours is not a legal loadout, so rather than adding
 * them (which is how a character ends up at AC 27) the better base wins and the result stays
 * deterministic.
 */
export function describeArmorClass(
  equipment: ArmorClassEquipmentItem[] | null | undefined,
  dexterityModifier: number,
  options: ArmorClassOptions = {},
): ArmorClassBreakdown {
  const warn = options.warn ?? defaultWarn;
  let armor: SrdArmorEntry | null = null;
  let shieldBonus = 0;
  const unrecognizedArmorNames: string[] = [];

  for (const item of equipment ?? []) {
    if (!isEquipped(item)) continue;

    const name = itemName(item);
    if (!name) continue;

    const key = normalizeArmorKey(name);
    if (key === SHIELD_KEY) {
      shieldBonus = SHIELD_ARMOR_CLASS_BONUS;
      continue;
    }

    const entry = ARMOR_BY_KEY.get(key);
    if (entry) {
      if (!armor || entry.base > armor.base) armor = entry;
      continue;
    }

    // A mace or a bedroll is not a failed armour lookup, so only rows the sheet itself calls
    // armour or a shield are worth reporting. Guessing a base AC from a name is how a homebrew
    // apron would silently become plate.
    if (looksLikeArmor(item)) unrecognizedArmorNames.push(name);
  }

  for (const name of unrecognizedArmorNames) {
    warn('Unrecognized armor name; ignored when computing armor class', { itemName: name });
  }

  const dexterityBonus = armor
    ? dexterityBonusFor(armor.category, dexterityModifier)
    : dexterityModifier;
  const base = armor ? armor.base : UNARMORED_ARMOR_CLASS;

  return {
    armorClass: base + dexterityBonus + shieldBonus,
    armor,
    dexterityBonus,
    shieldBonus,
    unrecognizedArmorNames,
  };
}

/** Armour class from equipped equipment: armour base, capped dexterity, +2 for a shield. */
export function computeArmorClass(
  equipment: ArmorClassEquipmentItem[] | null | undefined,
  dexterityModifier: number,
  options: ArmorClassOptions = {},
): number {
  return describeArmorClass(equipment, dexterityModifier, options).armorClass;
}
