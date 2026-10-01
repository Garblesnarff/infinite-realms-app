/* eslint-disable max-lines */
import { normalizeAbilityScores } from './ability-score-normalization';
import { computeArmorClass } from '../../../shared/armor-class';
import { findSrdClass, getSrdSpellQuotas } from '../../../shared/srd-class-data';

import type { CharacterClass } from '@/types/character';

import { classes } from '@/data/classes';
import { normalizeEquipmentLookupKey, resolveEquipmentByName } from '@/data/equipment/resolver';
import { getPactMagicProgression, getSpellSlotsByLevel } from '@/data/spellcastingFeatures';
import { getClassSpells, getSrdClassSpells } from '@/data/spells/api';
import { getSpellcastingInfo } from '@/utils/spell-validation';

export interface StarterCharacterTemplateLike {
  name: string;
  race: string;
  subrace?: string | null;
  class: string;
  background?: string | null;
  level?: number;
  tagline?: string | null;
  description?: string | null;
  adaptedBackstory?: string | null;
  adapted_backstory?: string | null;
  skills?: string[];
  languages?: string[];
  equipment?: StarterTemplateEquipmentInput[];
  portraitUrl?: string | null;
  portrait_url?: string | null;
  cardImageUrl?: string | null;
  card_image_url?: string | null;
  abilityScores?: Record<string, number>;
  ability_scores?: Record<string, number>;
  /** Optional forward-compatible curated spell shape. */
  spells?: StarterTemplateSpellLists;
  cantrips?: string[] | null;
  knownSpells?: string[] | null;
  preparedSpells?: string[] | null;
  known_spells?: string[] | null;
  prepared_spells?: string[] | null;
}

export interface StarterTemplateSpellLists {
  cantrips?: string[];
  knownSpells?: string[];
  preparedSpells?: string[];
}

export type StarterCharacterCreatePayload = Record<string, unknown> & { name: string };
export type CreateStarterCharacter = (
  payload: StarterCharacterCreatePayload,
) => Promise<{ id: string }>;

export interface StarterTemplateEquipment {
  name: string;
  description?: string | null;
}

export type StarterTemplateEquipmentInput = string | StarterTemplateEquipment;

function getTemplateValue<T>(
  template: StarterCharacterTemplateLike,
  camel: keyof StarterCharacterTemplateLike,
  snake?: keyof StarterCharacterTemplateLike,
): T | undefined {
  return (template[camel] ?? (snake ? template[snake] : undefined)) as T | undefined;
}

export function getAbilityScores(template: StarterCharacterTemplateLike): Record<string, number> {
  return normalizeAbilityScores(getTemplateValue(template, 'abilityScores', 'ability_scores'), {
    templateName: template.name,
    templateClass: template.class,
  });
}

function getModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function getClassHitDie(className: string): number {
  const classData = findSrdClass(className);
  if (!classData) {
    throw new Error(`Unsupported SRD class "${className}"; refusing HP initialization.`);
  }
  return classData.hitDie;
}

function findClass(className: string): CharacterClass | undefined {
  const normalized = className.trim().toLowerCase();
  return classes.find(
    (characterClass) =>
      characterClass.id === normalized || characterClass.name.toLowerCase() === normalized,
  );
}

function getSpellSlots(
  className: string,
  level: number,
): Record<string, { max: number; current: number } | number> | undefined {
  if (className.toLowerCase() === 'warlock') {
    const pact = getPactMagicProgression(level);
    return pact
      ? { caster_level: level, pact_slots: pact.pactSlots, pact_slot_level: pact.pactSlotLevel }
      : undefined;
  }

  const slots = getSpellSlotsByLevel(className, level);
  if (slots.length === 0 || slots.every((slot) => slot === 0)) return undefined;

  // Stored in the { level: { max, current } } shape the sheet parses from
  // `characters.spell_slots`. The old `spell_slots_N` keys were dropped by the
  // parser, so premade casters silently fell back to computed slots (#2459).
  return Object.fromEntries(
    slots
      .map(
        (slot, index) => [String(index + 1), { max: slot, current: slot }] as const,
      )
      .filter(([, slot]) => slot.max > 0),
  );
}

export interface StarterSpellSeed {
  cantrips: string[];
  knownSpells: string[];
  preparedSpells: string[];
  spellSlots?: Record<string, { max: number; current: number } | number>;
}

export interface StarterSpellQuotas {
  known: number;
  prepared: number;
}

/** Derive the two stored spell quantities from the SRD class rules. */
export function getStarterSpellQuotas(
  className: string,
  level: number,
  abilityScores: Record<string, number>,
): StarterSpellQuotas {
  const characterClass = findClass(className);
  const srdClass = findSrdClass(className);
  if (!characterClass || !srdClass?.spellcasting) return { known: 0, prepared: 0 };

  const ability = srdClass.spellcasting.ability;
  const abilityModifier = getModifier(abilityScores[ability] ?? 10);
  return getSrdSpellQuotas(className, level, abilityModifier);
}

function uniqueSpellIds(spellIds: string[]): string[] {
  return [...new Set(spellIds)];
}

function selectSpellIds(curated: string[], fallback: string[], quota: number): string[] {
  return uniqueSpellIds([...curated, ...fallback]).slice(0, quota);
}

function getTemplateSpellLists(template: StarterCharacterTemplateLike): StarterTemplateSpellLists {
  return {
    cantrips: template.spells?.cantrips || template.cantrips || undefined,
    knownSpells:
      template.spells?.knownSpells || template.knownSpells || template.known_spells || undefined,
    preparedSpells:
      template.spells?.preparedSpells ||
      template.preparedSpells ||
      template.prepared_spells ||
      undefined,
  };
}

/**
 * Build class-appropriate spell state from the same class and SRD sources as
 * the character wizard. Prepared casters get a prepared list based on their
 * casting ability modifier; known-spell casters get their level-based quota.
 */
export function buildStarterSpellSeed(
  template: StarterCharacterTemplateLike,
  abilityScores = getAbilityScores(template),
): StarterSpellSeed {
  const level = Math.max(1, template.level || 1);
  const className = template.class || '';
  const characterClass = findClass(className);
  const info = characterClass ? getSpellcastingInfo(characterClass, level) : null;
  if (!info) return { cantrips: [], knownSpells: [], preparedSpells: [] };
  const available = getSrdClassSpells(characterClass.name);
  const authoredAvailable = getClassSpells(characterClass.name);

  const curated = getTemplateSpellLists(template);
  const validCantrips = new Set(authoredAvailable.cantrips.map((spell) => spell.id));
  const curatedCantrips = (curated?.cantrips || []).filter((id) => validCantrips.has(id));
  const cantripCount = info.cantripsKnown;
  const cantrips = selectSpellIds(
    curatedCantrips,
    available.cantrips.map((spell) => spell.id),
    cantripCount,
  );

  const quotas = getStarterSpellQuotas(className, level, abilityScores);
  const maxSpellLevel = Math.min(5, Math.ceil(level / 2));
  const eligibleAuthoredSpells = authoredAvailable.spells.filter(
    (spell) => spell.level <= maxSpellLevel,
  );
  const validSpells = new Set(eligibleAuthoredSpells.map((spell) => spell.id));
  const availableKnownSpells = available.spells
    .filter((spell) => spell.level <= maxSpellLevel)
    .map((spell) => spell.id);
  const curatedKnownSpells = (curated?.knownSpells || []).filter((id) => validSpells.has(id));
  const curatedPreparedSpells = (curated?.preparedSpells || []).filter((id) => validSpells.has(id));
  const knownCandidates =
    characterClass.id === 'wizard'
      ? uniqueSpellIds([...curatedKnownSpells, ...curatedPreparedSpells])
      : curatedKnownSpells;
  const knownSpells = selectSpellIds(knownCandidates, availableKnownSpells, quotas.known);
  const preparedCandidates =
    characterClass.id === 'wizard'
      ? curatedPreparedSpells.filter((id) => knownSpells.includes(id))
      : curatedPreparedSpells;
  const preparedFallback = characterClass.id === 'wizard' ? knownSpells : availableKnownSpells;
  const preparedSpells = selectSpellIds(preparedCandidates, preparedFallback, quotas.prepared);

  return {
    cantrips,
    knownSpells,
    preparedSpells,
    spellSlots: getSpellSlots(className, level),
  };
}

export interface StarterEquipmentRecord {
  item_name: string;
  item_type: string;
  quantity: number;
  equipped: boolean;
  weight?: number;
  description?: string;
}

export interface StarterInventoryRecord {
  name: string;
  item_type: 'trinket';
  quantity: number;
  weight: number;
  description: string;
  is_equipped: boolean;
}

function templateEquipmentItem(item: StarterTemplateEquipmentInput): StarterTemplateEquipment {
  return typeof item === 'string' ? { name: item } : item;
}

function customItemDescription(item: StarterTemplateEquipment): string {
  return (
    item.description?.trim() || `A campaign-specific item from the starter template: ${item.name}.`
  );
}

function templateEquipmentKey(item: StarterTemplateEquipment): string {
  const equipment = resolveEquipmentByName(item.name);
  return equipment ? `srd:${equipment.id}` : `custom:${normalizeEquipmentLookupKey(item.name)}`;
}

const QUIVER_WITH_ARROWS_KEY = normalizeEquipmentLookupKey('quiver with 20 arrows');

function resolvedTemplateEquipment(
  equipmentNames: StarterTemplateEquipmentInput[] = [],
): Array<{ item: StarterTemplateEquipment; equipment: ReturnType<typeof resolveEquipmentByName> }> {
  return equipmentNames.filter(Boolean).flatMap((item) => {
    const templateItem = templateEquipmentItem(item);
    const equipment = resolveEquipmentByName(templateItem.name);
    const resolved = [{ item: templateItem, equipment }];

    // The template phrase describes a bundle. Keep the quiver as flavor when
    // the SRD has one, but make the 20 arrows a real equipment row.
    if (normalizeEquipmentLookupKey(templateItem.name) === QUIVER_WITH_ARROWS_KEY) {
      const quiver = resolveEquipmentByName('quiver');
      if (quiver) resolved.push({ item: { name: quiver.name }, equipment: quiver });
    }

    return resolved;
  });
}

/** Transform template items into the validated character_equipment shape. */
export function transformStarterEquipment(
  equipmentNames: StarterTemplateEquipmentInput[] = [],
): StarterEquipmentRecord[] {
  const records = new Map<string, StarterEquipmentRecord>();
  let weaponCount = 0;

  for (const { item, equipment } of resolvedTemplateEquipment(equipmentNames)) {
    const key = templateEquipmentKey(item);
    const existing = records.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }

    const shouldEquip = equipment
      ? equipment.category === 'armor' ||
        equipment.category === 'shield' ||
        (equipment.category === 'weapon' && weaponCount++ < 2)
      : false;

    records.set(key, {
      item_name: equipment?.name || item.name,
      item_type: equipment?.category || 'trinket',
      quantity: 1,
      equipped: shouldEquip,
      ...(equipment ? {} : { description: customItemDescription(item), weight: 0 }),
    });
  }

  return [...records.values()];
}

/** Build first-class inventory rows for campaign flavor items. */
export function transformStarterInventory(
  equipmentNames: StarterTemplateEquipmentInput[] = [],
): StarterInventoryRecord[] {
  const records = new Map<string, StarterInventoryRecord>();
  for (const { item, equipment } of resolvedTemplateEquipment(equipmentNames)) {
    if (equipment) continue;
    const key = normalizeEquipmentLookupKey(item.name);
    const existing = records.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    records.set(key, {
      name: item.name,
      item_type: 'trinket',
      quantity: 1,
      weight: 0,
      description: customItemDescription(item),
      is_equipped: false,
    });
  }
  return [...records.values()];
}

export function buildStarterCharacterSeed(
  template: StarterCharacterTemplateLike,
  campaignId: string,
): StarterCharacterCreatePayload {
  const abilityScores = getAbilityScores(template);
  const level = Math.max(1, template.level || 1);
  const portraitUrl =
    getTemplateValue<string | null>(template, 'portraitUrl', 'portrait_url') || null;
  const cardImageUrl =
    getTemplateValue<string | null>(template, 'cardImageUrl', 'card_image_url') || null;
  const spellSeed = buildStarterSpellSeed(template, abilityScores);
  const skills = template.skills || [];
  const languages = template.languages || [];
  const equipment = transformStarterEquipment(template.equipment || []);
  const inventoryItems = transformStarterInventory(template.equipment || []);
  const hitPoints = getClassHitDie(template.class) + getModifier(abilityScores.constitution);

  return {
    name: template.name,
    race: template.race,
    subrace: template.subrace || null,
    class: template.class,
    level,
    background: template.background || null,
    backstory_elements: template.adaptedBackstory ?? template.adapted_backstory ?? null,
    description: template.description ?? template.tagline ?? null,
    campaign_id: campaignId,
    skill_proficiencies: skills.join(', '),
    languages,
    image_url: portraitUrl,
    avatar_url: portraitUrl,
    background_image: cardImageUrl,
    cantrips: spellSeed.cantrips.join(', '),
    known_spells: spellSeed.knownSpells.join(', '),
    prepared_spells: spellSeed.preparedSpells.join(', '),
    ...(spellSeed.spellSlots ? { spell_slots: spellSeed.spellSlots } : {}),
    total_level: level,
    stats: {
      ...abilityScores,
      max_hit_points: hitPoints,
      current_hit_points: hitPoints,
      // The equipment built two lines up decides this. It used to be `10 + DEX`, which is how
      // 76 characters ended up wearing armour that did nothing (#1858).
      armor_class: computeArmorClass(equipment, getModifier(abilityScores.dexterity)),
    },
    equipment,
    ...(inventoryItems.length > 0 ? { inventory_items: inventoryItems } : {}),
  };
}

/** Create a starter character through the caller's authenticated data API. */
export function seedStarterCharacter(
  template: StarterCharacterTemplateLike,
  campaignId: string,
  createCharacter: CreateStarterCharacter,
): Promise<{ id: string }> {
  return createCharacter(buildStarterCharacterSeed(template, campaignId));
}
