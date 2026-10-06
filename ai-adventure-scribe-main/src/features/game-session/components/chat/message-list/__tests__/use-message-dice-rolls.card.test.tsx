import { render, screen, renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMessageDiceRolls } from '../use-message-dice-rolls';

import { DiceRollMessage } from '@/components/game/DiceRollMessage';
import { useGame } from '@/contexts/GameContext';

vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({
  settleCombatAttackRoll: vi.fn(() => false),
  settleCombatInitiativeRoll: vi.fn(() => false),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  hasPendingPlayerRoll: vi.fn(() => false),
}));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

describe('roll card from the real useMessageDiceRolls producer (#2588)', () => {
  const onSendFullMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A saving throw with a symbolic formula is queued with rollConfig.modifier 0 (the popup adds
  // the character's bonus when it rolls), so the total holds a +5 the config does not.
  it('prints the modifier inside the total for a +5 save with natural 13', async () => {
    const roll = {
      id: 'roll-1',
      status: 'pending',
      requestType: 'save',
      description: 'Dexterity saving throw',
      rollConfig: {
        dieType: 20,
        count: 1,
        modifier: 0,
        abilityModifier: 'dex',
        advantage: false,
        disadvantage: false,
      },
    };
    vi.mocked(useGame).mockReturnValue({
      state: { diceRollQueue: { currentRollId: 'roll-1', pendingRolls: [roll] } },
      getCurrentDiceRoll: vi.fn(() => roll),
      completeDiceRoll: vi.fn(),
      cancelDiceRoll: vi.fn(),
      clearBatch: vi.fn(),
    } as never);

    const { result } = renderHook(() =>
      useMessageDiceRolls({ onSendMessage: vi.fn(), onSendFullMessage }),
    );
    await act(async () => {
      await result.current.handleManualResult(18, { naturalRoll: 13 });
    });

    const context = onSendFullMessage.mock.calls[0][1];
    render(<DiceRollMessage data={context.diceRoll} />);
    expect(screen.getByTestId('roll-breakdown')).toHaveTextContent(
      'Natural 13 + Modifier +5 = Total 18',
    );
  });
});
