/* eslint-disable max-lines */
import { normalizeAbilityScores } from './ability-score-normalization';
import { computeArmorClass } from '../../../shared/armor-class';
import { findSrdClass } from '../../../shared/srd-class-data';

import type { CharacterClass } from '@/types/character';

import { classes } from '@/data/classes';
import { normalizeEquipmentLookupKey, resolveEquipmentByName } from '@/data/equipment/resolver';
import {
  calculateSpellsKnown,
  getPactMagicProgression,
  getSpellSlotsByLevel,
} from '@/data/spellcastingFeatures';
import { getClassSpells } from '@/data/spells/api';
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
  spells?: { cantrips?: string[]; knownSpells?: string[]; preparedSpells?: string[] };
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

function getSpellSlots(className: string, level: number): Record<string, number> | undefined {
  if (className.toLowerCase() === 'warlock') {
    const pact = getPactMagicProgression(level);
    return pact
      ? { caster_level: level, pact_slots: pact.pactSlots, pact_slot_level: pact.pactSlotLevel }
      : undefined;
  }

  const slots = getSpellSlotsByLevel(className, level);
  if (slots.length === 0 || slots.every((slot) => slot === 0)) return undefined;

  return {
    caster_level: level,
    ...Object.fromEntries(slots.map((slot, index) => [`spell_slots_${index + 1}`, slot])),
  };
}

export interface StarterSpellSeed {
  cantrips: string[];
  knownSpells: string[];
  preparedSpells: string[];
  spellSlots?: Record<string, number>;
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
  if (!characterClass?.spellcasting) {
    return { cantrips: [], knownSpells: [], preparedSpells: [] };
  }

  const info = getSpellcastingInfo(characterClass, level);
  const available = getClassSpells(characterClass.name);
  if (!info) return { cantrips: [], knownSpells: [], preparedSpells: [] };

  const curated = template.spells;
  const validCantrips = new Set(available.cantrips.map((spell) => spell.id));
  const validSpells = new Set(available.spells.map((spell) => spell.id));
  const curatedCantrips = (curated?.cantrips || []).filter((id) => validCantrips.has(id));
  const curatedKnownSpells = (curated?.knownSpells || []).filter((id) => validSpells.has(id));
  const cantripCount = info.cantripsKnown;
  const cantrips = (
    curatedCantrips.length > 0 ? curatedCantrips : available.cantrips.map((spell) => spell.id)
  ).slice(0, cantripCount);

  const ability = characterClass.spellcasting.ability;
  const abilityModifier = getModifier(abilityScores[ability] || 10);
  const canPrepareSpells = ['cleric', 'druid', 'paladin', 'wizard'].includes(characterClass.id);
  const spellCount = canPrepareSpells
    ? calculateSpellsKnown(characterClass.id, level, abilityModifier)
    : info.spellsKnown || 0;
  const maxSpellLevel = Math.min(5, Math.ceil(level / 2));
  const availableKnownSpells = available.spells
    .filter((spell) => spell.level <= maxSpellLevel)
    .map((spell) => spell.id);
  const knownSpells = (
    curatedKnownSpells.length > 0 ? curatedKnownSpells : availableKnownSpells
  ).slice(0, spellCount);
  const curatedPreparedSpells = (curated?.preparedSpells || []).filter((id) => validSpells.has(id));
  const preparedSpells = canPrepareSpells
    ? (curatedPreparedSpells.length > 0 ? curatedPreparedSpells : knownSpells).slice(0, spellCount)
    : [];

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
