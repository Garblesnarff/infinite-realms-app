/**
 * Regression pins for issue #1827 — a hand-built level 1 Monk (Sage
 * background) whose sheet showed no proficiency bonus on any skill or any
 * saving throw. Every value equalled the raw ability modifier.
 *
 * The three invariants pinned here are the whole of the rule:
 *   - a proficient skill = ability modifier + proficiency bonus
 *   - a proficient save  = ability modifier + proficiency bonus
 *   - a non-proficient skill = ability modifier alone
 */

import { describe, it, expect } from 'vitest';

import type { AbilityScores, Character } from '@/types/character';

import {
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
} from '@/utils/character-proficiency-calculations';

/** Ability scores of character 274de914-ad42-49fa-b038-8e458cf9980a. */
const SCORES: AbilityScores = {
  strength: { score: 17, modifier: 3, savingThrow: false },
  dexterity: { score: 17, modifier: 3, savingThrow: false },
  constitution: { score: 17, modifier: 3, savingThrow: false },
  intelligence: { score: 18, modifier: 4, savingThrow: false },
  wisdom: { score: 16, modifier: 3, savingThrow: false },
  charisma: { score: 8, modifier: -1, savingThrow: false },
} as AbilityScores;

/**
 * The reported character: Forest Giant Monk 1 / Sage.
 * Arcana + History come from the Sage background; Acrobatics + Athletics are
 * the two Monk skill choices. Saves are the Monk's fixed STR + DEX.
 */
const monkSage = (overrides: Partial<Character> = {}): Character =>
  ({
    id: '274de914-ad42-49fa-b038-8e458cf9980a',
    name: 'Claude',
    level: 1,
    race: { name: 'Forest Giant' },
    class: { name: 'Monk' },
    background: { name: 'Sage' },
    abilityScores: SCORES,
    skillProficiencies: ['Arcana', 'History', 'Acrobatics', 'Athletics'],
    savingThrowProficiencies: ['strength', 'dexterity'],
    ...overrides,
  }) as unknown as Character;

describe('proficiency bonus on a level 1 Monk / Sage (#1827)', () => {
  describe('skills', () => {
    it('adds the proficiency bonus to a proficient skill', () => {
      const skills = calculateSkillModifiers(monkSage());

      // Acrobatics is DEX (+3), chosen as a Monk skill, PB at level 1 is +2.
      expect(skills['Acrobatics']).toEqual({ modifier: 5, proficient: true, expertise: false });
      // Athletics is STR (+3), also chosen.
      expect(skills['Athletics']).toEqual({ modifier: 5, proficient: true, expertise: false });
    });

    it('adds the proficiency bonus to a background-granted skill', () => {
      const skills = calculateSkillModifiers(monkSage());

      // Sage grants Arcana + History. Both are INT (+4), so both are +6.
      expect(skills['Arcana']).toEqual({ modifier: 6, proficient: true, expertise: false });
      expect(skills['History']).toEqual({ modifier: 6, proficient: true, expertise: false });
    });

    it('leaves a non-proficient skill at the bare ability modifier', () => {
      const skills = calculateSkillModifiers(monkSage());

      // Perception is WIS (+3) and this Monk is not proficient in it.
      expect(skills['Perception']).toEqual({ modifier: 3, proficient: false, expertise: false });
      // Persuasion is CHA (-1) — the negative modifier must survive untouched.
      expect(skills['Persuasion']).toEqual({ modifier: -1, proficient: false, expertise: false });
    });

    it('scales with level, not just level 1', () => {
      // PB is +3 from level 5.
      const skills = calculateSkillModifiers(monkSage({ level: 5 }));

      expect(skills['Acrobatics'].modifier).toBe(6); // 3 + 3
      expect(skills['Perception'].modifier).toBe(3); // unchanged
    });
  });

  describe('saving throws', () => {
    it('adds the proficiency bonus to a proficient save', () => {
      const saves = calculateSavingThrowModifiers(monkSage());

      expect(saves['strength']).toEqual({ modifier: 5, proficient: true });
      expect(saves['dexterity']).toEqual({ modifier: 5, proficient: true });
    });

    it('leaves a non-proficient save at the bare ability modifier', () => {
      const saves = calculateSavingThrowModifiers(monkSage());

      expect(saves['constitution']).toEqual({ modifier: 3, proficient: false });
      expect(saves['intelligence']).toEqual({ modifier: 4, proficient: false });
      expect(saves['wisdom']).toEqual({ modifier: 3, proficient: false });
      expect(saves['charisma']).toEqual({ modifier: -1, proficient: false });
    });

    it('falls back to the class when nothing is persisted', () => {
      // Template-derived characters have no saving_throw_proficiencies column
      // written at all (starter seeding never writes it), so the class map has
      // to carry them. It used to cover only four of the twelve classes.
      const saves = calculateSavingThrowModifiers(
        monkSage({ savingThrowProficiencies: undefined }),
      );

      expect(saves['strength']).toEqual({ modifier: 5, proficient: true });
      expect(saves['dexterity']).toEqual({ modifier: 5, proficient: true });
      expect(saves['wisdom']).toEqual({ modifier: 3, proficient: false });
    });

    it('does not let one class’s cached save set leak into another', () => {
      // The cache used to be keyed on class name alone, so two characters of
      // the same class could not differ — and now that the persisted list wins,
      // they can.
      const persisted = calculateSavingThrowModifiers(monkSage());
      const houseRuled = calculateSavingThrowModifiers(
        monkSage({ savingThrowProficiencies: ['wisdom'] }),
      );

      expect(persisted['strength'].proficient).toBe(true);
      expect(houseRuled['strength'].proficient).toBe(false);
      expect(houseRuled['wisdom']).toEqual({ modifier: 5, proficient: true });
    });
  });
});
