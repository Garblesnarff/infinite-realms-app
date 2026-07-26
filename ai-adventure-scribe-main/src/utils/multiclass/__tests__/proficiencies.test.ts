import { describe, it, expect, vi } from 'vitest';

import { calculateMulticlassProficiencies } from '../proficiencies';

import type * as levelProgression from '@/data/levelProgression';
import type { Character } from '@/types/character';

// Mock levelProgression to add a custom class for testing the || 0 fallback
vi.mock('@/data/levelProgression', async (importOriginal) => {
  const original = await importOriginal<typeof levelProgression>();
  return {
    ...original,
    multiclassProficiencies: {
      ...original.multiclassProficiencies,
      customclass: {
        skillChoices: ['Any'],
        // numSkillChoices is intentionally omitted to test the || 0 fallback
      },
    },
  };
});

describe('calculateMulticlassProficiencies', () => {
  it('should return empty proficiencies for a character with no classes', () => {
    const character = {
      name: 'No Class',
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);
    expect(result).toEqual({
      armor: [],
      weapons: [],
      tools: [],
      savingThrows: [],
      skillChoices: [],
      numSkillChoices: 0,
    });
  });

  it('should get proficiencies from first class when character has a single class', () => {
    const character = {
      name: 'Rogue Only',
      class: {
        name: 'Rogue',
        savingThrowProficiencies: ['dexterity', 'intelligence'],
      },
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);
    expect(result.armor).toEqual(['Light armor']);
    expect(result.weapons).toEqual([
      'Simple weapons',
      'Hand crossbows',
      'Longswords',
      'Rapiers',
      'Shortswords',
    ]);
    expect(result.tools).toEqual(["Thieves' tools"]);
    expect(result.savingThrows).toEqual(['dexterity', 'intelligence']);
    expect(result.numSkillChoices).toBe(1);
    expect(result.skillChoices).toHaveLength(11); // Rogue skills list
  });

  it('should combine and deduplicate proficiencies from multiple classes', () => {
    const character = {
      name: 'Fighter Rogue Multiclass',
      class: {
        name: 'Fighter',
        savingThrowProficiencies: ['strength', 'constitution'],
      },
      classLevels: [
        { className: 'Fighter', level: 2 },
        { className: 'Rogue', level: 1 },
      ],
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);

    // Fighter first-class armor: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields']
    // Rogue additional-class armor: ['Light armor']
    // Deduplicated result should contain Fighter's armor (Light armor is not duplicated)
    expect(result.armor).toContain('Light armor');
    expect(result.armor).toContain('Medium armor');
    expect(result.armor).toContain('Heavy armor');
    expect(result.armor).toContain('Shields');
    expect(result.armor).toHaveLength(4);

    // Weapons from Fighter + Rogue deduplicated
    expect(result.weapons).toContain('Simple weapons');
    expect(result.weapons).toContain('Martial weapons');
    expect(result.weapons).toContain('Hand crossbows');
    expect(result.weapons).toContain('Longswords');
    expect(result.weapons).toContain('Rapiers');
    expect(result.weapons).toContain('Shortswords');
    expect(result.weapons).toHaveLength(6);

    // Tools should be added from Rogue additional class (since Rogue is in classLevels)
    expect(result.tools).toEqual(["Thieves' tools"]);

    // Saving throws should only come from Fighter (first class)
    expect(result.savingThrows).toEqual(['strength', 'constitution']);
  });

  it('should handle additional classes with no armor or tools defined', () => {
    const character = {
      name: 'Fighter Monk Multiclass',
      class: {
        name: 'Fighter',
        savingThrowProficiencies: ['strength', 'constitution'],
      },
      classLevels: [
        { className: 'Fighter', level: 2 },
        { className: 'Monk', level: 1 }, // Monk has weapons, but no armor/tools in multiclassProficiencies
      ],
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);

    // Fighter armor is retained
    expect(result.armor).toContain('Heavy armor');
    expect(result.armor).toHaveLength(4);

    // Monk weapons are merged
    expect(result.weapons).toContain('Shortswords');
    expect(result.weapons).toHaveLength(3); // Simple weapons, Martial weapons, Shortswords

    // Tools should remain empty
    expect(result.tools).toEqual([]);
  });

  it('should cover the false condition for already added armor and tools in additional classes', () => {
    const character = {
      name: 'Rogue Rogue Multiclass',
      class: {
        name: 'Rogue',
        savingThrowProficiencies: ['dexterity', 'intelligence'],
      },
      classLevels: [
        { className: 'Rogue', level: 1 },
        { className: 'Rogue', level: 1 }, // Second Rogue level will have duplicate armor and tools
      ],
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);

    // Armor and tools should remain exactly the same without duplicates
    expect(result.armor).toEqual(['Light armor']);
    expect(result.tools).toEqual(["Thieves' tools"]);
  });

  it('should only add skill choices from the first class', () => {
    const character = {
      name: 'Rogue Cleric Multiclass',
      class: {
        name: 'Rogue',
        savingThrowProficiencies: ['dexterity', 'intelligence'],
      },
      classLevels: [
        { className: 'Rogue', level: 1 },
        { className: 'Cleric', level: 1 },
      ],
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);
    // Skill choices and numSkillChoices should match Rogue, Cleric skill choices are skipped
    expect(result.numSkillChoices).toBe(1);
    expect(result.skillChoices).toContain('Stealth');
    expect(result.skillChoices).not.toContain('Religion'); // Cleric-specific skill choices should not be merged
  });

  it('should gracefully handle first class with no defined proficiencies', () => {
    const character = {
      name: 'Totally Unknown Class Caster',
      class: {
        name: 'TotallyUnknownClass',
        savingThrowProficiencies: ['charisma'],
      },
      classLevels: [
        { className: 'TotallyUnknownClass', level: 1 },
        { className: 'UnknownClass', level: 1 }, // Tests || {} fallback in additional classes too
      ],
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);
    // TotallyUnknownClass is not in multiclassProficiencies, tests || {} fallback in line 42
    expect(result.armor).toEqual([]);
    expect(result.weapons).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.savingThrows).toEqual(['charisma']);
    expect(result.skillChoices).toEqual([]);
    expect(result.numSkillChoices).toBe(0);
  });

  it('should fallback to 0 when first class has skill choices but no numSkillChoices', () => {
    const character = {
      name: 'Custom Class Caster',
      class: {
        name: 'CustomClass',
        savingThrowProficiencies: ['charisma'],
      },
    } as unknown as Character;

    const result = calculateMulticlassProficiencies(character);
    // customclass from the mock has skillChoices but no numSkillChoices, tests || 0 fallback in line 87
    expect(result.skillChoices).toEqual(['Any']);
    expect(result.numSkillChoices).toBe(0);
  });
});
