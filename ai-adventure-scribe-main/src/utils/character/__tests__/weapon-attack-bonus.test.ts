import { describe, it, expect } from 'vitest';

import { getWeaponAttackBonus } from '../weapon-attack-bonus';

import type { AbilityScores, Character, CharacterClass } from '@/types/character';

import { fighter } from '@/data/classes/fighter';
import { wizard } from '@/data/classes/wizard';

/**
 * #155: magic weapons resolve proficiency through their baseWeaponId.
 *
 * Fixtures follow the real producers: the weapons come from the real equipment
 * resolver over the real src/data/srd/magic-items.json rows (so baseWeaponId
 * is whatever the data ships), and the classes are the real
 * src/data/classes records. No hand-built weapon objects.
 */

function ability(score: number): { score: number; modifier: number; savingThrow: boolean } {
  return { score, modifier: Math.floor((score - 10) / 2), savingThrow: false };
}

function makeCharacter(
  characterClass: CharacterClass,
  strength: number,
  level: number,
): Character {
  return {
    id: 'char-1',
    user_id: 'user-1',
    name: 'Test',
    race: null,
    class: characterClass,
    level,
    background: null,
    abilityScores: {
      strength: ability(strength),
      dexterity: ability(10),
      constitution: ability(10),
      intelligence: ability(10),
      wisdom: ability(10),
      charisma: ability(10),
    } as AbilityScores,
    experience: 0,
    alignment: '',
    description: '',
    skillProficiencies: [],
    expertiseProficiencies: [],
    toolProficiencies: [],
    savingThrowProficiencies: [],
    languages: [],
    personalityTraits: [],
    ideals: [],
    bonds: [],
    flaws: [],
    equipment: [],
    cantrips: [],
    knownSpells: [],
    preparedSpells: [],
    ritualSpells: [],
  } as Character;
}

describe('getWeaponAttackBonus with magic weapons (#155)', () => {
  it('gives a Fighter proficiency with a Sun Blade (baseWeaponId: longsword, martial)', () => {
    // Fighter, STR 16 (+3); proficiency bonus passed explicitly as 2: 3 + 2 = 5
    const result = getWeaponAttackBonus(makeCharacter(fighter, 16, 5), 'sun-blade', 2);

    expect(result).not.toBeNull();
    expect(result?.proficient).toBe(true);
    expect(result?.bonus).toBe(5);
  });

  it('denies a Wizard proficiency with a Mace of Disruption (mace is not on the wizard list)', () => {
    const result = getWeaponAttackBonus(makeCharacter(wizard, 10, 5), 'mace-of-disruption', 3);

    expect(result).not.toBeNull();
    expect(result?.proficient).toBe(false);
    // STR 10 (+0), no proficiency: bonus is 0
    expect(result?.bonus).toBe(0);
  });

  it('gives a Wizard proficiency with a Dagger of Venom (dagger is on the wizard list)', () => {
    const result = getWeaponAttackBonus(makeCharacter(wizard, 10, 5), 'dagger-of-venom', 3);

    expect(result).not.toBeNull();
    expect(result?.proficient).toBe(true);
    expect(result?.bonus).toBe(3);
  });

  it('leaves a Flame Tongue without proficiency — "any sword" names no single base weapon', () => {
    const result = getWeaponAttackBonus(makeCharacter(fighter, 16, 5), 'flame-tongue', 2);

    expect(result).not.toBeNull();
    expect(result?.proficient).toBe(false);
  });
});
