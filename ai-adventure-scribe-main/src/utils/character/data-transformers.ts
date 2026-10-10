import { parsePersonalityEnvelope } from './personality-envelope';

import type {
  AbilityScores,
  Character,
  CharacterBackground,
  CharacterClass,
  CharacterRace,
  Subrace,
} from '@/types/character';

import { lookupBackgrounds } from '@/data/backgroundOptions';
import { classes } from '@/data/classes';
import { lookupRaces } from '@/data/races';
import logger from '@/lib/logger';
import {
  parseOptionalProficiencyList,
  parseSavingThrowProficiencies,
} from '@/utils/character/parse-proficiency-list';

// ===========================
// Types
// ===========================

export interface CharacterStatsRow {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  armor_class?: number | null;
  max_hit_points?: number | null;
  current_hit_points?: number | null;
  /** #2517: the single truth for "dead", read by the sheet's end state. */
  vital_state?: string | null;
  died_at?: string | null;
}

export interface CharacterEquipmentRow {
  id: string;
  item_name: string;
  item_type?: string;
  description?: string | null;
  quantity?: number;
  equipped?: boolean;
  is_magic?: boolean;
  magic_bonus?: number;
  magic_properties?: string | null;
  requires_attunement?: boolean;
  is_attuned?: boolean;
  attunement_requirements?: string | null;
  magic_item_type?: string;
  magic_item_rarity?: string;
  magic_effects?: string | null;
}

export interface CharacterRow {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  race: string;
  subrace?: string | null;
  class: string;
  level: number;
  background?: string | null;
  experience_points?: number | null;
  alignment?: string | null;
  avatar_url?: string | null;
  image_url?: string | null;
  background_image?: string | null;
  appearance?: string | null;
  personality_traits?: string | null;
  /**
   * #2701: carries the sheet's personality envelope (traits/ideals/bonds/flaws
   * arrays plus inspiration state) as JSON. The column predates the envelope;
   * a legacy plain-text value is preserved as `legacyNotes` inside the
   * envelope and shown in the Personality Notes card.
   */
  personality_notes?: string | null;
  backstory_elements?: string | null;
  /**
   * #2701: session notes column. Hydrated into Character.sessionNotes so a
   * post-save silent refresh does not wipe freshly saved notes.
   */
  session_notes?: string | null;
  /**
   * Stored class-feature uses. Hydrated so a silent refresh after Use Feature
   * or a rest does not snap the tracker back to the template counts.
   */
  class_features?: string | Record<string, unknown> | null;
  vision_types?: string | null;
  obscurement?: string | null;
  is_hidden?: boolean | null;
  stealth_check_bonus?: number | null;
  cantrips?: string | null;
  known_spells?: string | null;
  prepared_spells?: string | null;
  ritual_spells?: string | null;
  skill_proficiencies?: string | string[] | null;
  expertise_proficiencies?: string | string[] | null;
  tool_proficiencies?: string | string[] | null;
  saving_throw_proficiencies?: string | string[] | null;
  languages?: string | string[] | null;
  character_stats?: CharacterStatsRow | CharacterStatsRow[] | null;
  character_equipment?: CharacterEquipmentRow[] | null;
}

// ===========================
// Helper Functions
// ===========================

type NamedCharacterData = {
  id: string;
  name: string;
};

/**
 * Database rows hold display names, while the static records expose both ids and display names.
 * Normalize both forms so `Half-Orc`, `half-orc`, and `Half Orc` resolve to the same record.
 */
const normalizeCharacterDataKey = (value: unknown): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const findCharacterData = <T extends NamedCharacterData>(
  options: readonly T[],
  storedName: string | null | undefined,
): T | undefined => {
  const key = normalizeCharacterDataKey(storedName);
  if (!key) return undefined;

  return options.find(
    (option) =>
      normalizeCharacterDataKey(option.id) === key ||
      normalizeCharacterDataKey(option.name) === key,
  );
};

const resolveCharacterData = <T extends NamedCharacterData>(
  kind: 'race' | 'class' | 'background' | 'subrace',
  options: readonly T[],
  storedName: string | null | undefined,
): T | null => {
  if (!normalizeCharacterDataKey(storedName)) return null;

  const resolved = findCharacterData(options, storedName);
  if (resolved) return resolved;

  logger.warn('Character data lookup failed', { kind, storedName });
  return null;
};

const resolveClass = (storedName: string | null | undefined): CharacterClass | null =>
  resolveCharacterData('class', classes, storedName);

const resolveSubrace = (
  race: CharacterRace | null,
  storedName: string | null | undefined,
): Subrace | null => {
  if (!race || !normalizeCharacterDataKey(storedName)) return null;
  return resolveCharacterData('subrace', race.subraces || [], storedName);
};

/** The stored name, trimmed, when it names anything at all. */
const storedLabel = (value: unknown): string | null =>
  normalizeCharacterDataKey(value) ? (value as string).trim() : null;

const placeholderId = (label: string): string => `unknown-${normalizeCharacterDataKey(label)}`;

/**
 * Seed data and the client tables drift (The Reveler's `Satyr`, #2150). A race the client
 * does not know still renders under its stored name, with no bonuses or traits, instead
 * of leaving `character.race` null for every downstream reader to trip over.
 */
const placeholderRace = (label: string): CharacterRace => ({
  id: placeholderId(label),
  name: label,
  description: '',
  abilityScoreIncrease: {},
  speed: 30,
  traits: [],
  languages: [],
  subraces: [],
});

const placeholderBackground = (label: string): CharacterBackground => ({
  id: placeholderId(label),
  name: label,
  description: '',
  skillProficiencies: [],
  toolProficiencies: [],
  languages: 0,
  equipment: [],
  feature: { name: label, description: '' },
});

const resolveRace = (storedName: string | null | undefined): CharacterRace | null => {
  const label = storedLabel(storedName);
  if (!label) return null;
  return resolveCharacterData('race', lookupRaces, label) ?? placeholderRace(label);
};

const resolveBackground = (storedName: string | null | undefined): CharacterBackground | null => {
  const label = storedLabel(storedName);
  if (!label) return null;
  return (
    resolveCharacterData('background', lookupBackgrounds, label) ?? placeholderBackground(label)
  );
};

/**
 * Stored names the client tables could not resolve, as short reasons the sheet can show
 * ("Unknown race: Satyr"). Empty when every stored name resolved.
 */
export const findUnresolvedCharacterData = (
  characterData: Pick<CharacterRow, 'race' | 'subrace' | 'class' | 'background'>,
): string[] => {
  const unresolved: string[] = [];
  const race = storedLabel(characterData.race);
  const subrace = storedLabel(characterData.subrace);
  const characterClass = storedLabel(characterData.class);
  const background = storedLabel(characterData.background);

  const knownRace = race ? findCharacterData(lookupRaces, race) : undefined;
  if (race && !knownRace) unresolved.push(`Unknown race: ${race}`);
  if (knownRace && subrace && !findCharacterData(knownRace.subraces || [], subrace)) {
    unresolved.push(`Unknown subrace: ${subrace}`);
  }
  if (characterClass && !findCharacterData(classes, characterClass)) {
    unresolved.push(`Unknown class: ${characterClass}`);
  }
  if (background && !findCharacterData(lookupBackgrounds, background)) {
    unresolved.push(`Unknown background: ${background}`);
  }

  return unresolved;
};

const readStoredClassFeatures = (
  raw: CharacterRow['class_features'],
): Character['classFeatures'] | undefined => {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    return parseJsonField<Character['classFeatures'] | undefined>(raw, undefined);
  }
  if (typeof raw === 'object') return raw;
  return undefined;
};

export const parseJsonField = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn('Failed to parse character JSON field', { raw, error });
    return fallback;
  }
};

export const parseSpellListField = (raw: string | null | undefined): string[] => {
  if (!raw) return [];

  const trimmed = raw.trim();

  if (trimmed.startsWith('[')) {
    const parsed = parseJsonField<string[] | null>(trimmed, null);
    if (Array.isArray(parsed)) {
      return parsed.map((id) => String(id).trim()).filter((id) => id.length > 0);
    }
  }

  return trimmed
    .split(',')
    .map((id: string) => id.trim())
    .filter((id: string) => id.length > 0);
};

// #2701: the envelope implementation lives in the leaf module
// personality-envelope.ts (see top of file); re-exported here for
// existing import sites.
export { parsePersonalityEnvelope, serializePersonalityEnvelope } from './personality-envelope';
export type { SheetPersonalityEnvelope } from './personality-envelope';

/**
 * Transforms database stats into Character ability scores format
 * @param statsData - Raw stats data from database
 * @returns Formatted ability scores object
 */
export const transformAbilityScores = (
  statsData: CharacterStatsRow | null | undefined,
): AbilityScores | null => {
  if (!statsData) return null;

  return {
    strength: {
      score: statsData.strength,
      modifier: Math.floor((statsData.strength - 10) / 2),
      savingThrow: false,
    },
    dexterity: {
      score: statsData.dexterity,
      modifier: Math.floor((statsData.dexterity - 10) / 2),
      savingThrow: false,
    },
    constitution: {
      score: statsData.constitution,
      modifier: Math.floor((statsData.constitution - 10) / 2),
      savingThrow: false,
    },
    intelligence: {
      score: statsData.intelligence,
      modifier: Math.floor((statsData.intelligence - 10) / 2),
      savingThrow: false,
    },
    wisdom: {
      score: statsData.wisdom,
      modifier: Math.floor((statsData.wisdom - 10) / 2),
      savingThrow: false,
    },
    charisma: {
      score: statsData.charisma,
      modifier: Math.floor((statsData.charisma - 10) / 2),
      savingThrow: false,
    },
  };
};

/**
 * Transforms database character data into Character type
 * @param characterData - Raw character data from database
 * @param statsData - Raw stats data from database
 * @param equipmentData - Raw equipment data from database
 * @returns Transformed Character object
 */
export const transformCharacterData = (
  characterData: CharacterRow,
  statsData: CharacterStatsRow | null,
  equipmentData: CharacterEquipmentRow[] | null,
): Character => {
  const race = resolveRace(characterData.race);
  // #2701: personality envelope (traits/ideals/bonds/flaws + inspiration).
  const personalityEnvelope = parsePersonalityEnvelope(characterData.personality_notes);

  return {
    id: characterData.id,
    user_id: characterData.user_id,
    name: characterData.name,
    description: characterData.description,
    race,
    subrace: resolveSubrace(race, characterData.subrace),
    class: resolveClass(characterData.class),
    level: characterData.level,
    background: resolveBackground(characterData.background),
    // Combat seats this same stored value into combat_participants. Keep it on
    // the DTO so existing-character sheets do not replace equipped AC with 10 + DEX.
    armorClass: statsData?.armor_class ?? undefined,
    // character_stats is the server-authoritative source for combat HP. Keep
    // it on the hydrated character so the sheet cannot replace stored values
    // with a fresh formula.
    character_stats: statsData
      ? {
          strength: statsData.strength,
          dexterity: statsData.dexterity,
          constitution: statsData.constitution,
          intelligence: statsData.intelligence,
          wisdom: statsData.wisdom,
          charisma: statsData.charisma,
          armor_class: statsData.armor_class,
          max_hit_points: statsData.max_hit_points,
          current_hit_points: statsData.current_hit_points,
          // #2517: carried through so the sheet can show the end state.
          vital_state: statsData.vital_state ?? undefined,
          died_at: statsData.died_at ?? undefined,
        }
      : undefined,
    abilityScores: transformAbilityScores(statsData) || {
      strength: { score: 10, modifier: 0, savingThrow: false },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    },
    equipment: equipmentData?.map((item) => item.item_name) || [],
    experience: characterData.experience_points || 0,
    alignment: characterData.alignment || '',
    // Proficiencies carry the proficiency bonus onto skills and saves. Dropping
    // them here made the sheet report bare ability modifiers (issue #1827).
    skillProficiencies: parseOptionalProficiencyList(characterData.skill_proficiencies),
    expertiseProficiencies: parseOptionalProficiencyList(characterData.expertise_proficiencies),
    toolProficiencies: parseOptionalProficiencyList(characterData.tool_proficiencies),
    savingThrowProficiencies: parseSavingThrowProficiencies(
      characterData.saving_throw_proficiencies,
    ),
    languages: parseOptionalProficiencyList(characterData.languages),
    // Vision and Stealth
    visionTypes: parseJsonField<string[]>(characterData.vision_types, []),
    obscurement: characterData.obscurement || 'clear',
    isHidden: characterData.is_hidden || false,
    stealthCheckBonus: characterData.stealth_check_bonus || 0,
    // Magic Items
    inventory:
      equipmentData?.map((item) => ({
        itemId: item.id,
        itemType: item.item_type,
        description: item.description || undefined,
        quantity: item.quantity || 1,
        equipped: item.equipped || false,
        // Magic item properties
        isMagic: item.is_magic || false,
        magicBonus: item.magic_bonus || 0,
        magicProperties: parseJsonField<string[]>(item.magic_properties, []),
        requiresAttunement: item.requires_attunement || false,
        isAttuned: item.is_attuned || false,
        attunementRequirements: item.attunement_requirements || '',
        magicItemType: item.magic_item_type || '',
        magicItemRarity: item.magic_item_rarity || 'common',
        magicEffects: parseJsonField<Record<string, unknown>>(item.magic_effects, {}),
      })) || [],
    // AI-generated fields
    avatar_url: characterData.avatar_url,
    image_url: characterData.image_url,
    appearance: characterData.appearance,
    personality_traits: characterData.personality_traits,
    backstory_elements: characterData.backstory_elements,
    // #2701: without this, a successful save followed by the silent refresh
    // replaced freshly saved notes with undefined.
    sessionNotes: characterData.session_notes ?? undefined,
    background_image: characterData.background_image || undefined,
    // #2701: the sheet's personality arrays live in the personality_notes
    // envelope; without one they are empty (previous behavior). Legacy
    // plain-text notes survive inside the envelope as legacyNotes and are
    // surfaced here so the Personality Notes card shows them instead of
    // losing them on the first edit.
    personalityTraits: personalityEnvelope?.traits ?? [],
    ideals: personalityEnvelope?.ideals ?? [],
    bonds: personalityEnvelope?.bonds ?? [],
    flaws: personalityEnvelope?.flaws ?? [],
    inspiration: personalityEnvelope?.inspiration ?? false,
    personality_notes: personalityEnvelope?.legacyNotes,
    personalityIntegration: personalityEnvelope
      ? {
          activeTraits: [],
          inspirationTriggers: [],
          lastInspiration: personalityEnvelope.lastInspiration ?? undefined,
          inspirationHistory: personalityEnvelope.inspirationHistory.map((e) => ({
            ...e,
            source: e.source as 'trait' | 'ideal' | 'bond' | 'flaw' | 'dm',
          })),
        }
      : undefined,
    // Spell data supports both JSON arrays and legacy comma-separated strings.
    cantrips: parseSpellListField(characterData.cantrips),
    knownSpells: parseSpellListField(characterData.known_spells),
    preparedSpells: parseSpellListField(characterData.prepared_spells),
    ritualSpells: parseSpellListField(characterData.ritual_spells),
    classFeatures: readStoredClassFeatures(characterData.class_features),
  };
};
