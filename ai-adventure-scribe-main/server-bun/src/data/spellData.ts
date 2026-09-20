/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
import nonSrdSupplement from '../../../src/data/spells/non-srd-supplement.json';
import srdSpells from '../../../src/data/srd/spells.json';

// Server-side spell data - converted from the bundled SRD dataset.
// This provides comprehensive D&D 5E spell data without requiring database queries

export interface Spell {
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  duration: string;
  description: string;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  materialComponents?: string;
  concentration: boolean;
  ritual: boolean;
  damage?: boolean;
  attackSave?: string;
  damageEffect?: string;
  classes?: string[];
  attackType?: 'melee' | 'ranged';
  saveAbility?: string;
  saveSuccess?: string;
  damageType?: string;
  damageByLevel?: Record<string, string>;
  areaOfEffect?: {
    shape: 'sphere' | 'cone' | 'cube' | 'line';
    sizeFeet: number;
  };
  forcedMove?: {
    distanceFeet: number;
    direction: 'away' | 'toward';
  };
}

/**
 * The deliberately narrow player-combat spell surface for issue #2085.
 *
 * Keep this list server-owned and explicit: the combat resolver must not silently grow to
 * whatever happens to be present in the full SRD table, and an unlisted spell must be refused
 * rather than narrated as though it resolved.
 */
export const PLAYER_COMBAT_SPELL_IDS = [
  'acid-splash',
  'fire-bolt',
  'ray-of-frost',
  'chill-touch',
  'eldritch-blast',
  'sacred-flame',
  'magic-missile',
] as const;

const PLAYER_COMBAT_SPELL_ID_SET = new Set<string>(PLAYER_COMBAT_SPELL_IDS);

export function isPlayerCombatSpell(spell: Spell | undefined): boolean {
  return !!spell && PLAYER_COMBAT_SPELL_ID_SET.has(spell.id);
}

// Class-to-spell mappings for D&D 5E classes
export const classSpellMappings = {
  Bard: {
    cantrips: [
      'blade-ward', 'friends', 'mage-hand', 'mending', 'message',
      'minor-illusion', 'prestidigitation', 'true-strike', 'vicious-mockery'
    ],
    spells: [
      'animal-friendship', 'bane', 'charm-person', 'comprehend-languages',
      'cure-wounds', 'detect-magic', 'disguise-self', 'dissonant-whispers',
      'faerie-fire', 'feather-fall', 'healing-word', 'heroism', 'identify',
      'illusory-script', 'longstrider', 'silent-image', 'sleep',
      'speak-with-animals', 'tashas-hideous-laughter', 'thunderwave'
    ]
  },
  Druid: {
    cantrips: [
      'druidcraft', 'guidance', 'mending', 'poison-spray',
      'produce-flame', 'resistance', 'thorn-whip'
    ],
    spells: [
      'animal-friendship', 'charm-person', 'cure-wounds',
      'detect-magic', 'entangle', 'faerie-fire', 'goodberry', 'healing-word',
      'longstrider', 'speak-with-animals', 'thunderwave'
    ]
  },
  Cleric: {
    cantrips: [
      'guidance', 'light', 'mending', 'resistance', 'thorn-whip'
    ],
    spells: [
      'bless', 'cure-wounds', 'detect-magic', 'healing-word'
    ]
  },
  Sorcerer: {
    cantrips: [
      'acid-splash', 'chill-touch', 'dancing-lights', 'fire-bolt', 'light',
      'mage-hand', 'mending', 'message', 'minor-illusion', 'poison-spray',
      'prestidigitation', 'ray-of-frost', 'shocking-grasp', 'true-strike'
    ],
    spells: [
      'charm-person', 'comprehend-languages', 'detect-magic',
      'disguise-self', 'feather-fall', 'silent-image', 'sleep'
    ]
  },
  Warlock: {
    cantrips: [
      'blade-ward', 'chill-touch', 'eldritch-blast', 'friends',
      'mage-hand', 'minor-illusion', 'prestidigitation'
    ],
    spells: [
      'charm-person', 'comprehend-languages'
    ]
  },
  Wizard: {
    cantrips: [
      'acid-splash', 'chill-touch', 'dancing-lights', 'fire-bolt', 'light',
      'mage-hand', 'mending', 'message', 'minor-illusion', 'poison-spray',
      'prestidigitation', 'ray-of-frost', 'shocking-grasp', 'true-strike'
    ],
    spells: [
      'charm-person', 'comprehend-languages', 'detect-magic',
      'disguise-self', 'feather-fall', 'identify', 'illusory-script',
      'silent-image', 'sleep'
    ]
  }
};

const sourceSpells = [...(srdSpells as unknown as any[]), ...(nonSrdSupplement as unknown as any[])];

// Canonical SRD catalog, including spell levels 0-9, plus explicit non-SRD supplements.
export const allSpells: Spell[] = sourceSpells.map((spell) => ({
  id: spell.id,
  name: spell.name,
  level: spell.level,
  school: spell.school,
  castingTime: spell.casting_time,
  range: spell.range_text,
  duration: spell.duration,
  description: spell.description,
  verbal: spell.components_verbal,
  somatic: spell.components_somatic,
  material: spell.components_material,
  materialComponents: spell.material_components,
  concentration: spell.concentration,
  ritual: spell.ritual,
  damage: Boolean(spell.damage),
  damageEffect: spell.damage,
  classes: spell.classes,
  attackType: spell.attack_type as 'melee' | 'ranged' | undefined,
  saveAbility: spell.save_ability,
  saveSuccess: spell.save_success,
  damageType: spell.damage_type,
  damageByLevel: spell.damage_by_level,
  areaOfEffect: spell.area_of_effect
    ? { shape: spell.area_of_effect.shape, sizeFeet: spell.area_of_effect.size_feet }
    : undefined,
  forcedMove: spell.forced_move
    ? {
        distanceFeet: spell.forced_move.distance_feet,
        direction: spell.forced_move.direction,
      }
    : undefined,
}));

// Helper functions
export function getClassSpells(className: string): { cantrips: Spell[], spells: Spell[] } {
  const classKey = className.toLowerCase();
  const available = allSpells.filter((spell) => spell.classes?.includes(classKey));

  return {
    cantrips: available.filter((spell) => spell.level === 0),
    spells: available.filter((spell) => spell.level > 0),
  };
}

export function getSpellById(id: string): Spell | undefined {
  return allSpells.find(spell => spell.id === id);
}

export function getSpellByName(name: string): Spell | undefined {
  const normalized = name.trim().toLowerCase();
  return allSpells.find((spell) => spell.name.toLowerCase() === normalized);
}

export function getSpellsByLevel(level: number): Spell[] {
  return allSpells.filter(spell => spell.level === level);
}

export function getSpellsBySchool(school: string): Spell[] {
  return allSpells.filter(spell => spell.school === school);
}

// Spell progression data for D&D 5E classes
export const spellProgression = {
  Bard: [
    { character_level: 1, cantrips_known: 2, spells_known: 4, spell_slots_1: 2, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 2, cantrips_known: 2, spells_known: 5, spell_slots_1: 3, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 3, cantrips_known: 2, spells_known: 6, spell_slots_1: 4, spell_slots_2: 2, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 4, cantrips_known: 3, spells_known: 7, spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 5, cantrips_known: 3, spells_known: 8, spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 2, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 }
  ],
  Druid: [
    { character_level: 1, cantrips_known: 2, spells_prepared_formula: '1 + Wis modifier', spell_slots_1: 2, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 2, cantrips_known: 2, spells_prepared_formula: '2 + Wis modifier', spell_slots_1: 3, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 3, cantrips_known: 2, spells_prepared_formula: '3 + Wis modifier', spell_slots_1: 4, spell_slots_2: 2, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 4, cantrips_known: 3, spells_prepared_formula: '4 + Wis modifier', spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 5, cantrips_known: 3, spells_prepared_formula: '5 + Wis modifier', spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 2, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 }
  ],
  Cleric: [
    { character_level: 1, cantrips_known: 3, spells_prepared_formula: '1 + Wis modifier', spell_slots_1: 2, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 2, cantrips_known: 3, spells_prepared_formula: '2 + Wis modifier', spell_slots_1: 3, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 3, cantrips_known: 3, spells_prepared_formula: '3 + Wis modifier', spell_slots_1: 4, spell_slots_2: 2, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 4, cantrips_known: 4, spells_prepared_formula: '4 + Wis modifier', spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 5, cantrips_known: 4, spells_prepared_formula: '5 + Wis modifier', spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 2, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 }
  ],
  Sorcerer: [
    { character_level: 1, cantrips_known: 4, spells_known: 2, spell_slots_1: 2, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 2, cantrips_known: 4, spells_known: 3, spell_slots_1: 3, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 3, cantrips_known: 4, spells_known: 4, spell_slots_1: 4, spell_slots_2: 2, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 4, cantrips_known: 5, spells_known: 5, spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 5, cantrips_known: 5, spells_known: 6, spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 2, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 }
  ],
  Warlock: [
    { character_level: 1, cantrips_known: 2, spells_known: 1, spell_slots_1: 1, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 2, cantrips_known: 2, spells_known: 2, spell_slots_1: 2, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 3, cantrips_known: 2, spells_known: 3, spell_slots_1: 0, spell_slots_2: 2, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 4, cantrips_known: 3, spells_known: 4, spell_slots_1: 0, spell_slots_2: 2, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 5, cantrips_known: 3, spells_known: 5, spell_slots_1: 0, spell_slots_2: 0, spell_slots_3: 2, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 }
  ],
  Wizard: [
    { character_level: 1, cantrips_known: 3, spells_prepared_formula: '1 + Int modifier', spell_slots_1: 2, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 2, cantrips_known: 3, spells_prepared_formula: '2 + Int modifier', spell_slots_1: 3, spell_slots_2: 0, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 3, cantrips_known: 3, spells_prepared_formula: '3 + Int modifier', spell_slots_1: 4, spell_slots_2: 2, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 4, cantrips_known: 4, spells_prepared_formula: '4 + Int modifier', spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 0, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 },
    { character_level: 5, cantrips_known: 4, spells_prepared_formula: '5 + Int modifier', spell_slots_1: 4, spell_slots_2: 3, spell_slots_3: 2, spell_slots_4: 0, spell_slots_5: 0, spell_slots_6: 0, spell_slots_7: 0, spell_slots_8: 0, spell_slots_9: 0 }
  ]
};

// Spellcasting classes data for D&D 5E
export const spellcastingClasses = [
  {
    id: 'bard',
    name: 'Bard',
    spellcasting_ability: 'Charisma',
    caster_type: 'full',
    spell_slots_start_level: 1
  },
  {
    id: 'cleric',
    name: 'Cleric',
    spellcasting_ability: 'Wisdom',
    caster_type: 'full',
    spell_slots_start_level: 1
  },
  {
    id: 'druid',
    name: 'Druid',
    spellcasting_ability: 'Wisdom',
    caster_type: 'full',
    spell_slots_start_level: 1
  },
  {
    id: 'sorcerer',
    name: 'Sorcerer',
    spellcasting_ability: 'Charisma',
    caster_type: 'full',
    spell_slots_start_level: 1
  },
  {
    id: 'warlock',
    name: 'Warlock',
    spellcasting_ability: 'Charisma',
    caster_type: 'pact',
    spell_slots_start_level: 1
  },
  {
    id: 'wizard',
    name: 'Wizard',
    spellcasting_ability: 'Intelligence',
    caster_type: 'full',
    spell_slots_start_level: 1
  },
  {
    id: 'paladin',
    name: 'Paladin',
    spellcasting_ability: 'Charisma',
    caster_type: 'half',
    spell_slots_start_level: 2
  },
  {
    id: 'ranger',
    name: 'Ranger',
    spellcasting_ability: 'Wisdom',
    caster_type: 'half',
    spell_slots_start_level: 2
  }
];
