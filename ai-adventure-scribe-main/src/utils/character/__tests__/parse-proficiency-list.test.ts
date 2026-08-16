import { describe, it, expect } from 'vitest';

import {
  parseProficiencyList,
  parseOptionalProficiencyList,
  parseSavingThrowProficiencies,
} from '@/utils/character/parse-proficiency-list';

describe('parseProficiencyList', () => {
  it('splits the delimiter the creation wizard writes', () => {
    // transformCharacterForStorage: join(',')
    expect(parseProficiencyList('Arcana,History,Acrobatics')).toEqual([
      'Arcana',
      'History',
      'Acrobatics',
    ]);
  });

  it('splits the delimiter starter seeding writes', () => {
    // buildStarterCharacterSeed: join(', ')
    expect(parseProficiencyList('Arcana, History, Acrobatics')).toEqual([
      'Arcana',
      'History',
      'Acrobatics',
    ]);
  });

  it('drops empty segments rather than emitting blank proficiencies', () => {
    expect(parseProficiencyList('')).toEqual([]);
    expect(parseProficiencyList(',')).toEqual([]);
    expect(parseProficiencyList('Arcana,,History,')).toEqual(['Arcana', 'History']);
  });

  it('passes an already-parsed array through', () => {
    expect(parseProficiencyList(['Common', ' Giant '])).toEqual(['Common', 'Giant']);
  });

  it('treats a missing column as empty', () => {
    expect(parseProficiencyList(null)).toEqual([]);
    expect(parseProficiencyList(undefined)).toEqual([]);
  });
});

describe('parseOptionalProficiencyList', () => {
  it('returns undefined for an empty column so the class fallback still applies', () => {
    expect(parseOptionalProficiencyList(null)).toBeUndefined();
    expect(parseOptionalProficiencyList('')).toBeUndefined();
    expect(parseOptionalProficiencyList([])).toBeUndefined();
  });

  it('returns the list when the column holds one', () => {
    expect(parseOptionalProficiencyList('Stealth')).toEqual(['Stealth']);
  });
});

describe('parseSavingThrowProficiencies', () => {
  it('parses the persisted lowercase ability names', () => {
    expect(parseSavingThrowProficiencies('strength,dexterity')).toEqual(['strength', 'dexterity']);
  });

  it('normalises case', () => {
    expect(parseSavingThrowProficiencies('Strength, DEXTERITY')).toEqual([
      'strength',
      'dexterity',
    ]);
  });

  it('drops values that are not ability names', () => {
    expect(parseSavingThrowProficiencies('strength,Athletics,dex')).toEqual(['strength']);
  });

  it('returns undefined when nothing survives, so the class fallback applies', () => {
    expect(parseSavingThrowProficiencies(null)).toBeUndefined();
    expect(parseSavingThrowProficiencies('Athletics')).toBeUndefined();
  });
});
