/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2587 (run D7) and #2481 (run C1 T7): the initiative result was dropped, `/enter` was never sent.
 *
 * What happened: the player rolled a narrative check (Perception, Acrobatics). The dice handler
 * sends that result as a DM turn and awaits it, and the turn is the whole pipeline: the DM reply,
 * the combat-entry confirmation, the initiative prompt and `/enter`. So the narrative roll's
 * `handleManualResult` was still running when the initiative dialog opened. The handler's single
 * in-flight guard then dropped the initiative result without a log line or an error, the
 * commit had already stopped the bridge's timer, and nothing was left to settle the prompt.
 *
 * This test drives the real queue reducer, dice management, popup host, bridge, dice handler and
 * the real combat-entry handler together. Only the network edge (`userDataApi`) is mocked.
 *
 * Producers: `PENDING_ENTRY` is the `combat_entry_pending` the server's `/v1/llm/generate` sends
 * (`trigger: 'combat_transition'`, as in the D7 `COMBAT_ENTRY_DETECTED_PENDING_PLAYER_ENTRY` line);
 * the `/enter` body is what `userDataApi.enterCombat` is called with by `dm-actions-handler`.
 */
import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageDiceRolls } from '../use-message-dice-rolls';

import { gameReducer, initialGameState } from '@/contexts/game/game-reducer';
import { useDiceRollManagement } from '@/contexts/game/use-dice-roll-management';
import { handleDmActionsAndTransitions } from '@/hooks/ai/dm-actions-handler';
import { usePlayerRollHost } from '@/hooks/combat/use-player-roll-host';
import {
  clearCombatEntryConfirmationHost,
  setCombatEntryConfirmationHost,
  type CombatEntryConfirmationHost,
} from '@/services/combat/combat-entry-confirmation-bridge';
import {
  hasPendingPlayerRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

const { gameRef } = vi.hoisted(() => ({
  gameRef: { current: null as unknown as Record<string, unknown> },
}));

vi.mock('@/contexts/GameContext', () => ({ useGame: () => gameRef.current }));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    enterCombat: vi.fn(),
    endTacticalMap: vi.fn().mockResolvedValue({ ok: true }),
    applyDmTacticalActions: vi.fn().mockResolvedValue({ ok: true }),
    applyDmHandoutActions: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  },
}));

type GameStore = ReturnType<typeof useDiceRollManagement> & { state: typeof initialGameState };

interface DiceHandle {
  handleManualResult: (result: number, details?: { naturalRoll: number }) => Promise<void>;
  handleCancelRoll: () => void;
  currentRollId: string | null;
  currentRollDescription: string | null;
  pendingRollId: string | null;
}

const PLAYER = {
  id: 'char-1',
  name: 'The Scholar',
  dexterity: 12,
  currentHitPoints: 7,
  maxHitPoints: 7,
};

const PENDING_ENTRY = {
  trigger: 'combat_transition' as const,
  detail: 'combat_transition=start',
  combatants: [{ name: 'Wall-Mouth', count: 1 }],
  sceneSpec: { environment: 'dungeon_room' },
  sceneSpecSynthesized: false,
};

const enterResponse = (payload: Record<string, unknown> = {}) => ({
  ok: true,
  status: 201,
  json: vi.fn().mockResolvedValue(payload),
});

const refreshCombatState = vi.fn().mockResolvedValue(null);
let confirmationSettle: ((confirmed: boolean) => void) | null = null;
let confirmationHost: CombatEntryConfirmationHost;

/** The turn the dice handler awaits: the DM reply carries `combat_entry_pending`. */
const entryTurn = vi.fn(async () => {
  await handleDmActionsAndTransitions({
    sessionId: 'session-1',
    result: {
      text: 'The wall opens into a mouth.',
      combat_transition: 'start',
      combat_entry_pending: PENDING_ENTRY,
    },
    characterRecord: PLAYER,
    activeEncounter: null,
    isInCombat: false,
    refreshCombatState,
    aiContext: { gameState: {} },
    conversationHistory: [],
    playerMessage: 'Perception 15 (nat 13+2)',
  } as any);
});

function Harness({ handle }: { handle: { current: DiceHandle | null } }): React.ReactElement {
  const [state, dispatch] = React.useReducer(gameReducer, initialGameState);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const dice = useDiceRollManagement(state, dispatch, stateRef);
  gameRef.current = { state, ...dice } as unknown as GameStore;
  return <DiceConsumer handle={handle} />;
}

function DiceConsumer({ handle }: { handle: { current: DiceHandle | null } }): null {
  usePlayerRollHost();
  const { currentRoll, handleManualResult, handleCancelRoll, pendingRollId } = useMessageDiceRolls({
    onSendMessage: vi.fn().mockResolvedValue(undefined),
    onSendFullMessage: entryTurn,
  });
  handle.current = {
    handleManualResult,
    handleCancelRoll,
    currentRollId: currentRoll?.id ?? null,
    currentRollDescription: currentRoll?.description ?? null,
    pendingRollId,
  };
  return null;
}

function renderHarness(): { handle: { current: DiceHandle | null }; unmount: () => void } {
  const handle: { current: DiceHandle | null } = { current: null };
  const { unmount } = render(<Harness handle={handle} />);
  return { handle, unmount };
}

const queueNarrativeRoll = (description: string): string =>
  (gameRef.current as unknown as GameStore).requestDiceRoll({
    requestType: 'skill_check',
    description,
    rollConfig: { dieType: 20, count: 1, modifier: 2 },
  } as never);

/** Rolls the narrative check and leaves its turn running, as the real dice handler does. */
async function rollNarrativeCheckIntoEntry(handle: { current: DiceHandle | null }): Promise<{
  narrativeRollDone: Promise<void>;
  narrativeRollId: string;
}> {
  let narrativeRollId = '';
  await act(async () => {
    narrativeRollId = queueNarrativeRoll('Perception check');
  });
  let narrativeRollDone!: Promise<void>;
  await act(async () => {
    narrativeRollDone = handle.current!.handleManualResult(15, { naturalRoll: 13 });
  });
  expect(entryTurn).toHaveBeenCalledTimes(1);
  // The turn reached the entry card; the player chooses Strike.
  expect(confirmationSettle).not.toBeNull();
  await act(async () => {
    confirmationSettle!(true);
  });
  return { narrativeRollDone, narrativeRollId };
}

describe('initiative rolled while a narrative roll turn is still running (#2587, #2481)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    confirmationSettle = null;
    confirmationHost = {
      present: (_spec, settle) => {
        confirmationSettle = settle;
        return () => undefined;
      },
    };
    setCombatEntryConfirmationHost(confirmationHost, 'session-1');
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      enterResponse({ encounter: { id: 'encounter-1' } }) as any,
    );
  });

  afterEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    clearCombatEntryConfirmationHost(confirmationHost);
  });

  it('initiative roll commits → exactly one enterCombat call carrying the rolled d20', async () => {
    const { handle, unmount } = renderHarness();
    const { narrativeRollDone, narrativeRollId } = await rollNarrativeCheckIntoEntry(handle);

    // The initiative dialog replaces the narrative one in the roll tray.
    expect(handle.current?.currentRollDescription).toBe('Initiative for The Scholar — 1d20+1');
    expect(hasPendingPlayerRoll()).toBe(true);

    // Hold `/enter` open so the narrative roll's turn is still running when the die settles.
    let finishEnter!: () => void;
    vi.mocked(userDataApi.enterCombat).mockReturnValueOnce(
      new Promise((resolve) => {
        finishEnter = () => resolve(enterResponse({ encounter: { id: 'encounter-1' } }) as any);
      }) as any,
    );

    // The dialog's animation lands nat 2 → total 3 and reports it, as in D7.
    await act(async () => {
      await handle.current!.handleManualResult(3, { naturalRoll: 2 });
    });

    expect(hasPendingPlayerRoll()).toBe(false);
    // The narrative roll's handler is still awaiting its turn, so it is still the pending roll.
    expect(handle.current?.pendingRollId).toBe(narrativeRollId);
    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    expect(userDataApi.enterCombat).toHaveBeenCalledWith('session-1', {
      combatants: PENDING_ENTRY.combatants,
      sceneSpec: PENDING_ENTRY.sceneSpec,
      player: {
        characterId: 'char-1',
        name: 'The Scholar',
        initiativeModifier: 1,
        hpCurrent: 7,
        hpMax: 7,
      },
      playerInitiativeRoll: 2,
    });

    await act(async () => {
      finishEnter();
      await narrativeRollDone;
    });
    expect(handle.current?.pendingRollId).toBeNull();
    unmount();
  });

  it('a hand-entered initiative after an Acrobatics check reaches /enter, not the engine auto-roll (#2481)', async () => {
    const { handle, unmount } = renderHarness();
    await act(async () => {
      queueNarrativeRoll('Acrobatics check');
    });
    let narrativeRollDone!: Promise<void>;
    await act(async () => {
      narrativeRollDone = handle.current!.handleManualResult(4, { naturalRoll: 1 });
    });
    await act(async () => {
      confirmationSettle!(true);
    });
    expect(handle.current?.currentRollDescription).toBe('Initiative for The Scholar — 1d20+1');

    // "Enter my own roll": a typed number has no details and IS the die (the popup asks for 1d20).
    await act(async () => {
      await handle.current!.handleManualResult(12);
    });

    expect(hasPendingPlayerRoll()).toBe(false);
    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    expect(vi.mocked(userDataApi.enterCombat).mock.calls[0][1]).toMatchObject({
      playerInitiativeRoll: 12,
    });
    // No stale Acrobatics dialog is left in the tray once the initiative has settled.
    expect(handle.current?.currentRollId).toBeNull();
    await act(async () => {
      await narrativeRollDone;
    });
    unmount();
  });
});
