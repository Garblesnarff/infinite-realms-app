/**
 * #2190 replay: the combat-entry roll sequence from run 9 (Terra) and run M3 (Muse).
 *
 * What happened on those runs: the DM's combat-start response carried raw `initiative` and
 * `attack` roll_requests — its engine declaration channel — and the early prompt put them in the
 * player's dice popup. The player rolled an initiative the engine never saw (it auto-rolled its
 * own after 30s behind the visible slot), and then answered the raw attack prompt, whose result
 * no engine settler owned and which was posted to the DM as a player message: "The Veteran
 * attacks a Chiropteran Hulk with their longsword: 9 (nat 4+5) miss". A turn for an attack the
 * engine says never happened.
 *
 * This test drives the real queue reducer, the real dice-roll management, the real bridge and the
 * real dice handler together, so the pieces that must agree are exercised as one path.
 */
import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageDiceRolls } from '../use-message-dice-rolls';

import { gameReducer, initialGameState } from '@/contexts/game/game-reducer';
import { useDiceRollManagement } from '@/contexts/game/use-dice-roll-management';
import { usePlayerRollHost } from '@/hooks/combat/use-player-roll-host';
import {
  PLAYER_INITIATIVE_ROLL_TIMEOUT_MS,
  requestPlayerInitiativeRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';
import { rollDice } from '@/utils/diceUtils';

const { gameRef } = vi.hoisted(() => ({
  gameRef: { current: null as unknown as Record<string, unknown> },
}));

// The one seam: `useGame` reads the harness store below, which is the real reducer.
vi.mock('@/contexts/GameContext', () => ({ useGame: () => gameRef.current }));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/utils/diceUtils', () => ({ rollDice: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type GameStore = ReturnType<typeof useDiceRollManagement> & {
  state: typeof initialGameState;
  /** Stands in for CombatContext reporting the seated encounter, which GameContext mirrors. */
  seatEncounter: () => void;
};

interface DiceHandle {
  handleDiceRoll: (formula: string) => Promise<void>;
  currentRollDescription: string | null;
  currentRollId: string | null;
  pendingRollIds: string[];
}

const onSendFullMessage = vi.fn().mockResolvedValue(undefined);
const onSendMessage = vi.fn().mockResolvedValue(undefined);

function Harness({ handle }: { handle: { current: DiceHandle | null } }): React.ReactElement {
  const [state, dispatch] = React.useReducer(gameReducer, initialGameState);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const dice = useDiceRollManagement(state, dispatch, stateRef);
  const seatEncounter = React.useCallback(
    () => dispatch({ type: 'SET_COMBAT_STATE', payload: { isInCombat: true } }),
    [dispatch],
  );
  gameRef.current = { state, ...dice, seatEncounter } as unknown as GameStore;
  return <DiceConsumer handle={handle} />;
}

function DiceConsumer({ handle }: { handle: { current: DiceHandle | null } }): null {
  usePlayerRollHost();
  const { currentRoll, handleDiceRoll } = useMessageDiceRolls({
    onSendMessage,
    onSendFullMessage,
  });
  const store = gameRef.current as unknown as GameStore;
  handle.current = {
    handleDiceRoll,
    currentRollDescription: currentRoll?.description ?? null,
    currentRollId: currentRoll?.id ?? null,
    pendingRollIds: store.state.diceRollQueue.pendingRolls
      .filter((roll) => roll.status === 'pending')
      .map((roll) => roll.id),
  };
  return null;
}

function renderHarness(): { handle: { current: DiceHandle | null }; unmount: () => void } {
  const handle: { current: DiceHandle | null } = { current: null };
  const { unmount } = render(<Harness handle={handle} />);
  return { handle, unmount };
}

/** The raw `initiative`/`attack` entries the DM sends on a combat-start turn. */
function queueRawDmRequest(requestType: 'initiative' | 'attack', description: string): string {
  const store = gameRef.current as unknown as GameStore;
  return store.requestDiceRoll({
    requestType,
    description,
    rollConfig: { dieType: 20, count: 1, modifier: requestType === 'initiative' ? 1 : 5 },
  } as never);
}

describe('combat-entry roll prompts (#2190)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    onSendFullMessage.mockResolvedValue(undefined);
    onSendMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.useRealTimers();
  });

  it("uses the player's initiative die and never posts the raw attack as a player message", async () => {
    const { handle, unmount } = renderHarness();

    // Run 9, step 1: the DM's combat-start response carries both raw requests. Even if one of
    // them reaches the queue, the engine's own prompt must end up in the visible slot.
    let rawInitiativeId = '';
    let rawAttackId = '';
    await act(async () => {
      rawInitiativeId = queueRawDmRequest('initiative', 'Initiative roll for the party');
      rawAttackId = queueRawDmRequest('attack', 'Longsword attack vs a Chiropteran Hulk — 1d20+5');
    });
    expect(handle.current?.currentRollId).toBe(rawInitiativeId);

    // Step 2: the entry gate asks for the player's initiative through the engine's own prompt.
    let enginePrompt: Promise<{ d20: number | null }> | undefined;
    await act(async () => {
      enginePrompt = requestPlayerInitiativeRoll({
        actorLabel: 'The Veteran',
        initiativeModifier: 1,
      });
    });

    // It takes the visible slot instead of queueing behind the DM's declaration requests.
    expect(handle.current?.currentRollDescription).toBe('Initiative for The Veteran — 1d20+1');
    const enginePromptId = handle.current?.currentRollId;
    expect(enginePromptId).not.toBe(rawInitiativeId);

    // Step 3: the player rolls a natural 9. On the failing runs this number was thrown away and
    // the engine used its own auto-roll; here it is the number the engine receives.
    vi.mocked(rollDice).mockReturnValue({
      total: 10,
      naturalRoll: 9,
      results: [9],
      keptResults: [9],
      critical: false,
    } as never);
    await act(async () => {
      await handle.current?.handleDiceRoll('1d20+1');
    });

    await expect(enginePrompt).resolves.toEqual({ d20: 9 });
    expect(onSendFullMessage).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();

    // Step 4: `/enter` has seated the encounter, which GameContext mirrors from CombatContext.
    await act(async () => {
      (gameRef.current as unknown as GameStore).seatEncounter();
    });

    // The DM's raw declaration requests are what is left in the queue. Answering either of them
    // must not reach the DM — that is the fabricated "attacks a Chiropteran Hulk … miss" player
    // message that started a turn for an attack the engine never resolved.
    vi.mocked(rollDice).mockReturnValue({
      total: 9,
      naturalRoll: 4,
      results: [4],
      keptResults: [4],
      critical: false,
    } as never);

    expect(handle.current?.currentRollId).toBe(rawInitiativeId);
    await act(async () => {
      await handle.current?.handleDiceRoll('1d20+1');
    });

    expect(handle.current?.currentRollId).toBe(rawAttackId);
    await act(async () => {
      await handle.current?.handleDiceRoll('1d20+5');
    });

    // The whole sequence produced no player message at all: only the engine's own transcript
    // lines describe this combat entry.
    expect(onSendFullMessage).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();

    unmount();
  });

  it('auto-rolls the engine initiative prompt only when the player never answers it', async () => {
    vi.useFakeTimers();
    const { handle, unmount } = renderHarness();

    let enginePrompt: Promise<{ d20: number | null }> | undefined;
    await act(async () => {
      enginePrompt = requestPlayerInitiativeRoll({
        actorLabel: 'The Faithful',
        initiativeModifier: 2,
      });
    });
    expect(handle.current?.currentRollDescription).toBe('Initiative for The Faithful — 1d20+2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYER_INITIATIVE_ROLL_TIMEOUT_MS);
    });

    await expect(enginePrompt).resolves.toEqual({ d20: null });
    expect(onSendFullMessage).not.toHaveBeenCalled();

    unmount();
  });
});
