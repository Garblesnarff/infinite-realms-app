/**
 * #2200: the attack prompt must commit its timeout when the player clicks Roll.
 *
 * `requestPlayerAttackRoll` is bounded (#2190) and the popup takes ~3.5s to produce a result, so a
 * click in the last few seconds of the window used to lose the race: the timeout settled
 * `{ d20: null }`, the engine rolled its own d20, and the player's die was then dropped as an
 * unowned combat roll. No fabrication and no hang — just a visible mismatch between the number the
 * player saw and the number the narration used.
 *
 * The wiring being tested is `MessageListContainer`'s `onRollCommit` condition, so this drives the
 * real container, the real popup, the real queue reducer and the real bridge together.
 */
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageListContainer } from '../MessageListContainer';

import { gameReducer, initialGameState } from '@/contexts/game/game-reducer';
import { useDiceRollManagement } from '@/contexts/game/use-dice-roll-management';
import {
  PLAYER_ATTACK_ROLL_TIMEOUT_MS,
  requestPlayerAttackRoll,
  requestPlayerInitiativeRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';
import { DiceEngine } from '@/services/dice/DiceEngine';

const { gameRef } = vi.hoisted(() => ({
  gameRef: { current: null as unknown as Record<string, unknown> },
}));

// The one seam: `useGame` reads the harness store below, which is the real reducer.
vi.mock('@/contexts/GameContext', () => ({ useGame: () => gameRef.current }));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { activeEncounter: null }, refreshCombatState: vi.fn() }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('../MessageRenderer', () => ({ MessageRenderer: () => null }));

vi.mock('howler', () => ({
  Howl: class {
    play(): void {}
    unload(): void {}
  },
}));

vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: { roll: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ATTACK_SPEC = {
  actorLabel: 'The Veteran',
  targetLabel: 'Chiropteran Hulk',
  weaponName: 'Longsword',
  attackBonus: 5,
  targetAc: 14,
  advantage: false,
  disadvantage: false,
};

const onSendFullMessage = vi.fn().mockResolvedValue(undefined);
const onSendMessage = vi.fn().mockResolvedValue(undefined);

function Harness(): React.ReactElement {
  const [state, dispatch] = React.useReducer(gameReducer, initialGameState);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const dice = useDiceRollManagement(state, dispatch, stateRef);
  gameRef.current = { state, ...dice };
  return (
    <MessageListContainer
      messages={[]}
      messagesRef={React.createRef<HTMLDivElement>()}
      expandedMessages={new Set()}
      setExpandedMessages={vi.fn()}
      imageByMessage={{}}
      generatingFor={new Set()}
      genErrorByMessage={{}}
      onGenerateScene={vi.fn().mockResolvedValue(undefined)}
      onOptionSelect={vi.fn().mockResolvedValue(undefined)}
      onSendMessage={onSendMessage}
      onSendFullMessage={onSendFullMessage}
      sessionId="session-2200"
    />
  );
}

describe('attack roll commit (#2200)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    onSendFullMessage.mockResolvedValue(undefined);
    onSendMessage.mockResolvedValue(undefined);
    // The popup's own animation produces this; the natural face is what the engine consumes.
    vi.mocked(DiceEngine.roll).mockReturnValue({
      expression: '1d20+5',
      total: 18,
      rolls: [{ dice: 20, value: 13 }],
      modifiers: 5,
      naturalRoll: 13,
      timestamp: 0,
    } as never);
  });

  afterEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.useRealTimers();
  });

  it("clears the attack timeout on the click and settles the engine with the player's die", async () => {
    render(<Harness />);

    let attackPrompt: Promise<{ d20: number | null }> | undefined;
    let settledWith: { d20: number | null } | undefined;
    await act(async () => {
      attackPrompt = requestPlayerAttackRoll(ATTACK_SPEC);
      void attackPrompt.then((outcome) => {
        settledWith = outcome;
      });
    });

    // The popup is up, asking for the engine's attack die.
    const prompt = screen.getByTestId('dice-roll-request');
    expect(prompt.getAttribute('aria-label')).toContain('Longsword attack vs Chiropteran Hulk');

    // The player takes 44 of the 45 seconds to decide, then clicks Roll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(44_000);
    });
    expect(settledWith).toBeUndefined();

    const rollButton = screen.getByLabelText(/^Roll 1d20\+5 for/);
    await act(async () => {
      rollButton.click();
    });

    // The click commits the roll, so crossing the timeout no longer auto-rolls it away.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYER_ATTACK_ROLL_TIMEOUT_MS);
    });

    // The animation finishes (1.5s roll + 2s result) and the player's own die reaches the engine —
    // not the `{ d20: null }` the timeout would have produced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    // The player's own natural 13 settled the attack — before #2200 this resolved `{ d20: null }`
    // and the engine rolled its own. It is the bare face, not the popup's 1d20+5 total of 18: the
    // engine adds the bonus itself (#2210).
    await expect(attackPrompt).resolves.toEqual({ d20: 13 });
    expect(settledWith?.d20).not.toBeNull();
    // The die went to the engine, never to the DM as a player message.
    expect(onSendFullMessage).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  /**
   * #2210: the animated popup reports its total (the formula includes the engine's bonus), while
   * the engine settlers take the bare d20 and add the bonus themselves. The popup must hand them
   * the natural face.
   */
  it('settles an animated attack roll with the natural face, not the total', async () => {
    render(<Harness />);

    let attackPrompt: Promise<{ d20: number | null }> | undefined;
    await act(async () => {
      attackPrompt = requestPlayerAttackRoll(ATTACK_SPEC);
    });

    await act(async () => {
      screen.getByLabelText(/^Roll 1d20\+5 for/).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    // DiceEngine rolled 1d20+5 = 18 on a natural 13. 18 here would become 18 + 5 = 23.
    await expect(attackPrompt).resolves.toEqual({ d20: 13 });
    expect(onSendFullMessage).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('settles an animated initiative roll whose total is over 20, with the natural face', async () => {
    vi.mocked(DiceEngine.roll).mockReturnValue({
      expression: '1d20+4',
      total: 23,
      rolls: [{ dice: 20, value: 19 }],
      modifiers: 4,
      naturalRoll: 19,
      timestamp: 0,
    } as never);
    render(<Harness />);

    let initiativePrompt: Promise<{ d20: number | null }> | undefined;
    await act(async () => {
      initiativePrompt = requestPlayerInitiativeRoll({
        actorLabel: 'The Veteran',
        initiativeModifier: 4,
      });
    });

    await act(async () => {
      screen.getByLabelText(/^Roll 1d20\+4 for/).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    // A total of 23 used to fail the 1–20 face guard and be discarded silently, leaving the
    // prompt open until the timeout auto-rolled it.
    await expect(initiativePrompt).resolves.toEqual({ d20: 19 });
    expect(onSendFullMessage).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  /** #2530: a prompt on a timer shows the timer, and stops showing it once the click commits. */
  it('shows the auto-roll countdown on the attack prompt until the player clicks Roll', async () => {
    render(<Harness />);

    await act(async () => {
      void requestPlayerAttackRoll(ATTACK_SPEC);
    });
    expect(screen.getByTestId('roll-auto-countdown').textContent).toBe(
      "Rolls for you in 45s if you don't.",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByTestId('roll-auto-countdown').textContent).toBe(
      "Rolls for you in 25s if you don't.",
    );

    await act(async () => {
      screen.getByLabelText(/^Roll 1d20\+5 for/).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByTestId('roll-auto-countdown')).toBeNull();
  });
});
