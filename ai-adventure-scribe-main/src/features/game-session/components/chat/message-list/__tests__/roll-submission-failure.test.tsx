/**
 * #2280 / run M5: the first Perception roll's submission failed ("Roll submission failed. Please
 * try again.") and left the prompt with Roll Dice, Enter Manually and Dismiss all disabled. The
 * real roll hook and the real prompt run together here; only the game state and the send are
 * stubbed, and the send rejects the way M5's did.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { M5_PERCEPTION } from '../../../../../../../shared/test-fixtures/dm-roll-reply-saves';
import { useMessageDiceRolls } from '../use-message-dice-rolls';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';

const m5 = M5_PERCEPTION;

const { perceptionRoll, game } = vi.hoisted(() => {
  const roll = {
    id: 'm5-perception',
    requestType: 'skill_check',
    description: 'Perception check to notice anything unusual or dangerous in the corridor',
    status: 'pending' as const,
    rollConfig: {
      count: 1,
      dieType: 20,
      modifier: 1,
      advantage: false,
      disadvantage: false,
    },
  };
  return {
    perceptionRoll: roll,
    game: {
      state: {
        isInCombat: false,
        currentPhase: 'exploration',
        diceRollQueue: { currentRollId: roll.id, pendingRolls: [roll] },
      },
      getCurrentDiceRoll: () => roll,
      completeDiceRoll: vi.fn(),
      cancelDiceRoll: vi.fn(),
      clearBatch: vi.fn(),
    },
  };
});

vi.mock('@/contexts/GameContext', () => ({ useGame: () => game }));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: { id: 'the-apprentice', name: 'The Apprentice' } } }),
}));
vi.mock('@/utils/characterModifiers', () => ({
  calculateRollWithBreakdown: () => ({
    formula: '1d20+1',
    breakdown: ['1d20', 'WIS +1'],
    totalModifier: 1,
    isProficient: false,
  }),
  SKILL_ABILITIES: { perception: 'wisdom' },
}));
// M5's die: a natural 6 for a total of 7.
vi.mock('@/features/game-session/components', () => ({
  DiceRollEmbed: ({ onRoll }: { onRoll: (result: unknown) => void }) => (
    <button data-testid="dice-animation" onClick={() => onRoll({ total: 7, naturalRoll: 6 })}>
      die lands
    </button>
  ),
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const Prompt: React.FC<{ onSendFullMessage: () => Promise<void> }> = ({ onSendFullMessage }) => {
  const dice = useMessageDiceRolls({ onSendMessage: vi.fn(), onSendFullMessage });
  if (!dice.currentRoll || !dice.rollRequest) return null;
  return (
    <DiceRollRequest
      request={dice.rollRequest}
      requestId={dice.currentRoll.id}
      pendingRollId={dice.pendingRollId}
      rollError={dice.rollError}
      onResult={dice.handleManualResult}
      onCancel={dice.handleCancelRoll}
    />
  );
};

const rollButton = (): HTMLElement => screen.getByRole('button', { name: /^Roll 1d20\+1 for/ });
const ownRollButton = (): HTMLElement => screen.getByRole('button', { name: /Enter my own roll/ });
const cancelButton = (): HTMLElement =>
  screen.getByRole('button', { name: /Dismiss roll request/ });

describe('a failed roll submission leaves the prompt usable (#2280, run M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(`${m5.name}: after the send fails, Roll / Enter my own roll / Cancel are all enabled again`, async () => {
    const onSendFullMessage = vi.fn(async () => {
      throw new Error(
        'Validation failed (422): /message Expected string length greater or equal to 1',
      );
    });
    render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    expect(rollButton()).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Roll submission failed. Please try again.',
      ),
    );
    // The dead end on M5: every control off. Now every control is on.
    expect(rollButton()).toBeEnabled();
    expect(rollButton()).not.toHaveTextContent('Rolling');
    expect(ownRollButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    // Nothing left mounted can roll and submit again by itself.
    expect(screen.queryByTestId('dice-animation')).not.toBeInTheDocument();
    expect(onSendFullMessage).toHaveBeenCalledTimes(1);
    expect(game.completeDiceRoll).not.toHaveBeenCalled();
  });

  it('the player can roll again and it goes through', async () => {
    const onSendFullMessage = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Request failed (500)'))
      .mockResolvedValueOnce(undefined);
    render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    await waitFor(() => expect(rollButton()).toBeEnabled());

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });

    await waitFor(() =>
      expect(game.completeDiceRoll).toHaveBeenCalledWith(perceptionRoll.id, {
        total: 7,
        naturalRoll: 6,
      }),
    );
    expect(onSendFullMessage).toHaveBeenCalledTimes(2);
  });

  it('the player can withdraw the roll after a failure', async () => {
    render(
      <Prompt
        onSendFullMessage={vi.fn(async () => {
          throw new Error('Request failed (500)');
        })}
      />,
    );

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    await waitFor(() => expect(cancelButton()).toBeEnabled());

    fireEvent.click(cancelButton());
    expect(game.cancelDiceRoll).toHaveBeenCalledWith(perceptionRoll.id);
  });
});
