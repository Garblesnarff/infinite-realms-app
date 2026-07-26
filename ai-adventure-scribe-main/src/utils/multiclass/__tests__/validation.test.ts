import { describe, it, expect } from 'vitest';

import { validateMulticlass } from '../validation';

import type { Character, CharacterClass } from '@/types/character';

describe('validateMulticlass', () => {
  it('should return allowed with empty requirements if character has no ability scores', () => {
    const character = {
      name: 'No Scores',
      class: { name: 'Wizard' },
    } as unknown as Character;

    const newClass = { name: 'Fighter' } as CharacterClass;

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(true);
    expect(result.requirements).toEqual([]);
    expect(result.missingRequirements).toEqual([]);
  });

  it('should validate successfully when character meets all requirements for multiclassing OUT and INTO', () => {
    const character = {
      name: 'Strong Wizard',
      class: { name: 'Wizard' },
      abilityScores: {
        strength: { score: 13, modifier: 1 },
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 13, modifier: 1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
    } as unknown as Character;

    const newClass = { name: 'Barbarian' } as CharacterClass; // Requires Strength 13

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(true);
    expect(result.requirements).toEqual([]);
    expect(result.missingRequirements).toEqual([]);
  });

  it('should fail validation when character fails to multiclass OUT (missing current class requirement)', () => {
    const character = {
      name: 'Weak Wizard',
      class: { name: 'Wizard' }, // Requires Intelligence 13
      abilityScores: {
        strength: { score: 13, modifier: 1 },
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 10, modifier: 0 }, // Too low
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
    } as unknown as Character;

    const newClass = { name: 'Barbarian' } as CharacterClass; // Requires Strength 13

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(false);
    expect(result.requirements).toContain('Wizard: Intelligence 13+');
    expect(result.missingRequirements).toContain('Wizard: Intelligence 13+');
  });

  it('should fail validation when character fails to multiclass INTO (missing new class requirement)', () => {
    const character = {
      name: 'Smart Wizard',
      class: { name: 'Wizard' }, // Requires Intelligence 13
      abilityScores: {
        strength: { score: 10, modifier: 0 }, // Too low for Barbarian
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 13, modifier: 1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
    } as unknown as Character;

    const newClass = { name: 'Barbarian' } as CharacterClass; // Requires Strength 13

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(false);
    expect(result.requirements).toContain('Barbarian: Strength 13+');
    expect(result.missingRequirements).toContain('Barbarian: Strength 13+');
  });

  it('should check requirements for all existing classes from classLevels array', () => {
    const character = {
      name: 'Wizard Cleric Multiclass',
      classLevels: [
        { className: 'Wizard', level: 3 }, // Requires Intelligence 13
        { className: 'Cleric', level: 1 }, // Requires Wisdom 13
      ],
      abilityScores: {
        strength: { score: 13, modifier: 1 },
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 10, modifier: 0 }, // Missing
        wisdom: { score: 10, modifier: 0 }, // Missing
        charisma: { score: 10, modifier: 0 },
      },
    } as unknown as Character;

    const newClass = { name: 'Barbarian' } as CharacterClass; // Requires Strength 13

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(false);
    expect(result.requirements).toContain('Wizard: Intelligence 13+');
    expect(result.requirements).toContain('Cleric: Wisdom 13+');
    expect(result.missingRequirements).toContain('Wizard: Intelligence 13+');
    expect(result.missingRequirements).toContain('Cleric: Wisdom 13+');
  });

  it('should handle class requirements with multiple dependencies (allOf) correctly', () => {
    const character = {
      name: 'Aspiring Paladin',
      class: { name: 'Wizard' },
      abilityScores: {
        strength: { score: 10, modifier: 0 }, // Missing (requires Strength 13)
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 13, modifier: 1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 13, modifier: 1 }, // Met (requires Charisma 13)
      },
    } as unknown as Character;

    const newClass = { name: 'Paladin' } as CharacterClass; // Requires Strength 13 AND Charisma 13

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(false);
    expect(result.requirements).toContain('Paladin: Strength 13+');
    expect(result.missingRequirements).toContain('Paladin: Strength 13+');
    expect(result.missingRequirements).not.toContain('Paladin: Charisma 13+');
  });

  it('should handle class requirements with alternatives (anyOf) correctly when met', () => {
    const character = {
      name: 'Acrobatic Wizard',
      class: { name: 'Wizard' },
      abilityScores: {
        strength: { score: 10, modifier: 0 },
        dexterity: { score: 13, modifier: 1 }, // Meets Fighter requirement via Dexterity
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 13, modifier: 1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
    } as unknown as Character;

    const newClass = { name: 'Fighter' } as CharacterClass; // Requires Strength 13 OR Dexterity 13

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(true);
    expect(result.requirements).toEqual([]);
    expect(result.missingRequirements).toEqual([]);
  });

  it('should handle class requirements with alternatives (anyOf) correctly when not met', () => {
    const character = {
      name: 'Unathletic Wizard',
      class: { name: 'Wizard' },
      abilityScores: {
        strength: { score: 10, modifier: 0 }, // Too low
        dexterity: { score: 10, modifier: 0 }, // Too low
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 13, modifier: 1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
    } as unknown as Character;

    const newClass = { name: 'Fighter' } as CharacterClass; // Requires Strength 13 OR Dexterity 13

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(false);
    expect(result.requirements).toContain('Fighter: Strength 13+ or Dexterity 13+');
    expect(result.missingRequirements).toContain('Fighter: Strength 13+ or Dexterity 13+');
  });

  it('should deduplicate multiple matching requirements across classes', () => {
    const character = {
      name: 'Wizard Rogue Multiclass',
      classLevels: [
        { className: 'Wizard', level: 2 }, // Requires Intelligence 13
        { className: 'Rogue', level: 1 }, // Requires Dexterity 13
      ],
      abilityScores: {
        strength: { score: 10, modifier: 0 },
        dexterity: { score: 10, modifier: 0 }, // Too low
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 13, modifier: 1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
    } as unknown as Character;

    // Both Rogue (existing) and Rogue (as target) would check Rogue reqs
    const newClass = { name: 'Rogue' } as CharacterClass;

    const result = validateMulticlass(character, newClass);
    expect(result.canMulticlass).toBe(false);
    // Requirements array should have exactly one instance of Rogue reqs
    const rogueReqs = result.requirements.filter((r) => r.includes('Rogue'));
    expect(rogueReqs).toHaveLength(1);
    expect(rogueReqs[0]).toBe('Rogue: Dexterity 13+');
  });
});
