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

import type { ChatMessage } from '@/types/game';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';

const m5 = M5_PERCEPTION;

const { perceptionRoll, game } = vi.hoisted(() => {
  const roll = {
    id: 'm5-perception',
    rollRequestId: 'req-m5-perception',
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
      getCurrentDiceRoll: () =>
        game.state.diceRollQueue.pendingRolls.find(
          (r) => r.id === game.state.diceRollQueue.currentRollId,
        ) ?? null,
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

const Prompt: React.FC<{
  onSendFullMessage: () => Promise<void>;
  messages?: readonly ChatMessage[];
}> = ({ onSendFullMessage, messages = [] }) => {
  const dice = useMessageDiceRolls({ onSendMessage: vi.fn(), onSendFullMessage, messages });
  if (!dice.currentRoll || !dice.rollRequest)
    return dice.rollError ? (
      <div role="alert">
        {dice.rollError}
        <button onClick={dice.handleRetryRoll}>Retry</button>
      </div>
    ) : null;
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

describe('a failed roll submission leaves the prompt usable (#2280, run M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    game.state.diceRollQueue = { currentRollId: perceptionRoll.id, pendingRolls: [perceptionRoll] };
    game.completeDiceRoll.mockImplementation(() => {
      game.state.diceRollQueue = { currentRollId: '', pendingRolls: [] };
    });
  });

  it(`${m5.name}: after the send fails, the resolved prompt closes and Retry is available`, async () => {
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
    expect(screen.queryByTestId('dice-roll-request')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByTestId('dice-animation')).not.toBeInTheDocument();
    expect(onSendFullMessage).toHaveBeenCalledTimes(1);
    expect(game.completeDiceRoll).toHaveBeenCalledWith(perceptionRoll.id, {
      total: 7,
      naturalRoll: 6,
    });
  });

  it('Retry sends the same resolved result without rolling again', async () => {
    const onSendFullMessage = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Request failed (500)'))
      .mockResolvedValueOnce(undefined);
    render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() =>
      expect(game.completeDiceRoll).toHaveBeenCalledWith(perceptionRoll.id, {
        total: 7,
        naturalRoll: 6,
      }),
    );
    expect(onSendFullMessage).toHaveBeenCalledTimes(2);
  });

  it('a failed resolved die is not left pending or cancelled', async () => {
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
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('button', { name: /Dismiss roll request/ })).not.toBeInTheDocument();
    expect(game.cancelDiceRoll).not.toHaveBeenCalled();
    expect(game.completeDiceRoll).toHaveBeenCalledTimes(1);
  });

  // #1288: the send threw after the player row had already saved. Once the DM has replied to that
  // row, the turn completed and the stale banner must clear.
  it('#1288: a saved roll row followed by the DM reply clears the failure banner', async () => {
    const onSendFullMessage = vi.fn(async () => {
      throw new Error('Request failed (500)');
    });
    const { rerender } = render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    await screen.findByRole('alert');

    const savedRow = {
      id: 'row-m5-perception',
      sender: 'player',
      text: 'Perception check: 7 (nat 6+1)',
      timestamp: new Date().toISOString(),
      context: { intent: 'dice_roll', rollRequestId: 'req-m5-perception' },
    } as unknown as ChatMessage;
    const reply = {
      id: 'dm-reply',
      sender: 'dm',
      text: 'You notice the loose stone.',
      timestamp: new Date().toISOString(),
    } as unknown as ChatMessage;
    rerender(<Prompt onSendFullMessage={onSendFullMessage} messages={[savedRow, reply]} />);

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  // #1288 review: a saved row with no DM reply is a turn still owed. The banner and Retry must
  // stay, because a resend is deduped against that row and is the only way to re-drive the turn.
  it('a saved roll row with no DM reply keeps Retry available', async () => {
    const onSendFullMessage = vi.fn(async () => {
      throw new Error('Request failed (500)');
    });
    const { rerender } = render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    await screen.findByRole('alert');

    const savedRow = {
      id: 'row-m5-perception',
      sender: 'player',
      text: 'Perception check: 7 (nat 6+1)',
      timestamp: new Date().toISOString(),
      context: { intent: 'dice_roll', rollRequestId: 'req-m5-perception' },
    } as unknown as ChatMessage;
    rerender(<Prompt onSendFullMessage={onSendFullMessage} messages={[savedRow]} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Roll submission failed. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  // #1288: an initiative prompt that opens after a failed narrative roll must show its own
  // ROLL D20 controls, never a Retry-only state that belongs to the earlier roll.
  it('#1288: a later initiative prompt does not inherit the earlier failure', async () => {
    const onSendFullMessage = vi.fn(async () => {
      throw new Error('Request failed (500)');
    });
    const { rerender } = render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    await screen.findByRole('button', { name: 'Retry' });

    const initiativeRoll = {
      id: 'init-1288',
      rollRequestId: 'req-init-1288',
      requestType: 'initiative',
      description: 'Roll initiative for the goblin ambush',
      status: 'pending' as const,
      rollConfig: { count: 1, dieType: 20, modifier: 1, advantage: false, disadvantage: false },
    };
    game.state.diceRollQueue = { currentRollId: initiativeRoll.id, pendingRolls: [initiativeRoll] };
    rerender(<Prompt onSendFullMessage={onSendFullMessage} />);

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(rollButton()).toBeEnabled();
    expect(onSendFullMessage).toHaveBeenCalledTimes(1);
  });

  // #1288 review: an engine-owned initiative prompt is dismissed by the engine, not through
  // handleCancelRoll. Once it closes, the earlier failed roll must not bring its Retry back.
  it('#1288: an engine-dismissed initiative prompt does not revive the earlier Retry', async () => {
    const onSendFullMessage = vi.fn(async () => {
      throw new Error('Request failed (500)');
    });
    const { rerender } = render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    await screen.findByRole('button', { name: 'Retry' });

    const initiativeRoll = {
      id: 'init-engine-1288',
      rollRequestId: 'req-init-engine-1288',
      requestType: 'initiative',
      description: 'Roll initiative for the goblin ambush',
      status: 'pending' as const,
      rollConfig: { count: 1, dieType: 20, modifier: 1, advantage: false, disadvantage: false },
    };
    game.state.diceRollQueue = { currentRollId: initiativeRoll.id, pendingRolls: [initiativeRoll] };
    rerender(<Prompt onSendFullMessage={onSendFullMessage} />);

    // The engine closes its own prompt: the queue empties without handleCancelRoll running.
    game.state.diceRollQueue = { currentRollId: '', pendingRolls: [] };
    rerender(<Prompt onSendFullMessage={onSendFullMessage} />);

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSendFullMessage).toHaveBeenCalledTimes(1);
  });

  // #1288 review: the row can match by its message id instead of rollRequestId.
  it('#1288: a saved row matched by message id, then the DM reply, clears the banner', async () => {
    const onSendFullMessage = vi.fn(async () => {
      throw new Error('Request failed (500)');
    });
    const { rerender } = render(<Prompt onSendFullMessage={onSendFullMessage} />);

    fireEvent.click(rollButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId('dice-animation'));
    });
    await screen.findByRole('alert');

    const savedRow = {
      id: 'm5-perception',
      sender: 'player',
      text: 'Perception check: 7 (nat 6+1)',
      timestamp: new Date().toISOString(),
    } as unknown as ChatMessage;
    const reply = {
      id: 'dm-reply-id',
      sender: 'dm',
      text: 'You notice the loose stone.',
      timestamp: new Date().toISOString(),
    } as unknown as ChatMessage;
    rerender(<Prompt onSendFullMessage={onSendFullMessage} messages={[savedRow, reply]} />);

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
