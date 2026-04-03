export interface SpellProgression {
  character_level: number;
  cantrips_known: number;
  spells_known?: number;
  spells_prepared_formula?: string;
  spell_slots_1: number;
  spell_slots_2: number;
  spell_slots_3: number;
  spell_slots_4: number;
  spell_slots_5: number;
  spell_slots_6: number;
  spell_slots_7: number;
  spell_slots_8: number;
  spell_slots_9: number;
}

export interface SpellcastingClass {
  id: string;
  name: string;
  spellcasting_ability: string;
  caster_type: 'full' | 'half' | 'third' | 'pact';
  spell_slots_start_level: number;
}

export interface MulticlassSpellSlots {
  caster_level: number;
  spell_slots_1: number;
  spell_slots_2: number;
  spell_slots_3: number;
  spell_slots_4: number;
  spell_slots_5: number;
  spell_slots_6: number;
  spell_slots_7: number;
  spell_slots_8: number;
  spell_slots_9: number;
}

export interface MulticlassCalculation {
  totalCasterLevel: number;
  spellSlots: MulticlassSpellSlots | null;
  pactMagicSlots: { level: number; slots: number } | null;
}

// Standard D&D 5E spell progression tables
export const spellProgressionTables: Record<string, SpellProgression[]> = {
  Wizard: [
    {
      character_level: 1,
      cantrips_known: 3,
      spells_prepared_formula: '1 + Int modifier',
      spell_slots_1: 2,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 2,
      cantrips_known: 3,
      spells_prepared_formula: '2 + Int modifier',
      spell_slots_1: 3,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 3,
      cantrips_known: 3,
      spells_prepared_formula: '3 + Int modifier',
      spell_slots_1: 4,
      spell_slots_2: 2,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 4,
      cantrips_known: 4,
      spells_prepared_formula: '4 + Int modifier',
      spell_slots_1: 4,
      spell_slots_2: 3,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 5,
      cantrips_known: 4,
      spells_prepared_formula: '5 + Int modifier',
      spell_slots_1: 4,
      spell_slots_2: 3,
      spell_slots_3: 2,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
  ],
  Sorcerer: [
    {
      character_level: 1,
      cantrips_known: 4,
      spells_known: 2,
      spell_slots_1: 2,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 2,
      cantrips_known: 4,
      spells_known: 3,
      spell_slots_1: 3,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 3,
      cantrips_known: 4,
      spells_known: 4,
      spell_slots_1: 4,
      spell_slots_2: 2,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
  ],
  Warlock: [
    {
      character_level: 1,
      cantrips_known: 2,
      spells_known: 2,
      spell_slots_1: 1,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 2,
      cantrips_known: 2,
      spells_known: 3,
      spell_slots_1: 2,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
  ],
  Bard: [
    {
      character_level: 1,
      cantrips_known: 2,
      spells_known: 4,
      spell_slots_1: 2,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 2,
      cantrips_known: 2,
      spells_known: 5,
      spell_slots_1: 3,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
  ],
  Cleric: [
    {
      character_level: 1,
      cantrips_known: 3,
      spells_prepared_formula: '1 + Wis modifier',
      spell_slots_1: 2,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 2,
      cantrips_known: 3,
      spells_prepared_formula: '2 + Wis modifier',
      spell_slots_1: 3,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
  ],
  Druid: [
    {
      character_level: 1,
      cantrips_known: 2,
      spells_prepared_formula: '1 + Wis modifier',
      spell_slots_1: 2,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
    {
      character_level: 2,
      cantrips_known: 2,
      spells_prepared_formula: '2 + Wis modifier',
      spell_slots_1: 3,
      spell_slots_2: 0,
      spell_slots_3: 0,
      spell_slots_4: 0,
      spell_slots_5: 0,
      spell_slots_6: 0,
      spell_slots_7: 0,
      spell_slots_8: 0,
      spell_slots_9: 0,
    },
  ],
};

export const spellcastingClasses: SpellcastingClass[] = [
  {
    id: 'wizard',
    name: 'Wizard',
    spellcasting_ability: 'Intelligence',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'sorcerer',
    name: 'Sorcerer',
    spellcasting_ability: 'Charisma',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'warlock',
    name: 'Warlock',
    spellcasting_ability: 'Charisma',
    caster_type: 'pact',
    spell_slots_start_level: 1,
  },
  {
    id: 'bard',
    name: 'Bard',
    spellcasting_ability: 'Charisma',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'cleric',
    name: 'Cleric',
    spellcasting_ability: 'Wisdom',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'druid',
    name: 'Druid',
    spellcasting_ability: 'Wisdom',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
];
