import { aggregateHitDice, type RestHitDie } from './rest-api';

export type CharacterStatsPayload = Partial<{
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  armor_class: number;
  max_hit_points: number;
  current_hit_points: number;
  temporary_hit_points: number;
  initiative_bonus: number;
  speed: number;
}>;

export type CharacterPayload = Record<string, unknown> & {
  name: string;
  stats?: CharacterStatsPayload;
};

export type CampaignPayload = Record<string, unknown> & { name: string };

export const CHARACTER_FIELDS = [
  'name',
  'description',
  'race',
  'subrace',
  'class',
  'level',
  'alignment',
  'experience_points',
  'image_url',
  'avatar_url',
  'appearance',
  'personality_traits',
  'personality_notes',
  'backstory_elements',
  'background',
  'background_image',
  'theme',
  'session_notes',
  'campaign_id',
  'skill_proficiencies',
  'expertise_proficiencies',
  'tool_proficiencies',
  'saving_throw_proficiencies',
  'languages',
  'cantrips',
  'known_spells',
  'prepared_spells',
  'ritual_spells',
  'spell_slots',
  'pact_slots',
  'active_concentration',
  'class_features',
  'enhancement_selections',
  'fighting_styles',
  'copper_pieces',
  'silver_pieces',
  'electrum_pieces',
  'gold_pieces',
  'platinum_pieces',
  'damage_resistances',
  'damage_immunities',
  'damage_vulnerabilities',
  'vision_types',
  'obscurement',
  'is_hidden',
  'stealth_check_bonus',
  'class_levels',
  'total_level',
  'stats',
  'equipment',
  'inventory_items',
] as const;

export function prepareCharacterPayload(payload: Record<string, unknown>): CharacterPayload {
  const prepared: Record<string, unknown> = {};
  for (const field of CHARACTER_FIELDS) {
    if (payload[field] !== undefined) {
      prepared[field] = payload[field];
    }
  }
  for (const field of [
    'spell_slots',
    'pact_slots',
    'class_features',
    'enhancement_selections',
    'fighting_styles',
    'damage_resistances',
    'damage_immunities',
    'damage_vulnerabilities',
    'class_levels',
    'vision_types',
  ]) {
    if (typeof prepared[field] === 'string') {
      try {
        prepared[field] = JSON.parse(prepared[field] as string);
      } catch {
        /* preserve value */
      }
    }
  }
  return prepared as CharacterPayload;
}

export const CAMPAIGN_FIELDS = [
  'name',
  'description',
  'genre',
  'difficulty_level',
  'campaign_length',
  'tone',
  'setting',
  'setting_details',
  'thematic_elements',
  'status',
  'background_image',
  'art_style',
  'style_config',
  'rules_config',
] as const;

export function prepareCampaignPayload(payload: Record<string, unknown>): CampaignPayload {
  const prepared: Record<string, unknown> = {};
  for (const field of CAMPAIGN_FIELDS) {
    if (payload[field] !== undefined) {
      prepared[field] = payload[field];
    }
  }
  return prepared as CampaignPayload;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCharacter<T extends Record<string, any>>(character: T): T {
  // #264: fold the GET's snake_case hit_dice rows into the sheet's hitDice shape
  // ({ total, remaining, type }), the same aggregation the rest results use.
  const hitDiceRows = Array.isArray(character.hit_dice) ? character.hit_dice : null;
  const hitDice = hitDiceRows
    ? aggregateHitDice(
        hitDiceRows.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (row: Record<string, any>): RestHitDie => ({
            id: String(row.id ?? ''),
            characterId: String(row.character_id ?? character.id ?? ''),
            className: String(row.class_name ?? ''),
            dieType: String(row.die_type ?? ''),
            totalDice: Number(row.total_dice ?? 0),
            usedDice: Number(row.used_dice ?? 0),
          }),
        ),
      )
    : undefined;
  return {
    ...character,
    character_stats: character.stats ? [character.stats] : [],
    ...(hitDice ? { hitDice } : {}),
  };
}
