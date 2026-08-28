import { describe, expect, it } from 'bun:test';

import { parseProficiencyList } from '../../../lib/parse-proficiency-list.js';
import {
  calculateCompanionRollModifier,
  type StoredRollCharacter,
  type StoredRollStats,
} from '../companion-roll.js';

const stats: StoredRollStats = {
  strength: 10,
  dexterity: 14,
  constitution: 12,
  intelligence: 8,
  wisdom: 10,
  charisma: 16,
};

const character: StoredRollCharacter = {
  level: 5,
  skillProficiencies: 'Stealth, Persuasion',
  expertiseProficiencies: 'Stealth',
  savingThrowProficiencies: 'wisdom, charisma',
};

describe('WebMCP companion roll rules', () => {
  it('parses both stored proficiency delimiters before comparing names', () => {
    expect(parseProficiencyList('Arcana, History, sleight_of_hand')).toEqual([
      'Arcana',
      'History',
      'sleight_of_hand',
    ]);
  });

  it('matches the stored skill and expertise rules from #1878', () => {
    const result = calculateCompanionRollModifier('skill', 'stealth', character, stats);

    expect(result.modifier).toBe(8); // DEX +2 plus double level-5 proficiency (+6)
    expect(result.isProficient).toBe(true);
    expect(result.breakdown).toEqual(['1d20', 'DEX +2', 'Prof +6']);
  });

  it('adds stored saving-throw proficiency and never trusts a client modifier', () => {
    const result = calculateCompanionRollModifier('save', 'CHA', character, stats);

    expect(result.modifier).toBe(6); // CHA +3 plus the stored +3 proficiency bonus
    expect(result.breakdown).toEqual(['1d20', 'CHA +3', 'Prof +3']);
  });

  it('uses only the stored ability modifier for an unproficient ability roll', () => {
    const result = calculateCompanionRollModifier('ability', 'intelligence', character, stats);

    expect(result.modifier).toBe(-1);
    expect(result.isProficient).toBe(false);
    expect(result.breakdown).toEqual(['1d20', 'INT -1']);
  });

  it('rejects names outside the explicit skill and ability vocabulary', () => {
    expect(() => calculateCompanionRollModifier('skill', 'cooking', character, stats)).toThrow(
      'Unknown skill: cooking',
    );
  });
});
