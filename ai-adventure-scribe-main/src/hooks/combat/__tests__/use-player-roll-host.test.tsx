import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attackAction,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  REEVES,
  SCHOLAR,
} from '../../../../shared/test-fixtures/engine-results';
import {
  settleCombatAttackRoll,
  settleCombatInitiativeRoll,
  usePlayerRollHost,
} from '../use-player-roll-host';

import { useOptionalCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useGame } from '@/contexts/GameContext';
import { useDiceRollRequest } from '@/hooks/game/use-dice-roll-request';
import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';
import { engineCardAriaLabel } from '@/services/combat/engine-result-card';
import {
  hasPendingPlayerRoll,
  markPlayerRollCommitted,
  requestPlayerInitiativeRoll,
  requestPlayerAttackRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';

vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));
vi.mock('@/contexts/CampaignContext', () => ({ useOptionalCampaign: vi.fn() }));

describe('usePlayerRollHost teardown', () => {
  const requestDiceRoll = vi.fn().mockReturnValue('initiative-roll-1');
  const cancelDiceRoll = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.clearAllMocks();
    requestDiceRoll.mockReturnValue('initiative-roll-1');
    vi.mocked(useGame).mockReturnValue({ requestDiceRoll, cancelDiceRoll } as never);
    vi.mocked(useOptionalCampaign).mockReturnValue(undefined);
    window.localStorage.clear();
    vi.mocked(useCharacter).mockReturnValue({ state: { character: null } } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles the initiative prompt and clears its timer when the host unmounts', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });

    expect(vi.getTimerCount()).toBe(1);
    unmount();

    await expect(pending).resolves.toEqual({ d20: null });
    expect(cancelDiceRoll).toHaveBeenCalledWith('initiative-roll-1');
    expect(vi.getTimerCount()).toBe(0);
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('re-opens a pending initiative prompt on a remounted host instead of auto-rolling (#2234)', async () => {
    requestDiceRoll
      .mockReturnValueOnce('initiative-roll-1')
      .mockReturnValueOnce('initiative-roll-2');
    const first = renderHook(() => usePlayerRollHost());
    let settled: { d20: number | null } | undefined;
    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Apprentice',
      initiativeModifier: 1,
    }).then((outcome) => {
      settled = outcome;
      return outcome;
    });

    // The message list is torn down and a replacement mounts in the same commit.
    first.unmount();
    renderHook(() => usePlayerRollHost());
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBeUndefined();
    expect(hasPendingPlayerRoll()).toBe(true);
    expect(cancelDiceRoll).toHaveBeenCalledWith('initiative-roll-1');
    expect(requestDiceRoll).toHaveBeenCalledTimes(2);
    expect(requestDiceRoll).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestType: 'initiative', combatInitiativeRoll: true }),
    );

    // The player's die on the re-opened prompt is the one the entry flow receives.
    expect(settleCombatInitiativeRoll('initiative-roll-2', 14)).toBe(true);
    await expect(pending).resolves.toEqual({ d20: 14 });
  });

  it('reports an explicit dismiss as cancelled, not as an engine roll (#2234)', async () => {
    requestDiceRoll.mockReturnValueOnce('attack-roll-1');
    renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      actorLabel: 'The Apprentice',
      targetLabel: 'Flavor-Elemental (Corrupted)',
      weaponName: 'Unarmed Strike',
      attackBonus: 1,
      targetAc: 14,
      advantage: false,
      disadvantage: false,
    });

    expect(settleCombatAttackRoll('attack-roll-1', null, { cancelled: true })).toBe(true);

    await expect(pending).resolves.toEqual({ d20: null, cancelled: true });
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('uses the initiative modifier in the popup roll config and description', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 1,
    });

    expect(requestDiceRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Initiative for The Seeker — 1d20+1',
        rollConfig: { dieType: 20, count: 1, modifier: 1 },
        combatInitiativeRoll: true,
      }),
    );

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });

  it('uses the same attack modifier in the popup description and roll config', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      actorLabel: 'The Seeker',
      targetLabel: 'Sentient Glaze',
      weaponName: 'Longsword',
      attackBonus: 1,
      targetAc: 15,
      advantage: false,
      disadvantage: false,
    });

    expect(requestDiceRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Longsword attack vs Sentient Glaze — 1d20+1 vs AC 15',
        rollConfig: expect.objectContaining({ modifier: 1 }),
      }),
    );

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });

  it('describes a spell-attack popup without claiming an AC line', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      kind: 'spell-attack',
      actorLabel: 'Rook',
      targetLabel: 'Professor Umeboshi',
      weaponName: 'Fire Bolt',
      attackBonus: 0,
      targetAc: 0,
      advantage: false,
      disadvantage: false,
    });

    expect(requestDiceRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Fire Bolt spell attack vs Professor Umeboshi',
        combatAttackRoll: true,
      }),
    );
    expect(requestDiceRoll.mock.calls[0][0].ac).toBeUndefined();

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });

  it('calls the initiative commit signal before the roll animation starts', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });
    const animationStarted = { current: false };
    const onRollCommit = vi.fn(() => {
      expect(animationStarted.current).toBe(false);
      expect(markPlayerRollCommitted('initiative-roll-1')).toBe(true);
    });
    const { result: diceResult } = renderHook(() =>
      useDiceRollRequest({
        request: {
          type: 'initiative',
          formula: '1d20+2',
          purpose: 'Initiative for The Seeker',
        },
        onResult: vi.fn(),
        onRollCommit,
      }),
    );

    act(() => {
      diceResult.current.handleAutoRoll();
      animationStarted.current = diceResult.current.showDiceAnimation;
    });

    expect(onRollCommit).toHaveBeenCalledTimes(1);
    expect(diceResult.current.showDiceAnimation).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    await expect(pending).resolves.toEqual({ d20: null });
  });

  it('drops the "vs AC" clause from the attack dialog on a Hard campaign, matching the engine line (#2573)', async () => {
    vi.mocked(useOptionalCampaign).mockReturnValue({
      state: { campaign: { difficulty_level: 'Hard' } },
    } as never);
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      actorLabel: 'The Seeker',
      targetLabel: 'Sentient Glaze',
      weaponName: 'Longsword',
      attackBonus: 1,
      targetAc: 15,
      advantage: false,
      disadvantage: false,
    });

    const request = requestDiceRoll.mock.calls[0][0];
    expect(request.description).toBe('Longsword attack vs Sentient Glaze — 1d20+1');
    expect(request.description).not.toContain('vs AC');
    expect(request.description).not.toContain('15');
    expect(request.description).not.toContain('(hidden)');
    expect(request.ac).toBeUndefined();

    // The engine line for the same attack, read through the real producers with
    // target numbers off, agrees: neither surface names the AC.
    const [part] = formatCombatEngineParts(
      attackAction(SCHOLAR, REEVES),
      PLAYER_HITS_ENEMY,
      FIGHT_ROSTER,
    );
    expect(engineCardAriaLabel(part.card, false)).not.toContain('vs AC');

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });

  it('still shows the AC in the dialog when the player turned target numbers on (#2573)', async () => {
    window.localStorage.setItem('ui:showTargetNumbers:v1', 'on');
    vi.mocked(useOptionalCampaign).mockReturnValue({
      state: { campaign: { difficulty_level: 'Hard' } },
    } as never);
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      actorLabel: 'The Seeker',
      targetLabel: 'Sentient Glaze',
      weaponName: 'Longsword',
      attackBonus: 1,
      targetAc: 15,
      advantage: false,
      disadvantage: false,
    });

    expect(requestDiceRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Longsword attack vs Sentient Glaze — 1d20+1 vs AC 15',
        ac: 15,
      }),
    );

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });

  it('shows the AC in the attack dialog on an Easy campaign with no stored choice (#2573)', async () => {
    vi.mocked(useOptionalCampaign).mockReturnValue({
      state: { campaign: { difficulty_level: 'Easy' } },
    } as never);
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      actorLabel: 'The Seeker',
      targetLabel: 'Sentient Glaze',
      weaponName: 'Longsword',
      attackBonus: 1,
      targetAc: 15,
      advantage: false,
      disadvantage: false,
    });

    const request = requestDiceRoll.mock.calls[0][0];
    expect(request.description).toBe('Longsword attack vs Sentient Glaze — 1d20+1 vs AC 15');
    expect(request.ac).toBe(15);

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });
});
