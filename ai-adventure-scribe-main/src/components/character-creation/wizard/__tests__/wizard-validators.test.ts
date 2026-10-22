import { describe, expect, it } from 'vitest';

import { validateStep } from '../wizard-validators';

import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';
import { fighter } from '@/data/classes/fighter';
import { rogue } from '@/data/classes/rogue';
import { dwarf } from '@/data/races/dwarf';
import { human } from '@/data/races/human';
import { ABILITIES } from '@/hooks/use-ability-score-selection';

/** 2014 Player's Handbook point-buy costs. Kept as literals so a wrong table fails. */
const POINT_BUY_COSTS: ReadonlyArray<readonly [number, number]> = [
  [8, 0],
  [9, 1],
  [10, 2],
  [11, 3],
  [12, 4],
  [13, 5],
  [14, 7],
  [15, 9],
];

function abilityScoreSheet(
  scores: readonly number[],
  method?: 'pointBuy' | 'standardArray' | 'roll',
): {
  abilityScoreMethod?: 'pointBuy' | 'standardArray' | 'roll';
  abilityScores: Record<string, { score: number; modifier: number; savingThrow: boolean }>;
  race: typeof dwarf;
} {
  const abilityScores = Object.fromEntries(
    ABILITIES.map((ability, index) => [
      ability,
      { score: scores[index], modifier: 0, savingThrow: false },
    ]),
  );

  return {
    ...(method ? { abilityScoreMethod: method } : {}),
    abilityScores,
    race: dwarf,
  };
}

describe('wizard validation messages (#213)', () => {
  it.each([
    ['', 'Name: Character name is required'],
    ['A'.repeat(51), 'Name: Name must be 50 characters or less'],
    ['Hero <b>', 'Name: Name can only contain letters, spaces, hyphens, and apostrophes'],
  ])('names the invalid field for %j', (name, message) => {
    const result = validateStep('Basic Info', { name } as never);

    expect(result).toEqual({ isValid: false, message });
  });

  it('blocks point-buy scores outside the 8-15 range', () => {
    const result = validateStep('Ability Scores', {
      abilityScoreMethod: 'pointBuy',
      abilityScores: {
        strength: { score: 16 },
        dexterity: { score: 8 },
        constitution: { score: 8 },
        intelligence: { score: 8 },
        wisdom: { score: 8 },
        charisma: { score: 8 },
      },
      race: dwarf,
    } as never);

    expect(result).toEqual({
      isValid: false,
      message: 'Ability Scores: Point Buy scores must be between 8 and 15',
    });
  });

  it.each(POINT_BUY_COSTS)(
    'scores a %i as %i point-buy points through validateStep',
    (score, cost) => {
      // Five 15s cost 45. The sixth score is the row under test, so the
      // reported total is 45 plus that row's cost.
      const result = validateStep(
        'Ability Scores',
        abilityScoreSheet([score, 15, 15, 15, 15, 15], 'pointBuy') as never,
      );

      expect(result).toEqual({
        isValid: false,
        message: `Ability Scores: Point Buy allows 27 points maximum; you have used ${45 + cost}.`,
      });
    },
  );

  it('accepts a point-buy sheet that spends exactly 27', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([15, 15, 15, 8, 8, 8], 'pointBuy') as never,
    );

    expect(result).toEqual({ isValid: true, message: '' });
  });

  it('rejects a point-buy sheet that spends 28 and names the over-budget alert', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([15, 15, 15, 9, 8, 8], 'pointBuy') as never,
    );

    expect(result).toEqual({
      isValid: false,
      message: 'Ability Scores: Point Buy allows 27 points maximum; you have used 28.',
    });
  });

  it('keeps a draft with no abilityScoreMethod when the stored scores are outside point buy', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([16, 14, 14, 12, 10, 8]) as never,
    );

    expect(result).toEqual({ isValid: true, message: '' });
  });

  it('keeps a draft with no abilityScoreMethod when the stored scores spend more than 27', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([15, 15, 15, 9, 8, 8]) as never,
    );

    expect(result).toEqual({ isValid: true, message: '' });
  });

  it('accepts rolled scores below 8 when method is roll', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([15, 6, 12, 10, 13, 9], 'roll') as never,
    );

    expect(result).toEqual({ isValid: true, message: '' });
  });

  it('accepts the lowest rolled scores', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([18, 3, 3, 3, 3, 3], 'roll') as never,
    );

    expect(result).toEqual({ isValid: true, message: '' });
  });

  it('rejects a rolled score of 2', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([15, 2, 12, 10, 13, 9], 'roll') as never,
    );

    expect(result).toEqual({
      isValid: false,
      message: 'Please complete your ability score selection',
    });
  });

  it('rejects a missing rolled score', () => {
    const result = validateStep('Ability Scores', {
      abilityScoreMethod: 'roll',
      abilityScores: {
        strength: { score: 15, modifier: 0, savingThrow: false },
        dexterity: { score: 6, modifier: 0, savingThrow: false },
        constitution: { score: 12, modifier: 0, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 13, modifier: 0, savingThrow: false },
      },
      race: dwarf,
    } as never);

    expect(result).toEqual({
      isValid: false,
      message: 'Please complete your ability score selection',
    });
  });

  it('rejects a point-buy score of 7 with the range message', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([7, 8, 8, 8, 8, 8], 'pointBuy') as never,
    );

    expect(result).toEqual({
      isValid: false,
      message: 'Ability Scores: Point Buy scores must be between 8 and 15',
    });
  });

  it('accepts a draft with no method and a score below 8', () => {
    const result = validateStep(
      'Ability Scores',
      abilityScoreSheet([16, 6, 12, 10, 13, 9]) as never,
    );

    expect(result).toEqual({ isValid: true, message: '' });
  });
});

it('#899 requires the background extra language even when racial languages and class skills exist', () => {
  const character = {
    class: fighter,
    race: human,
    background: backgrounds.find((background) => background.id === 'outlander'),
    skillProficiencies: ['Athletics', 'Survival', 'History', 'Perception'],
    languages: ['Common'],
  } as Character;
  expect(validateStep('Proficiencies & Languages', character).isValid).toBe(false);
  expect(
    validateStep('Proficiencies & Languages', { ...character, languages: ['Common', 'Draconic'] })
      .isValid,
  ).toBe(true);
});

it('#899 partial choices do not let a Rogue leave before choosing Expertise', () => {
  const character = {
    class: rogue,
    race: human,
    background: backgrounds.find((background) => background.id === 'criminal'),
    skillProficiencies: [
      'Deception',
      'Stealth',
      'Acrobatics',
      'Athletics',
      'Insight',
      'Investigation',
    ],
    languages: ['Common'],
  } as Character;
  expect(validateStep('Proficiencies & Languages', character).isValid).toBe(false);
  expect(
    validateStep('Proficiencies & Languages', {
      ...character,
      expertiseProficiencies: ['Insight', 'Stealth'],
    }).isValid,
  ).toBe(true);
});
