import { describe, it, expect } from 'vitest';

import { calculateMulticlassSpellcasting } from '../spellcasting';

import type { Character } from '@/types/character';

describe('calculateMulticlassSpellcasting', () => {
  it('should return empty result for character without classes', () => {
    const character = {
      name: 'No Class',
      classLevels: [],
    } as unknown as Character;

    const result = calculateMulticlassSpellcasting(character);
    expect(result.spellcastingClasses).toHaveLength(0);
    expect(result.combinedCasterLevel).toBe(0);
    expect(result.spellSlots).toHaveLength(0);
  });

  it('should calculate spellcasting for a single full caster', () => {
    const character = {
      name: 'Wizard',
      classLevels: [
        { className: 'Wizard', level: 5 },
      ],
    } as unknown as Character;

    const result = calculateMulticlassSpellcasting(character);
    expect(result.spellcastingClasses).toHaveLength(1);
    expect(result.spellcastingClasses[0]).toEqual({
      className: 'Wizard',
      level: 5,
      casterType: 'full',
    });
    expect(result.combinedCasterLevel).toBe(5);
    expect(result.spellSlots).toEqual([4, 3, 2]); // Level 5 full caster slots
  });

  it('should combine multiple full casters correctly', () => {
    const character = {
      name: 'Cleric/Wizard',
      classLevels: [
        { className: 'Cleric', level: 3 },
        { className: 'Wizard', level: 2 },
      ],
    } as unknown as Character;

    const result = calculateMulticlassSpellcasting(character);
    expect(result.combinedCasterLevel).toBe(5);
    expect(result.spellSlots).toEqual([4, 3, 2]);
  });

  it('should handle half casters correctly (rounded down)', () => {
    const character = {
      name: 'Paladin',
      classLevels: [
        { className: 'Paladin', level: 5 },
      ],
    } as unknown as Character;

    const result = calculateMulticlassSpellcasting(character);
    expect(result.combinedCasterLevel).toBe(2); // floor(5/2)
    expect(result.spellSlots).toEqual([3]); // Level 2 caster slots (only 1st level slots)
  });

  it('should exclude warlock (pact magic) from combined caster level', () => {
    const character = {
      name: 'Warlock/Wizard',
      classLevels: [
        { className: 'Warlock', level: 5 },
        { className: 'Wizard', level: 3 },
      ],
    } as unknown as Character;

    const result = calculateMulticlassSpellcasting(character);
    expect(result.spellcastingClasses).toHaveLength(2);
    expect(result.combinedCasterLevel).toBe(3); // Only Wizard counts
    expect(result.spellSlots).toEqual([4, 2]); // Level 3 caster slots
  });

  it('should handle third casters (fighter/rogue) correctly', () => {
    const character = {
      name: 'Fighter/Wizard',
      classLevels: [
        { className: 'Fighter', level: 4 },
        { className: 'Wizard', level: 2 },
      ],
    } as unknown as Character;

    const result = calculateMulticlassSpellcasting(character);
    expect(result.combinedCasterLevel).toBe(3); // 2 (Wizard) + floor(4/3) = 1
    expect(result.spellSlots).toEqual([4, 2]);
  });
});
