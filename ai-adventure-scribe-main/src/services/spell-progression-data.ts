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

/**
 * Standard D&D 5E spell progression tables.
 *
 * #617: spell_slots_N derive from shared/spell-slot-tables.ts (epic #616).
 * Cantrips/spells-known stay here — they are not slot tables.
 */
import { FULL_CASTER_SLOTS, WARLOCK_PACT_MAGIC } from '../../shared/spell-slot-tables';

const fullCasterRow = (
  character_level: number,
  extra: Omit<SpellProgression, 'character_level' | 'spell_slots_1' | 'spell_slots_2' | 'spell_slots_3' | 'spell_slots_4' | 'spell_slots_5' | 'spell_slots_6' | 'spell_slots_7' | 'spell_slots_8' | 'spell_slots_9'>,
): SpellProgression => {
  const slots = FULL_CASTER_SLOTS[character_level] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  return {
    character_level,
    ...extra,
    spell_slots_1: slots[0],
    spell_slots_2: slots[1],
    spell_slots_3: slots[2],
    spell_slots_4: slots[3],
    spell_slots_5: slots[4],
    spell_slots_6: slots[5],
    spell_slots_7: slots[6],
    spell_slots_8: slots[7],
    spell_slots_9: slots[8],
  };
};

const warlockRow = (
  character_level: number,
  extra: Omit<SpellProgression, 'character_level' | 'spell_slots_1' | 'spell_slots_2' | 'spell_slots_3' | 'spell_slots_4' | 'spell_slots_5' | 'spell_slots_6' | 'spell_slots_7' | 'spell_slots_8' | 'spell_slots_9'>,
): SpellProgression => {
  const pact = WARLOCK_PACT_MAGIC[character_level];
  return {
    character_level,
    ...extra,
    spell_slots_1: pact?.slots ?? 0,
    spell_slots_2: 0,
    spell_slots_3: 0,
    spell_slots_4: 0,
    spell_slots_5: 0,
    spell_slots_6: 0,
    spell_slots_7: 0,
    spell_slots_8: 0,
    spell_slots_9: 0,
  };
};

export const spellProgressionTables: Record<string, SpellProgression[]> = {
  Wizard: [
    fullCasterRow(1, { cantrips_known: 3, spells_prepared_formula: '1 + Int modifier' }),
    fullCasterRow(2, { cantrips_known: 3, spells_prepared_formula: '2 + Int modifier' }),
    fullCasterRow(3, { cantrips_known: 3, spells_prepared_formula: '3 + Int modifier' }),
    fullCasterRow(4, { cantrips_known: 4, spells_prepared_formula: '4 + Int modifier' }),
    fullCasterRow(5, { cantrips_known: 4, spells_prepared_formula: '5 + Int modifier' }),
  ],
  Sorcerer: [
    fullCasterRow(1, { cantrips_known: 4, spells_known: 2 }),
    fullCasterRow(2, { cantrips_known: 4, spells_known: 3 }),
    fullCasterRow(3, { cantrips_known: 4, spells_known: 4 }),
  ],
  Warlock: [
    warlockRow(1, { cantrips_known: 2, spells_known: 2 }),
    warlockRow(2, { cantrips_known: 2, spells_known: 3 }),
  ],
  Bard: [
    fullCasterRow(1, { cantrips_known: 2, spells_known: 4 }),
    fullCasterRow(2, { cantrips_known: 2, spells_known: 5 }),
  ],
  Cleric: [
    fullCasterRow(1, { cantrips_known: 3, spells_prepared_formula: '1 + Wis modifier' }),
    fullCasterRow(2, { cantrips_known: 3, spells_prepared_formula: '2 + Wis modifier' }),
  ],
  Druid: [
    fullCasterRow(1, { cantrips_known: 2, spells_prepared_formula: '1 + Wis modifier' }),
    fullCasterRow(2, { cantrips_known: 2, spells_prepared_formula: '2 + Wis modifier' }),
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
