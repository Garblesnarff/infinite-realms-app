/**
 * Regression pins for issue #1847 — template-derived characters rolled every
 * skill without their proficiency bonus.
 *
 * `SKILLS_MAP` is keyed TitleCase-with-spaces, and the lookup compared the
 * persisted strings verbatim. The two writers of the free-text
 * `skill_proficiencies` column disagree on case:
 *
 *   - creation wizard  -> `Arcana,History,Athletics,Acrobatics`   (TitleCase)
 *   - starter seeding  -> `nature, survival, perception, investigation`
 *                         (lowercase; `sleight_of_hand` snake-cased)
 *
 * so lowercase rows matched nothing — 100 of 112 real characters. The fix
 * case-folds at the comparison rather than rewriting stored rows, so the next
 * writer cannot reintroduce the mismatch.
 *
 * The lowercase fixtures below are the real stored values from the issue's
 * falsification test (The Seeker, Catfolk Ranger 1), and the expected
 * modifiers are that test's re-cased results: Investigation +4, Nature +4,
 * Perception +5, Survival +5.
 */

import { describe, it, expect } from 'vitest';

import type { AbilityScores, Character } from '@/types/character';

import { calculatePassivePerception } from '@/services/passive-skills-service';
import { isSkillProficient } from '@/utils/character/basic-modifiers';
import { canonicalProficiencyKey, hasProficiency } from '@/utils/character/parse-proficiency-list';
import { calculateSkillModifiers } from '@/utils/character-proficiency-calculations';

/**
 * The Seeker's ability scores, from the starter template seed
 * (20260103_seed_starter_character_templates.sql): INT 14 (+2), WIS 16 (+3).
 * Level 1, so the proficiency bonus is +2.
 */
const SEEKER_SCORES: AbilityScores = {
  strength: { score: 10, modifier: 0, savingThrow: false },
  dexterity: { score: 16, modifier: 3, savingThrow: false },
  constitution: { score: 12, modifier: 1, savingThrow: false },
  intelligence: { score: 14, modifier: 2, savingThrow: false },
  wisdom: { score: 16, modifier: 3, savingThrow: false },
  charisma: { score: 10, modifier: 0, savingThrow: false },
} as AbilityScores;

const seeker = (skillProficiencies: string[], overrides: Partial<Character> = {}): Character =>
  ({
    name: 'The Seeker',
    level: 1,
    race: { name: 'Catfolk' },
    class: { name: 'Ranger' },
    background: { name: 'Anthropologist' },
    abilityScores: SEEKER_SCORES,
    skillProficiencies,
    ...overrides,
  }) as unknown as Character;

/** Exactly what the `skill_proficiencies` column holds for this row. */
const STORED_LOWERCASE = ['nature', 'survival', 'perception', 'investigation'];
const RECASED_TITLECASE = ['Nature', 'Survival', 'Perception', 'Investigation'];
const MIXED = ['NATURE', 'survival', 'Perception', 'iNvEsTiGaTiOn'];

/** The falsification test's re-cased result. */
const EXPECTED = {
  Investigation: 4, // INT +2 + PB +2
  Nature: 4, // INT +2 + PB +2
  Perception: 5, // WIS +3 + PB +2
  Survival: 5, // WIS +3 + PB +2
};

describe('skill proficiency lookup is case-insensitive (#1847)', () => {
  describe.each([
    ['stored lowercase', STORED_LOWERCASE],
    ['re-cased TitleCase', RECASED_TITLECASE],
    ['mixed case', MIXED],
  ])('%s', (_label, stored) => {
    it('resolves all four proficient skills with the proficiency bonus', () => {
      const skills = calculateSkillModifiers(seeker(stored));

      for (const [skill, modifier] of Object.entries(EXPECTED)) {
        expect(skills[skill]).toEqual({ modifier, proficient: true, expertise: false });
      }
    });

    it('leaves non-proficient skills at the bare ability modifier', () => {
      const skills = calculateSkillModifiers(seeker(stored));

      // Stealth is DEX (+3) and not in the stored list.
      expect(skills['Stealth']).toEqual({ modifier: 3, proficient: false, expertise: false });
      // Arcana is INT (+2) — same ability as two proficient skills, so this
      // catches a fix that bonused the ability rather than the skill.
      expect(skills['Arcana']).toEqual({ modifier: 2, proficient: false, expertise: false });
    });
  });

  it('gives the lowercase row exactly the result its TitleCase twin gets', () => {
    // The whole claim of the issue: casing was the sole cause.
    expect(calculateSkillModifiers(seeker(STORED_LOWERCASE))).toEqual(
      calculateSkillModifiers(seeker(RECASED_TITLECASE)),
    );
  });

  it('matches a snake_cased multi-word skill against the spaced map key', () => {
    // The Trickster template seeds `sleight_of_hand`; SKILLS_MAP keys it
    // 'Sleight of Hand'.
    const skills = calculateSkillModifiers(seeker(['sleight_of_hand', 'deception']));

    // Sleight of Hand is DEX (+3) + PB +2.
    expect(skills['Sleight of Hand']).toEqual({ modifier: 5, proficient: true, expertise: false });
    expect(skills['Deception']).toEqual({ modifier: 2, proficient: true, expertise: false });
  });

  it('applies expertise regardless of the case either column was written in', () => {
    const skills = calculateSkillModifiers(
      seeker(STORED_LOWERCASE, { expertiseProficiencies: ['Perception'] } as Partial<Character>),
    );

    // WIS +3 + PB +2 doubled = +7.
    expect(skills['Perception']).toEqual({ modifier: 7, proficient: true, expertise: true });
    expect(skills['Survival']).toEqual({ modifier: 5, proficient: true, expertise: false });
  });

  it('does not let two differently-skilled characters share a cached set', () => {
    // The resolved set is cached module-level; the key is built from the
    // canonicalised list, so same-set/different-case shares and
    // different-set does not.
    const seekerSkills = calculateSkillModifiers(seeker(STORED_LOWERCASE));
    const otherSkills = calculateSkillModifiers(seeker(['stealth', 'deception']));

    expect(seekerSkills['Perception'].proficient).toBe(true);
    expect(otherSkills['Perception'].proficient).toBe(false);
    expect(otherSkills['Stealth'].proficient).toBe(true);
  });
});

describe('the same casing fix at the other read sites (#1847)', () => {
  it('isSkillProficient reads a lowercase and a snake_cased row', () => {
    expect(isSkillProficient(seeker(STORED_LOWERCASE), 'Perception')).toBe(true);
    expect(isSkillProficient(seeker(RECASED_TITLECASE), 'perception')).toBe(true);
    expect(isSkillProficient(seeker(['sleight_of_hand']), 'Sleight of Hand')).toBe(true);
    expect(isSkillProficient(seeker(STORED_LOWERCASE), 'Stealth')).toBe(false);
  });

  it('passive Perception picks up a lowercase proficiency', () => {
    // 10 + WIS +3 + PB +2 = 15, vs 13 unproficient.
    expect(calculatePassivePerception(seeker(STORED_LOWERCASE))).toBe(15);
    expect(calculatePassivePerception(seeker(RECASED_TITLECASE))).toBe(15);
    expect(calculatePassivePerception(seeker(['stealth']))).toBe(13);
  });
});

describe('canonicalProficiencyKey', () => {
  it('collapses every form the two writers produce onto one key', () => {
    expect(canonicalProficiencyKey('Sleight of Hand')).toBe('sleightofhand');
    expect(canonicalProficiencyKey('sleight of hand')).toBe('sleightofhand');
    expect(canonicalProficiencyKey('sleight_of_hand')).toBe('sleightofhand');
    expect(canonicalProficiencyKey('Animal Handling')).toBe('animalhandling');
    expect(canonicalProficiencyKey('animal_handling')).toBe('animalhandling');
  });

  it('keeps distinct skills distinct', () => {
    expect(canonicalProficiencyKey('Insight')).not.toBe(canonicalProficiencyKey('Investigation'));
  });
});

describe('hasProficiency', () => {
  it('is case- and separator-insensitive on both sides', () => {
    expect(hasProficiency(STORED_LOWERCASE, 'Perception')).toBe(true);
    expect(hasProficiency(RECASED_TITLECASE, 'perception')).toBe(true);
    expect(hasProficiency(['sleight_of_hand'], 'Sleight of Hand')).toBe(true);
  });

  it('does not match a skill that is absent', () => {
    expect(hasProficiency(STORED_LOWERCASE, 'Stealth')).toBe(false);
  });

  it('never matches on an empty or missing list, or an empty name', () => {
    expect(hasProficiency(undefined, 'Perception')).toBe(false);
    expect(hasProficiency([], 'Perception')).toBe(false);
    // A stray separator canonicalises to '' — it must not match everything.
    expect(hasProficiency(['-'], '')).toBe(false);
    expect(hasProficiency(['-'], '_')).toBe(false);
  });
});
