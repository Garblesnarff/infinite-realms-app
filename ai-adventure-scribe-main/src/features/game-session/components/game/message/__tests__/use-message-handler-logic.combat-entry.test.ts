/**
 * #400 — the message-handler half of the unlocked composer.
 *
 * The entry card is a question the player may answer by typing, so two things must hold:
 * 1. `handleSendMessage` settles a pending card (as declined) and marks the typed answer
 *    before queueing — without the settle, the queued send waits forever on a turn parked
 *    at the confirmation; without the mark, the new turn is re-prompted with another card.
 * 2. While a card is pending, the composer stays unblocked (dice-roll prompts still block).
 *
 * Both tests drive the REAL combat-entry-confirmation bridge: each fails if its branch is
 * removed from use-message-handler-logic.ts.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageHandlerLogic } from '../use-message-handler-logic';

import {
  consumeCombatEntryTypedAnswer,
  requestCombatEntryAnswer,
  requestCombatEntryConfirmation,
  setCombatEntryConfirmationHost,
  settlePendingCombatEntryConfirmation,
  type CombatEntryConfirmationHost,
} from '@/services/combat/combat-entry-confirmation-bridge';
import { startCombatEntryDelivery } from '@/services/combat/combat-entry-delivery';

const sendMessageMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const getAIResponseMock = vi.hoisted(() => vi.fn());
const enterCombatMock = vi.hoisted(() => vi.fn());
const queueCtl = vi.hoisted(() => ({
  isSending: false,
  actualSendMessageRef: {
    current: null as null | ((input: string, context?: unknown) => Promise<void>),
  },
  handleSendMessage: null as null | ((input: string, context?: unknown) => Promise<void>),
}));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [],
    messagesReady: true,
    sendMessage: sendMessageMock,
    updateMessage: vi.fn(),
  }),
}));
vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn(async () => {}) }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    processAiResponse: vi.fn(),
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
  }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: { id: 'char-1', name: 'The Scholar' } },
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: getAIResponseMock }),
}));
vi.mock('../use-message-command-handler', () => ({
  useMessageCommandHandler: () => ({
    handleSafetyCommand: async () => ({ isSafetyCommand: false }),
    handleDiceCommand: async () => ({ isDiceCommand: false }),
  }),
}));
vi.mock('../use-message-send-queue', () => ({
  useMessageSendQueue: () => ({
    handleSendMessage: (input: string, context?: unknown) =>
      queueCtl.handleSendMessage?.(input, context) ?? Promise.resolve(),
    isSending: queueCtl.isSending,
    actualSendMessageRef: queueCtl.actualSendMessageRef,
  }),
}));
vi.mock('../../session/SessionValidator', () => ({
  useSessionValidator: () => async () => true,
}));
vi.mock('../use-held-entry-recovery', () => ({
  useHeldEntryRecovery: () => {},
  playerMessageIsStillNewest: async () => true,
}));
vi.mock('@/infrastructure/api/rest-client', () => ({
  createTurnPhaseReporter: () => () => {},
  isNetworkError: () => false,
  QuotaExceededError: class QuotaExceededError extends Error {},
  DmProviderKeyLimitError: class DmProviderKeyLimitError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
  SESSION_EXPIRED_MESSAGE: 'Session expired',
  subscribeToNetworkRetry: () => (): void => {},
}));
vi.mock('@/services/auth/TokenService', () => ({ clearPendingInput: vi.fn() }));
vi.mock('@/services/user-data-api', () => ({
  isTerminalDefeatError: () => false,
  userDataApi: { enterCombat: enterCombatMock },
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const CARD_SPEC = {
  actorLabel: 'The Scholar',
  combatantLabels: ['Vance'],
  initiativeRoll: null,
  initiativeModifier: 2,
};

const renderHandler = () =>
  renderHook(() =>
    useMessageHandlerLogic({
      sessionId: 'session-1',
      campaignId: null,
      characterId: 'char-1',
      turnCount: 0,
      updateGameSessionState: vi.fn(async () => {}),
    }),
  );

describe('useMessageHandlerLogic combat entry (#400)', () => {
  let capturedSettle: ((confirmed: boolean, target?: string) => void) | null;

  const fakeHost: CombatEntryConfirmationHost = {
    present: (_spec, settle) => {
      capturedSettle = settle;
      return () => {};
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSettle = null;
    sendMessageMock.mockResolvedValue(undefined);
    queueCtl.isSending = false;
    queueCtl.handleSendMessage = async () => {};
    queueCtl.actualSendMessageRef.current = null;
  });

  afterEach(() => {
    // The bridge is module state: never leak a pending card, host or typed mark.
    settlePendingCombatEntryConfirmation(false);
    setCombatEntryConfirmationHost(null);
    consumeCombatEntryTypedAnswer('__cleanup__');
  });

  it('settle-then-mark: typing while the card is up settles it and arms the typed-answer skip', async () => {
    const { result } = renderHandler();

    let answerPromise: Promise<{ confirmed: boolean; target?: string }> | undefined;
    await act(async () => {
      setCombatEntryConfirmationHost(fakeHost, 'owner-1');
      answerPromise = requestCombatEntryAnswer(CARD_SPEC);
    });

    await act(async () => {
      await result.current.handleSendMessage('I swing my sword!');
    });

    // The parked confirmation resolves as declined — without the settle branch this
    // promise never resolves and the queued send would wait on it forever.
    if (!answerPromise) throw new Error('the entry card was never created');
    const answer = await Promise.race([
      answerPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the pending card was never settled')), 1000),
      ),
    ]);
    expect(answer).toEqual({ confirmed: false });
    expect(capturedSettle).not.toBeNull();
    // The mark arms the skip for the new turn — without the mark branch the next hold
    // re-prompts with another card.
    expect(consumeCombatEntryTypedAnswer('I swing my sword!')).toBe(true);
  });

  it('composer-unblock: a pending card releases the composer block', async () => {
    queueCtl.isSending = true;
    // The queue runs the real send pipeline; the DM turn never resolves, so the
    // composer stays blocked until the card — not the turn — releases it.
    let resolveTurn: (value: unknown) => void = () => {};
    getAIResponseMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTurn = resolve;
        }),
    );
    queueCtl.handleSendMessage = (input, context) =>
      queueCtl.actualSendMessageRef.current?.(input, context) ?? Promise.resolve();

    const { result } = renderHandler();

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.handleSendMessage('hello');
      await waitFor(() => expect(getAIResponseMock).toHaveBeenCalled());
    });
    // The send parked inside the DM turn with the composer blocked.
    expect(result.current.isProcessing).toBe(true);

    // A card becomes pending (the pre-DM hold of some other path, or the post-DM card):
    // the composer must unlock so the player can answer by typing. Without the
    // pending-change effect this stays blocked.
    await act(async () => {
      setCombatEntryConfirmationHost(fakeHost, 'owner-1');
      void requestCombatEntryAnswer(CARD_SPEC);
    });
    await waitFor(() => expect(result.current.isProcessing).toBe(false));

    resolveTurn({ text: 'done' });
    await sendPromise;
  });
});

describe('useMessageHandlerLogic timeout flag (#1315 round 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock.mockResolvedValue(undefined);
    queueCtl.isSending = false;
    queueCtl.handleSendMessage = (input, context) =>
      queueCtl.actualSendMessageRef.current?.(input, context) ?? Promise.resolve();
    queueCtl.actualSendMessageRef.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Drive a turn whose DM reply never resolves, so the 90 s turn timer ends
   * it. With pending=true the mocked reply first reports a pending combat
   * entry through the early-response callback (the message-handler-logic
   * :755 set); with pending=false it reports nothing. Returns the hook's
   * timedOutWithPendingEntry flag after the failed turn settles.
   */
  const driveTimeout = async (withPending: boolean): Promise<boolean> => {
    vi.useFakeTimers();
    getAIResponseMock.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as (early: unknown, options?: unknown) => Promise<void> | void;
      if (withPending) {
        await onTextReady(
          {
            id: 'dm-1',
            text: 'The sailors turn hostile.',
            context: { combat_entry_pending: true },
          },
          {},
        );
      }
      // Never resolves: only the 90 s timer ends this turn.
      return new Promise(() => {});
    });
    const { result } = renderHandler();
    let sendPromise: Promise<void> | undefined;
    let sendError: unknown;
    await act(async () => {
      sendPromise = result.current.handleSendMessage('Turn and Face the Gilded Sailors');
      // The failure path rethrows after setting the chip, so attach the
      // rejection handler NOW — otherwise the timeout's AbortError counts
      // as unhandled before the test awaits it below.
      sendPromise.catch((error: unknown) => {
        sendError = error;
      });
      for (let i = 0; i < 50 && getAIResponseMock.mock.calls.length === 0; i++) {
        await Promise.resolve();
      }
    });
    expect(getAIResponseMock).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    await act(async () => {
      await sendPromise?.catch(() => {});
    });
    expect((sendError as { name?: string } | undefined)?.name).toBe('AbortError');
    return result.current.timedOutWithPendingEntry;
  };

  it('timeout after a pending entry sets the flag', async () => {
    expect(await driveTimeout(true)).toBe(true);
  });

  it('plain timeout does not set the flag', async () => {
    expect(await driveTimeout(false)).toBe(false);
  });
});

/**
 * #1668: one DM reply carries a fight card and a save roll. The player answers the save roll
 * while the fight card is still up. The roll answer is not an answer to the card, so the
 * delivery must keep waiting. Only the card's own Decline may return `declined`.
 */
describe('a roll answered while the fight card is up (#1668)', () => {
  let capturedSettle: ((confirmed: boolean, target?: string) => void) | null = null;
  const host: CombatEntryConfirmationHost = {
    present: (_spec, settle) => {
      capturedSettle = settle;
      return () => {};
    },
  };
  const PENDING = {
    combatants: [{ name: 'Vance' }],
    sceneSpec: {},
  } as unknown as Parameters<typeof startCombatEntryDelivery>[0]['pending'];
  const PLAYER = { name: 'The Scholar', initiativeModifier: 2 } as Parameters<
    typeof startCombatEntryDelivery
  >[0]['player'];
  const SAVE_ROLL_CONTEXT = {
    intent: 'dice_roll',
    rollRequestId: 'roll-save-1668',
    diceRoll: {
      formula: '1d20+2',
      count: 1,
      dieType: 20,
      modifier: 2,
      results: [18],
      total: 20,
      requestType: 'save',
      description: 'Dexterity save',
    },
  } as unknown as Parameters<
    ReturnType<typeof renderHandler>['result']['current']['handleSendMessage']
  >[1];

  const delay = (ms: number): Promise<'still-waiting'> =>
    new Promise((resolve) => setTimeout(() => resolve('still-waiting'), ms));

  const startDelivery = (sessionId: string) =>
    startCombatEntryDelivery({
      sessionId,
      pending: PENDING,
      player: PLAYER,
      confirm: () => requestCombatEntryConfirmation(CARD_SPEC),
      rollInitiative: async () => ({ d20: null }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSettle = null;
    queueCtl.handleSendMessage = async () => {};
    enterCombatMock.mockReset();
    enterCombatMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ encounter: { id: 'enc-1668' } }),
    });
    setCombatEntryConfirmationHost(host, 'owner-1668');
  });

  afterEach(() => {
    settlePendingCombatEntryConfirmation(false);
    setCombatEntryConfirmationHost(null);
    consumeCombatEntryTypedAnswer('__cleanup__');
  });

  it('the save roll answer does not decline the card: the delivery keeps waiting', async () => {
    const { result } = renderHandler();
    const delivery = startDelivery('session-1668-roll');
    await waitFor(() => expect(capturedSettle).not.toBeNull());

    await act(async () => {
      await result.current.handleSendMessage('Rolled 20 on the Dexterity save', SAVE_ROLL_CONTEXT);
    });

    // On main this resolves `declined` at once: handleSendMessage settles the card as
    // "typed a different answer" before it knows the send is a roll answer.
    const outcome = await Promise.race([delivery.then((r) => r.kind), delay(100)]);
    expect(outcome).toBe('still-waiting');

    // The player now presses Start the fight: the delivery seats the encounter.
    capturedSettle?.(true);
    await expect(delivery).resolves.toMatchObject({ kind: 'seated', encounterId: 'enc-1668' });
  });

  it('a real Decline on the card still resolves the delivery as declined (#400)', async () => {
    const { result } = renderHandler();
    const delivery = startDelivery('session-1668-decline');
    await waitFor(() => expect(capturedSettle).not.toBeNull());

    await act(async () => {
      await result.current.handleSendMessage('Rolled 20 on the Dexterity save', SAVE_ROLL_CONTEXT);
    });
    // The card's own Decline, after the roll answer, is the real decline.
    capturedSettle?.(false);
    await expect(delivery).resolves.toEqual({ kind: 'declined' });
    expect(enterCombatMock).not.toHaveBeenCalled();
  });
});
