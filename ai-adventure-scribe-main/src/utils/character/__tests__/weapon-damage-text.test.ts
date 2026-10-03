import { describe, expect, it } from 'vitest';

import { getWeaponDamageText } from '../weapon-damage-text';

import type { Character } from '@/types/character';

const withScores = (strength: number, dexterity: number): Character =>
  ({
    abilityScores: {
      strength: { score: strength },
      dexterity: { score: dexterity },
    },
  }) as unknown as Character;

// The numbers are server-bun's resolveAttackRules damageBonus: the ability modifier of the
// ability the attack uses plus the weapon's magic bonus.
describe('getWeaponDamageText', () => {
  it('adds the strength modifier for a melee weapon', () => {
    expect(getWeaponDamageText(withScores(16, 12), 'Longsword')).toBe('1d8+3 slashing');
  });

  it('shows a negative modifier and drops a zero one', () => {
    expect(getWeaponDamageText(withScores(8, 12), 'Quarterstaff')).toBe('1d6-1 bludgeoning');
    expect(getWeaponDamageText(withScores(10, 12), 'Quarterstaff')).toBe('1d6 bludgeoning');
  });

  it('uses dexterity for a ranged weapon', () => {
    expect(getWeaponDamageText(withScores(10, 16), 'Longbow')).toBe('1d8+3 piercing');
  });

  it('uses the better of strength and dexterity for a finesse weapon', () => {
    expect(getWeaponDamageText(withScores(10, 18), 'Rapier')).toBe('1d8+4 piercing');
    expect(getWeaponDamageText(withScores(16, 10), 'Rapier')).toBe('1d8+3 piercing');
  });

  it('adds the magic bonus', () => {
    expect(getWeaponDamageText(withScores(16, 12), 'Longsword', 1)).toBe('1d8+4 slashing');
  });

  it('is null for something that is not a catalog weapon', () => {
    expect(getWeaponDamageText(withScores(16, 12), "Dungeoneer's Pack")).toBeNull();
    expect(getWeaponDamageText(withScores(16, 12), 'trophy from fallen enemy')).toBeNull();
  });
});
