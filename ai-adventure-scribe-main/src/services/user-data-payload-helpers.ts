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
  'starter_campaign_id',
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
  return {
    ...character,
    character_stats: character.stats ? [character.stats] : [],
  };
}
