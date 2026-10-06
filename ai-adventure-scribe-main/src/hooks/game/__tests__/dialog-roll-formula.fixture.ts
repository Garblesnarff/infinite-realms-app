/**
 * Producers for the #2614 dialog-formula tests.
 * The character sheet is buildAbilityScores plus the proficiency parsers.
 * The queued roll is useAiRollProcessor's object, plus the id, timestamp and
 * status requestDiceRoll stores. The dialog request is useMessageDiceRolls.
 */
import { renderHook, act } from '@testing-library/react';
import { expect, vi } from 'vitest';

import {
  calculateCompanionRollModifier,
  type CompanionRollKind,
  type RollModifierResult,
  type StoredRollCharacter,
  type StoredRollStats,
} from '../../../../server-bun/src/services/session/companion-roll';

import type { AbilityScores, Character } from '@/types/character';
import type { DiceRollRequest as QueuedRoll } from '@/types/combat';
import type { RollRequest } from '@/types/roll-request';

import { useCharacter } from '@/contexts/CharacterContext';
import { useAiRollProcessor, type AiRollRequest } from '@/contexts/game/use-ai-roll-processor';
import { useGame } from '@/contexts/GameContext';
import { useMessageDiceRolls } from '@/features/game-session/components/chat/message-list/use-message-dice-rolls';
import { useDiceRollRequest } from '@/hooks/game/use-dice-roll-request';
import { buildAbilityScores } from '@/services/build-ability-scores';
import { DiceEngine } from '@/services/dice/DiceEngine';
import {
  parseOptionalProficiencyList,
  parseSavingThrowProficiencies,
} from '@/utils/character/parse-proficiency-list';

export function sheetCharacter(): Character {
  return {
    level: 1,
    abilityScores: buildAbilityScores({
      strength: 16,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 13,
      charisma: 10,
    }),
    savingThrowProficiencies: parseSavingThrowProficiencies('dexterity'),
    skillProficiencies: parseOptionalProficiencyList('Stealth'),
  } as Character;
}

export function scoresOf(character: Character): AbilityScores {
  const scores = character.abilityScores;
  if (!scores) throw new Error('sheet character has no ability scores');
  return scores;
}

function storedStats(character: Character): StoredRollStats {
  const scores = scoresOf(character);
  return {
    strength: scores.strength.score,
    dexterity: scores.dexterity.score,
    constitution: scores.constitution.score,
    intelligence: scores.intelligence.score,
    wisdom: scores.wisdom.score,
    charisma: scores.charisma.score,
  };
}

function storedCharacter(character: Character): StoredRollCharacter {
  return {
    level: character.level ?? null,
    skillProficiencies: character.skillProficiencies,
    expertiseProficiencies: character.expertiseProficiencies,
    savingThrowProficiencies: character.savingThrowProficiencies,
  };
}

/** The pending roll requestDiceRoll stores: the processor's object plus id, timestamp, status. */
export function queueRoll(character: Character | null, request: AiRollRequest): QueuedRoll {
  vi.mocked(useCharacter).mockReturnValue({ state: { character } } as never);
  const queued: Array<Omit<QueuedRoll, 'id' | 'timestamp' | 'status'>> = [];
  const requestDiceRoll = vi.fn((roll: Omit<QueuedRoll, 'id' | 'timestamp' | 'status'>) => {
    queued.push(roll);
    return 'roll-1';
  });
  const { result } = renderHook(() => useAiRollProcessor(vi.fn(), requestDiceRoll));
  act(() => {
    result.current.processAiResponse([request]);
  });
  return { ...queued[0], id: 'roll-1', timestamp: new Date(), status: 'pending' };
}

export function dialogRequestFromQueue(roll: QueuedRoll): RollRequest {
  vi.mocked(useGame).mockReturnValue({
    state: { diceRollQueue: { currentRollId: roll.id, pendingRolls: [roll] } },
    getCurrentDiceRoll: vi.fn(() => roll),
    completeDiceRoll: vi.fn(),
    cancelDiceRoll: vi.fn(),
    clearBatch: vi.fn(),
  } as never);
  const { result } = renderHook(() =>
    useMessageDiceRolls({ onSendMessage: vi.fn(), onSendFullMessage: vi.fn() }),
  );
  const request = result.current.rollRequest;
  if (!request) throw new Error('useMessageDiceRolls emitted no roll request');
  return request;
}

export function dialogFormula(character: Character | null, request: RollRequest): string {
  vi.mocked(useCharacter).mockReturnValue({ state: { character } } as never);
  const { result } = renderHook(() => useDiceRollRequest({ request, onResult: vi.fn() }));
  return result.current.rollCalculation.formula;
}

export function expectTotalEqualsEngine(formula: string, modifier: number): void {
  const rolled = DiceEngine.roll(formula);
  expect(rolled.naturalRoll).toEqual(expect.any(Number));
  expect(rolled.total).toBe((rolled.naturalRoll as number) + modifier);
}

export function companionModifier(
  kind: CompanionRollKind,
  name: string,
  character: Character,
): RollModifierResult {
  return calculateCompanionRollModifier(
    kind,
    name,
    storedCharacter(character),
    storedStats(character),
  );
}
