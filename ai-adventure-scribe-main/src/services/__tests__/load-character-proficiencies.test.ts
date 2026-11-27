/**
 * Issue #1827: the creation wizard persisted proficiencies correctly, but every
 * DB -> Character hydration path dropped them, so the sheet and the roll path
 * saw bare ability modifiers.
 *
 * These tests run the real loaders over a mocked API row and then feed the
 * result to the real modifier calculators, so a regression anywhere along that
 * chain fails here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadCharacterBySession } from '../load-character-by-session';
import { loadCharacterWithSpells } from '../load-character-with-spells';

import type { Character } from '@/types/character';

import { darkvisionRangeFor } from '@/data/races';
import {
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
} from '@/utils/character-proficiency-calculations';

const { getCharacter, getSession } = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { getCharacter, getSession },
}));

vi.mock('@/services/issue-1784-api', () => ({
  issue1784Api: { getCharacterEquipment: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../characterSpellApi', () => ({
  characterSpellService: { getCharacterSpells: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/** The row shape written for character 274de914-… (Forest Giant Monk 1, Sage). */
const monkRow = {
  id: '274de914-ad42-49fa-b038-8e458cf9980a',
  user_id: 'user_01KAT5E3WFD7NGE3C0TDHX2T5G',
  name: 'Claude',
  race: 'Forest Giant',
  class: 'Monk',
  level: 1,
  background: 'Sage',
  // join(',') — the delimiter transformCharacterForStorage writes
  skill_proficiencies: 'Arcana,History,Acrobatics,Athletics',
  saving_throw_proficiencies: 'strength,dexterity',
  tool_proficiencies: 'Calligrapher’s supplies',
  expertise_proficiencies: '',
  languages: ['Common', 'Giant'],
  character_stats: [
    {
      strength: 17,
      dexterity: 17,
      constitution: 17,
      intelligence: 18,
      wisdom: 16,
      charisma: 8,
      armor_class: 15,
    },
  ],
};

/** Narrows the loader's nullable return, failing the test if it came back empty. */
function loaded(character: Character | null | undefined): Character {
  expect(character).toBeTruthy();
  return character as Character;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCharacter.mockResolvedValue(monkRow);
  getSession.mockResolvedValue({ character_id: monkRow.id });
});

describe('loadCharacterWithSpells hydrates proficiencies (#1827)', () => {
  it('reads the persisted proficiency columns off the row', async () => {
    const character = await loadCharacterWithSpells(monkRow.id);

    expect(character?.skillProficiencies).toEqual(['Arcana', 'History', 'Acrobatics', 'Athletics']);
    expect(character?.savingThrowProficiencies).toEqual(['strength', 'dexterity']);
    expect(character?.toolProficiencies).toEqual(['Calligrapher’s supplies']);
    expect(character?.languages).toEqual(['Common', 'Giant']);
    // Empty column must stay undefined, not become [''].
    expect(character?.expertiseProficiencies).toBeUndefined();
  });

  it('produces proficiency-bearing skill and save modifiers', async () => {
    const character = await loadCharacterWithSpells(monkRow.id);
    const skills = calculateSkillModifiers(loaded(character));
    const saves = calculateSavingThrowModifiers(loaded(character));

    // Proficient skill = ability modifier + PB.
    expect(skills['Acrobatics'].modifier).toBe(5); // DEX +3, PB +2
    expect(skills['Arcana'].modifier).toBe(6); // INT +4, PB +2
    // Non-proficient skill = ability modifier alone.
    expect(skills['Perception'].modifier).toBe(3); // WIS +3, no PB
    // Proficient save = ability modifier + PB.
    expect(saves['strength'].modifier).toBe(5);
    expect(saves['dexterity'].modifier).toBe(5);
    expect(saves['wisdom'].modifier).toBe(3);
  });

  it('tolerates the ", " delimiter starter seeding writes', async () => {
    getCharacter.mockResolvedValue({
      ...monkRow,
      skill_proficiencies: 'Arcana, History, Acrobatics, Athletics',
    });

    const character = await loadCharacterWithSpells(monkRow.id);

    expect(character?.skillProficiencies).toEqual(['Arcana', 'History', 'Acrobatics', 'Athletics']);
    expect(calculateSkillModifiers(loaded(character))['Athletics'].modifier).toBe(5);
  });

  it('falls back to the class for a character with no persisted saves', async () => {
    // Template-derived characters: starter seeding never writes the column.
    getCharacter.mockResolvedValue({ ...monkRow, saving_throw_proficiencies: null });

    const character = await loadCharacterWithSpells(monkRow.id);
    const saves = calculateSavingThrowModifiers(loaded(character));

    expect(character?.savingThrowProficiencies).toBeUndefined();
    expect(saves['strength']).toEqual({ modifier: 5, proficient: true });
    expect(saves['dexterity']).toEqual({ modifier: 5, proficient: true });
    expect(saves['charisma']).toEqual({ modifier: -1, proficient: false });
  });
});

describe('loadCharacterBySession hydrates proficiencies (#1827)', () => {
  it('carries the same proficiencies through the session path', async () => {
    const character = await loadCharacterBySession('session-1');

    expect(character?.skillProficiencies).toEqual(['Arcana', 'History', 'Acrobatics', 'Athletics']);
    expect(character?.savingThrowProficiencies).toEqual(['strength', 'dexterity']);

    const skills = calculateSkillModifiers(loaded(character));
    expect(skills['Athletics'].modifier).toBe(5);
    expect(skills['Perception'].modifier).toBe(3);
  });
});

describe('character loaders preserve stored armor class (#2079)', () => {
  it('keeps the server-authoritative AC on both character hydration paths', async () => {
    const direct = await loadCharacterWithSpells(monkRow.id);
    const session = await loadCharacterBySession('session-1');

    expect(direct?.armorClass).toBe(15);
    expect(session?.armorClass).toBe(15);
  });
});

describe('loadCharacterBySession resolves subrace darkvision', () => {
  const elfDrowRow = {
    id: 'char-elf-drow-test',
    user_id: 'user_test_elf_drow',
    name: 'Test Elf Drow',
    race: 'Elf',
    subrace: 'Drow',
    class: 'Wizard',
    level: 1,
    background: 'Sage',
    skill_proficiencies: null,
    saving_throw_proficiencies: null,
    tool_proficiencies: null,
    expertise_proficiencies: null,
    languages: null,
    character_stats: [
      {
        strength: 10,
        dexterity: 14,
        constitution: 12,
        intelligence: 16,
        wisdom: 12,
        charisma: 10,
        armor_class: 12,
      },
    ],
  };

  const humanRow = {
    id: 'char-human-plain-test',
    user_id: 'user_test_human_plain',
    name: 'Test Human Plain',
    race: 'Human',
    subrace: null,
    class: 'Fighter',
    level: 1,
    background: null,
    skill_proficiencies: null,
    saving_throw_proficiencies: null,
    tool_proficiencies: null,
    expertise_proficiencies: null,
    languages: null,
    character_stats: [
      {
        strength: 12,
        dexterity: 10,
        constitution: 12,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        armor_class: 12,
      },
    ],
  };

  it('Drow hero reports 120 ft darkvision', async () => {
    getCharacter.mockResolvedValue(elfDrowRow);
    getSession.mockResolvedValue({ character_id: elfDrowRow.id });

    const character = await loadCharacterBySession('session-elf-drow');

    expect(character?.subrace?.name).toBe('Drow (Dark Elf)');
    expect(darkvisionRangeFor('Elf', character?.subrace?.name)).toBe(120);
  });

  it('plain Human has no subrace and no darkvision', async () => {
    getCharacter.mockResolvedValue(humanRow);
    getSession.mockResolvedValue({ character_id: humanRow.id });

    const character = await loadCharacterBySession('session-human-plain');

    expect(character?.subrace).toBeNull();
    expect(darkvisionRangeFor('Human', character?.subrace?.name)).toBeNull();
  });
});
