/**
 * #2641 (run D9): the crossbow prompt's title said "1d20+3 (disadvantage)" while its Roll button
 * said "1d20+5" ("1d20 + STR +3 + Prof +2"). A light crossbow is a DEX weapon, so +3 was the
 * engine's number and +5 was the dialog resolver (#2628) recomputing every `attack` request as a
 * Strength attack, whatever number the engine had just proposed.
 *
 * The producers are the real ones: `usePlayerRollHost` queues the engine prompt from the same spec
 * `askPlayerForAttackDie` builds out of the engine's proposal, `useMessageDiceRolls` turns the
 * queued roll into the dialog's request, and `useDiceRollRequest` is the hook the dialog rolls with.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sheetCharacter } from './dialog-roll-formula.fixture';

import type { DiceRollRequest as QueuedRoll } from '@/types/combat';

import { useCharacter } from '@/contexts/CharacterContext';
import { useGame } from '@/contexts/GameContext';
import { useMessageDiceRolls } from '@/features/game-session/components/chat/message-list/use-message-dice-rolls';
import { usePlayerRollHost } from '@/hooks/combat/use-player-roll-host';
import { useDiceRollRequest } from '@/hooks/game/use-dice-roll-request';
import { buildAbilityScores } from '@/services/build-ability-scores';
import {
  requestPlayerAttackRoll,
  settlePendingPlayerRoll,
  setPlayerRollHost,
} from '@/services/combat/player-roll-bridge';

vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/contexts/CampaignContext', () => ({ useOptionalCampaign: vi.fn(() => undefined) }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** The Veteran of run D9: STR 16, DEX 12, proficiency +2. Crossbow, light: DEX +1 + Prof +2 = +3. */
const veteran = () => {
  const base = sheetCharacter();
  return {
    ...base,
    abilityScores: buildAbilityScores({
      strength: 16,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 13,
      charisma: 10,
    }),
  };
};

const queueEnginePrompt = () => {
  const queued: Array<Omit<QueuedRoll, 'id' | 'timestamp' | 'status'>> = [];
  const requestDiceRoll = vi.fn((roll: Omit<QueuedRoll, 'id' | 'timestamp' | 'status'>) => {
    queued.push(roll);
    return 'roll-1';
  });
  vi.mocked(useGame).mockReturnValue({ requestDiceRoll, cancelDiceRoll: vi.fn() } as never);
  const host = renderHook(() => usePlayerRollHost());
  const pending = requestPlayerAttackRoll({
    actorLabel: 'The Veteran',
    targetLabel: 'The Silent Monk 1',
    weaponName: 'Crossbow, light',
    attackBonus: 3,
    targetAc: 12,
    advantage: false,
    disadvantage: true,
  });
  host.unmount();
  return {
    roll: { ...queued[0], id: 'roll-1', timestamp: new Date(), status: 'pending' } as QueuedRoll,
    pending,
  };
};

describe('engine attack prompt formula (#2641)', () => {
  beforeEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.clearAllMocks();
    vi.mocked(useCharacter).mockReturnValue({ state: { character: veteran() } } as never);
  });

  it('rolls the engine proposal (1d20+3), not a Strength recomputation (1d20+5)', async () => {
    const { roll, pending } = queueEnginePrompt();
    expect(roll.combatAttackRoll).toBe(true);
    expect(roll.rollConfig.modifier).toBe(3);

    vi.mocked(useGame).mockReturnValue({
      state: { diceRollQueue: { currentRollId: roll.id, pendingRolls: [roll] } },
      getCurrentDiceRoll: vi.fn(() => roll),
      completeDiceRoll: vi.fn(),
      cancelDiceRoll: vi.fn(),
      clearBatch: vi.fn(),
    } as never);
    const { result: dialog } = renderHook(() =>
      useMessageDiceRolls({ onSendMessage: vi.fn(), onSendFullMessage: vi.fn() }),
    );
    const request = dialog.current.rollRequest;
    if (!request) throw new Error('useMessageDiceRolls emitted no roll request');
    expect(request.purpose).toBe(roll.description);
    expect(request.purpose).toContain('1d20+3');

    const { result } = renderHook(() => useDiceRollRequest({ request, onResult: vi.fn() }));
    expect(result.current.rollCalculation.formula).toBe('1d20+3');
    expect(result.current.resolvedFormula).toBe('1d20+3');

    settlePendingPlayerRoll({ d20: null });
    await pending;
  });
});
