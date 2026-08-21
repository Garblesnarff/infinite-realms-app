import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAiRollProcessor, type AiRollRequest } from '../use-ai-roll-processor';

import type { Character } from '@/types/character';
import type { DiceRollRequest } from '@/types/combat';

import { useCharacter } from '@/contexts/CharacterContext';
import logger from '@/lib/logger';

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useAiRollProcessor', () => {
  const character = {
    level: 1,
    abilityScores: {
      strength: { score: 10, modifier: 0 },
      dexterity: { score: 10, modifier: 0 },
      constitution: { score: 10, modifier: 0 },
      intelligence: { score: 10, modifier: 0 },
      wisdom: { score: 10, modifier: 0 },
      charisma: { score: 10, modifier: 0 },
    },
    skillProficiencies: ['Investigation'],
  } as Character;

  beforeEach(() => {
    vi.clearAllMocks();
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({
      state: { character },
    });
  });

  it('uses the character record for a proficient skill regardless of proficiency wording', () => {
    const queuedRequests: Array<Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>> = [];
    const requestDiceRoll = vi.fn(
      (request: Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>) => {
        queuedRequests.push(request);
        return `roll-${queuedRequests.length}`;
      },
    );
    const dispatch = vi.fn();

    const { result } = renderHook(() => useAiRollProcessor(dispatch, requestDiceRoll));

    act(() => {
      result.current.processAiResponse([
        {
          type: 'check',
          formula: '1d20+0',
          purpose: 'Investigation check to search the archives',
        },
        {
          type: 'check',
          formula: '1d20+9',
          purpose: 'Investigation check using your Investigation proficiency',
        },
      ]);
    });

    expect(queuedRequests).toHaveLength(2);
    expect(queuedRequests.map((request) => request.rollConfig.modifier)).toEqual([2, 2]);
    expect(queuedRequests.map((request) => request.rollConfig.abilityModifier)).toEqual([
      undefined,
      undefined,
    ]);
  });

  const processSingleRoll = (
    request: AiRollRequest,
  ): Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'> => {
    const queuedRequests: Array<Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>> = [];
    const requestDiceRoll = vi.fn(
      (queuedRequest: Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>) => {
        queuedRequests.push(queuedRequest);
        return 'roll-1';
      },
    );
    const dispatch = vi.fn();

    const { result } = renderHook(() => useAiRollProcessor(dispatch, requestDiceRoll));

    act(() => {
      result.current.processAiResponse([request]);
    });

    return queuedRequests[0];
  };

  it('warns and preserves the prose formula when no skill or ability matches', () => {
    const queuedRequest = processSingleRoll({
      type: 'check',
      formula: '1d20+9',
      purpose: 'Roll to notice the ambush',
      participantId: 'player-1',
    });

    expect(queuedRequest.rollConfig.modifier).toBe(9);
    expect(logger.warn).toHaveBeenCalledWith(
      'roll_modifier_prose_fallback',
      expect.objectContaining({ purpose: 'Roll to notice the ambush' }),
    );
  });

  it('matches a proficient skill stored with underscore casing', () => {
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({
      state: {
        character: {
          ...character,
          abilityScores: {
            ...character.abilityScores,
            dexterity: { score: 14, modifier: 2 },
          },
          skillProficiencies: ['sleight_of_hand'],
        },
      },
    });

    const queuedRequest = processSingleRoll({
      type: 'check',
      formula: '1d20+9',
      purpose: 'Sleight of Hand check',
    });

    expect(queuedRequest.rollConfig.modifier).toBe(4);
  });

  it('uses only the ability modifier for a non-proficient skill', () => {
    const queuedRequest = processSingleRoll({
      type: 'check',
      formula: '1d20+9',
      purpose: 'Perception check',
    });

    expect(queuedRequest.rollConfig.modifier).toBe(0);
  });

  it('doubles proficiency for an expertise skill', () => {
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({
      state: {
        character: {
          ...character,
          skillProficiencies: ['Investigation'],
          expertiseProficiencies: ['investigation'],
        },
      },
    });

    const queuedRequest = processSingleRoll({
      type: 'check',
      formula: '1d20+9',
      purpose: 'Investigation check',
    });

    expect(queuedRequest.rollConfig.modifier).toBe(4);
  });

  it('derives an ability-only check without adding proficiency', () => {
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({
      state: {
        character: {
          ...character,
          abilityScores: {
            ...character.abilityScores,
            strength: { score: 16, modifier: 3 },
          },
        },
      },
    });

    const queuedRequest = processSingleRoll({
      type: 'check',
      formula: '1d20+9',
      purpose: 'Strength check to force the door',
    });

    expect(queuedRequest.rollConfig.modifier).toBe(3);
  });

  it('passes through the formula while the character is not loaded', () => {
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({
      state: { character: null },
    });

    const queuedRequest = processSingleRoll({
      type: 'check',
      formula: '1d20+9',
      purpose: 'Roll to notice the ambush',
    });

    expect(queuedRequest.rollConfig.modifier).toBe(9);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
