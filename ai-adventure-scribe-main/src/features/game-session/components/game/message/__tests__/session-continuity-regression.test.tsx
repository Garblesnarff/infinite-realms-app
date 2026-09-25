/**
 * Regression tests: session continuity & memory write integrity after roll-gated turns.
 *
 * Guards against recurrence of the stale-session FK bug (PostgreSQL 23503):
 *   processSendQueue had [] deps, capturing first-render's actualSendMessage —
 *   freezing sessionId. After session expiry, AI calls and memory inserts used
 *   the deleted session_id. Fix: synchronous actualSendMessageRef.current = actualSendMessage
 *   (MessageHandler.tsx line 545) ensures every dispatch uses the latest closure.
 */
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ------- hoisted mock factories (must be accessible inside vi.mock factories) -------
const {
  mockExtractMemories,
  mockGetAIResponse,
  mockOnAIResponse,
  mockSendMessage,
  mockUpdateMessage,
  mockProcessAiResponse,
  mockToast,
  mockValidateSession,
  mockParseDiceCommand,
  mockRollDice,
} = vi.hoisted(() => ({
  mockExtractMemories: vi.fn().mockResolvedValue(undefined),
  mockGetAIResponse: vi.fn().mockResolvedValue({
    text: 'The goblin snarls.',
    rollRequests: [],
  }),
  mockOnAIResponse: vi.fn().mockResolvedValue(undefined),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockUpdateMessage: vi.fn(),
  mockProcessAiResponse: vi.fn(),
  mockToast: vi.fn(),
  mockValidateSession: vi.fn().mockResolvedValue(true),
  mockParseDiceCommand: vi.fn(),
  mockRollDice: vi.fn(),
}));

// ------- module mocks (hoisted to top by Vitest; must appear before imports) -------
vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({
    memories: [],
    isLoading: false,
    createMemory: vi.fn(),
    extractMemories: mockExtractMemories,
  }),
}));

vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: mockGetAIResponse }),
}));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [],
    sendMessage: mockSendMessage,
    updateMessage: mockUpdateMessage,
    queueStatus: 'idle' as const,
    isLoading: false,
    isFetchingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({ processAiResponse: mockProcessAiResponse, state: {} }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({ isSafetyCommand: false }),
  processSafetyCommand: vi.fn(),
}));

vi.mock('@/utils/diceCommandParser', () => ({
  parseDiceCommand: mockParseDiceCommand,
}));

vi.mock('@/utils/chatSanitizer', () => ({
  sanitizeDMText: (text: string) => text,
}));

vi.mock('@/utils/diceUtils', () => ({ rollDice: mockRollDice }));

vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Resolves to same file as MessageHandler's relative '../session/SessionValidator'
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => mockValidateSession,
}));

// ------- imports (after mocks) -------
import { MessageHandler } from '../MessageHandler';

import logger from '@/lib/logger';

// ------- shared types -------
type DiceRollContext = {
  intent: 'dice_roll';
  diceRoll?: {
    formula: string;
    count: number;
    dieType: number;
    modifier: number;
    total: number;
    naturalRoll?: number;
    critical?: boolean;
  };
};

// ------- test helpers -------
interface HandlerRef {
  send: (text: string, ctx?: DiceRollContext) => Promise<void>;
  processing: { current: boolean };
}

function makeUpdateStateMock() {
  // updateGameSessionState is called with a function updater (prev) => ({...prev, ...})
  return vi.fn().mockResolvedValue(undefined);
}

function renderHandler(
  sessionId: string,
  onAIResponse?: (message: { text: string }) => Promise<void>,
) {
  const ref: HandlerRef = { send: async () => {}, processing: { current: false } };
  const updateGameSessionState = makeUpdateStateMock();

  const result = render(
    <MessageHandler
      sessionId={sessionId}
      campaignId="campaign-1"
      characterId="char-1"
      turnCount={0}
      updateGameSessionState={updateGameSessionState}
      onAIResponse={onAIResponse}
    >
      {({ handleSendMessage, isProcessing }) => {
        ref.send = handleSendMessage;
        ref.processing.current = isProcessing;
        return null;
      }}
    </MessageHandler>,
  );

  return { result, ref, updateGameSessionState };
}

/** `setComposerBlocked(false)` reports this phase; a turn that leaves the composer locked never does. */
function composerEnabledCount(): number {
  return vi
    .mocked(logger.info)
    .mock.calls.filter(
      ([event, data]) =>
        event === 'TURN_PHASE' && (data as { phase?: string })?.phase === 'composer enabled',
    ).length;
}

function dmPersisted(): Array<{
  text?: string;
  rollRequests?: Array<{ type: string }>;
  context?: { intent?: string; rollRequests?: Array<{ type: string }> };
}> {
  return mockSendMessage.mock.calls
    .map(
      ([message]) =>
        message as {
          sender?: string;
          text?: string;
          rollRequests?: Array<{ type: string }>;
          context?: { intent?: string; rollRequests?: Array<{ type: string }> };
        },
    )
    .filter((message) => message.sender === 'dm');
}

function rerenderHandler(
  renderResult: ReturnType<typeof render>,
  ref: HandlerRef,
  sessionId: string,
) {
  const updateGameSessionState = makeUpdateStateMock();
  renderResult.rerender(
    <MessageHandler
      sessionId={sessionId}
      campaignId="campaign-1"
      characterId="char-1"
      turnCount={0}
      updateGameSessionState={updateGameSessionState}
    >
      {({ handleSendMessage, isProcessing }) => {
        ref.send = handleSendMessage;
        ref.processing.current = isProcessing;
        return null;
      }}
    </MessageHandler>,
  );
}

// ------- regression tests -------
describe('session-continuity regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateSession.mockResolvedValue(true);
    mockSendMessage.mockResolvedValue(undefined);
    mockExtractMemories.mockResolvedValue(undefined);
    mockGetAIResponse.mockResolvedValue({ text: 'The goblin snarls.', rollRequests: [] });
    mockParseDiceCommand.mockReturnValue(null);
    mockRollDice.mockReturnValue({
      results: [15],
      keptResults: [15],
      total: 15,
      naturalRoll: 15,
      critical: false,
    });
  });

  it('dispatches getAIResponse with the current sessionId after a prop change (stale-closure regression)', async () => {
    // Render with session-A, then change to session-B before sending.
    // actualSendMessageRef is updated synchronously on every render,
    // so processSendQueue must call getAIResponse with session-B.
    const { result, ref } = renderHandler('session-A');
    rerenderHandler(result, ref, 'session-B');

    await act(async () => {
      await ref.send('I search the room for traps');
    });

    expect(mockGetAIResponse).toHaveBeenCalledWith(
      expect.any(Array),
      'session-B', // must NOT be stale "session-A"
      undefined,
      expect.any(Function),
      expect.any(Function),
      expect.any(String), // #2218: the DM row id reserved for this turn
    );
  });

  it('skips memory extraction for the dice_roll input but extracts from the AI response that follows', async () => {
    // After a roll-gated turn the player message has intent='dice_roll'.
    // MessageHandler guards against extracting transient roll scaffolding (line 341-343),
    // but MUST still extract the AI narrative that follows.
    const AI_NARRATIVE = 'Your blade finds its mark — 8 piercing damage!';
    mockGetAIResponse.mockResolvedValue({ text: AI_NARRATIVE, rollRequests: [] });

    const { ref } = renderHandler('session-X');

    const diceCtx: DiceRollContext = {
      intent: 'dice_roll',
      diceRoll: { formula: '1d20+5', count: 1, dieType: 20, modifier: 5, total: 18 },
    };

    await act(async () => {
      await ref.send('Attack Roll: 18 vs AC 14 ✓', diceCtx);
    });

    // extractMemories must NOT have been called with the roll-result text
    const rollInputCall = mockExtractMemories.mock.calls.find(([content]: [string]) =>
      content.includes('Attack Roll'),
    );
    expect(rollInputCall).toBeUndefined();

    // extractMemories MUST have been called with the AI narrative
    await waitFor(() => {
      expect(mockExtractMemories).toHaveBeenCalledWith(AI_NARRATIVE);
    });
  });

  it('uses the current sessionId for getAIResponse in the post-roll flow (no FK violation)', async () => {
    // Combined scenario: session changed AND player is submitting a roll result.
    // Previously this was the exact path that caused FK 23503: stale session-A
    // used for memory/AI calls after session-B replaced it.
    const { result, ref } = renderHandler('session-A');
    rerenderHandler(result, ref, 'session-B');

    const diceCtx: DiceRollContext = {
      intent: 'dice_roll',
      diceRoll: { formula: '1d20+2', count: 1, dieType: 20, modifier: 2, total: 15 },
    };

    await act(async () => {
      await ref.send('Stealth Check: 15 vs DC 13 ✓', diceCtx);
    });

    // The AI call must reference the live session, not the expired one
    expect(mockGetAIResponse).toHaveBeenCalledWith(
      expect.any(Array),
      'session-B', // not stale "session-A"
      undefined,
      expect.any(Function),
      expect.any(Function),
      expect.any(String), // #2218: the DM row id reserved for this turn
    );
  });

  it('keeps the composer blocked when a dice turn starts combat preflight without another roll', async () => {
    mockParseDiceCommand.mockReturnValue({
      isValid: true,
      formula: '1d20',
      dieType: 20,
      count: 1,
      modifier: 0,
      advantage: false,
      disadvantage: false,
    });

    const combatResponse = {
      text: 'Combat begins.',
      sender: 'dm',
      rollRequests: [],
      context: { combat_transition: 'start' },
      combatDetection: { shouldStartCombat: true },
    };
    let resolveAIResponse: ((response: typeof combatResponse) => void) | undefined;
    const pendingAIResponse = new Promise<typeof combatResponse>((resolve) => {
      resolveAIResponse = resolve;
    });
    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as
        | ((response: typeof combatResponse) => Promise<void> | void)
        | undefined;
      await onTextReady?.(combatResponse);
      return pendingAIResponse;
    });

    const { ref } = renderHandler('session-dice-combat-preflight');
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = ref.send('Roll a d20');
      await waitFor(() => expect(mockGetAIResponse).toHaveBeenCalled());
    });

    await waitFor(() => expect(ref.processing.current).toBe(true));

    await act(async () => {
      resolveAIResponse?.(combatResponse);
      await sendPromise;
    });
  });

  // A narrative roll turn outside combat is the one case that still prompts early: the request
  // is an ordinary check the dice popup owns, so `use-ai-response` sets `earlyRollPromptAllowed`.
  it('shows the roll prompt immediately without rendering declaration-turn outcome text', async () => {
    const rollRequests = [
      { type: 'skill_check', formula: '1d20+3', purpose: 'Investigation to find the catch' },
    ];
    const rollResponse = {
      text: 'You find nothing but a seam of dust along the panel.',
      sender: 'dm',
      rollRequests,
    };
    let resolveAIResponse: ((response: typeof rollResponse) => void) | undefined;
    const pendingAIResponse = new Promise<typeof rollResponse>((resolve) => {
      resolveAIResponse = resolve;
    });

    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as
        | ((
            response: typeof rollResponse,
            options: { suppressRender: boolean; earlyRollPromptAllowed: boolean },
          ) => Promise<void> | void)
        | undefined;
      await onTextReady?.(rollResponse, { suppressRender: true, earlyRollPromptAllowed: true });
      return pendingAIResponse;
    });

    const { ref } = renderHandler('session-roll-prompt');
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = ref.send('I attack the ooze with my sword.');
      await waitFor(() => expect(mockProcessAiResponse).toHaveBeenCalledWith(rollRequests));
    });

    expect(mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm')).toHaveLength(
      0,
    );
    expect(mockProcessAiResponse).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAIResponse?.(rollResponse);
      await sendPromise;
    });
  });

  it('persists engine lines but strips them from the combat callback input', async () => {
    const engineLine = '⚙️ Engine: The Storyteller rolled 16 + 4 = 20 vs AC 12 — HIT. 3 damage.';
    const narrative = 'The ward shatters and the corridor falls silent.';
    mockGetAIResponse.mockResolvedValue({
      text: `${engineLine}\n\n${narrative}`,
      rollRequests: [],
    });

    const { ref } = renderHandler('session-engine-lines', mockOnAIResponse);

    await act(async () => {
      await ref.send('I inspect the ward.');
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining(engineLine) }),
    );
    await waitFor(() => expect(mockOnAIResponse).toHaveBeenCalled());
    expect(mockOnAIResponse).toHaveBeenLastCalledWith(expect.objectContaining({ text: narrative }));
  });

  it('shows the session-expired error and unlocks the composer after a 401', async () => {
    mockSendMessage.mockRejectedValueOnce({
      name: 'SessionExpiredError',
      status: 401,
      message: 'Session expired — sign in again',
    });

    const { ref } = renderHandler('session-expired');

    await act(async () => {
      await expect(ref.send('I open the door.')).rejects.toMatchObject({ status: 401 });
    });

    expect(ref.processing.current).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Session expired — sign in again',
        variant: 'destructive',
      }),
    );
  });

  it('renders the DM response before response memory extraction resolves', async () => {
    const events: string[] = [];
    const extractionResolvers: Array<() => void> = [];
    mockExtractMemories.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          events.push('extraction started');
          extractionResolvers.push(resolve);
        }),
    );
    // The early DM render is cache-only now: `updateMessage` is the render, `sendMessage` is
    // the single persistence of the authoritative text.
    mockUpdateMessage.mockImplementation((message: { sender?: string }) => {
      if (message.sender === 'dm') events.push('text shown');
    });
    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const response = { text: 'The lantern flame steadies.', sender: 'dm', rollRequests: [] };
      const onTextReady = args[4] as ((message: typeof response) => Promise<void>) | undefined;
      await onTextReady?.(response);
      return response;
    });

    const { ref } = renderHandler('session-render-before-extraction');
    await act(async () => {
      await ref.send('I light the lantern.');
    });

    await waitFor(() => expect(events).toContain('text shown'));
    expect(mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm')).toHaveLength(
      1,
    );
    expect(
      mockUpdateMessage.mock.calls.filter(([message]) => message.sender === 'dm').length,
    ).toBeGreaterThanOrEqual(1);
    expect(events.indexOf('text shown')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('extraction started')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('text shown')).toBeLessThan(events.indexOf('extraction started'));
    await waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(
        'TURN_PHASE',
        expect.objectContaining({ phase: 'persist' }),
      );
    });
    expect(ref.processing.current).toBe(false);

    extractionResolvers.forEach((resolve) => resolve());
  });

  it('updates the early DM message in place when final text differs', async () => {
    const earlyResponse = {
      text: 'The blade arcs toward the ooze.',
      sender: 'dm',
      rollRequests: [],
    };
    const finalResponse = {
      ...earlyResponse,
      text: 'The blade arcs toward the ooze. The engine confirms the strike lands.',
    };
    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as
        | ((response: typeof earlyResponse) => Promise<void> | void)
        | undefined;
      await onTextReady?.(earlyResponse);
      return finalResponse;
    });

    const { ref } = renderHandler('session-final-text-replacement');
    await act(async () => {
      await ref.send('I swing at the ooze.');
    });

    // Exactly one persisted row, and it carries the final text — the early draft is never
    // written to dialogue_history (#2139).
    const dmMessages = mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm');
    expect(dmMessages).toHaveLength(1);
    const persistedMessage = dmMessages[0]?.[0];
    expect(persistedMessage.text).toBe(finalResponse.text);
    expect(
      mockSendMessage.mock.calls.filter(([message]) => message.text === earlyResponse.text),
    ).toHaveLength(0);
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: persistedMessage.id,
        text: finalResponse.text,
      }),
    );
    // The early render used the same row id, so the UI replaced it instead of appending.
    const earlyRender = mockUpdateMessage.mock.calls.find(
      ([message]) => message.text === earlyResponse.text,
    );
    expect(earlyRender?.[0].id).toBe(persistedMessage.id);
  });

  /**
   * #2139: the engine can resolve an in-combat turn inside `handleDmActionsAndTransitions`,
   * after the early callback. `use-ai-response` marks those turns `suppressRender`, and the
   * handler must render nothing until the final narration is back.
   */
  it('renders nothing before resolution on an in-combat turn without roll requests', async () => {
    const earlyResponse = {
      text: 'Terra swings her longsword at Click, the blade skating off its plating.',
      sender: 'dm',
      rollRequests: [],
      combatDetection: { isCombat: true, shouldStartCombat: false },
    };
    const finalResponse = {
      ...earlyResponse,
      text: '⚙️ Engine: Terra rolled 14 + 5 = 19 vs AC 12 — HIT. 7 damage.\n\nThe longsword bites deep.',
    };
    let resolveAIResponse: ((response: typeof finalResponse) => void) | undefined;
    const pendingAIResponse = new Promise<typeof finalResponse>((resolve) => {
      resolveAIResponse = resolve;
    });

    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as
        | ((
            response: typeof earlyResponse,
            options: { suppressRender: boolean; earlyRollPromptAllowed: boolean },
          ) => Promise<void> | void)
        | undefined;
      await onTextReady?.(earlyResponse, {
        suppressRender: true,
        earlyRollPromptAllowed: false,
      });
      return pendingAIResponse;
    });

    const { ref } = renderHandler('session-in-combat-attack');
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = ref.send('I attack Click with my longsword.');
      await waitFor(() => expect(mockGetAIResponse).toHaveBeenCalled());
    });

    // Nothing rendered and nothing persisted while the engine is still resolving the turn.
    expect(mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm')).toHaveLength(
      0,
    );
    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(mockProcessAiResponse).not.toHaveBeenCalled();

    await act(async () => {
      resolveAIResponse?.(finalResponse);
      await sendPromise;
    });

    // The resolved narration is rendered and persisted exactly once, with the final text.
    const dmMessages = mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm');
    expect(dmMessages).toHaveLength(1);
    expect(dmMessages[0]?.[0].text).toBe(finalResponse.text);
  });

  /**
   * `rollTurnStarted` is sticky for the invocation so the roll prompt is never fired twice.
   * It must not also swallow narration: once the engine has resolved the roll and the final
   * response carries no pending request, that text is rendered and saved once.
   */
  it('renders the final DM message once after a roll turn resolves', async () => {
    const rollRequests = [
      { type: 'skill_check', formula: '1d20+3', purpose: 'Investigation to find the catch' },
    ];
    const rollResponse = {
      text: 'You find nothing but a seam of dust along the panel.',
      sender: 'dm',
      rollRequests,
    };
    const resolvedResponse = {
      text: '⚙️ Engine: 18 vs AC 12 — HIT. 6 damage.\n\nThe ooze recoils, hissing.',
      sender: 'dm',
      rollRequests: [],
    };
    let resolveAIResponse: ((response: typeof resolvedResponse) => void) | undefined;
    const pendingAIResponse = new Promise<typeof resolvedResponse>((resolve) => {
      resolveAIResponse = resolve;
    });

    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as
        | ((
            response: typeof rollResponse,
            options: { suppressRender: boolean; earlyRollPromptAllowed: boolean },
          ) => Promise<void> | void)
        | undefined;
      await onTextReady?.(rollResponse, { suppressRender: true, earlyRollPromptAllowed: true });
      return pendingAIResponse;
    });

    const { ref } = renderHandler('session-roll-resolved');
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = ref.send('I attack the ooze with my sword.');
      await waitFor(() => expect(mockProcessAiResponse).toHaveBeenCalledWith(rollRequests));
    });

    // Declaration prose is never shown while the roll is outstanding.
    expect(mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm')).toHaveLength(
      0,
    );

    await act(async () => {
      resolveAIResponse?.(resolvedResponse);
      await sendPromise;
    });

    const dmMessages = mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm');
    expect(dmMessages).toHaveLength(1);
    expect(dmMessages[0]?.[0].text).toBe(resolvedResponse.text);
    // The prompt fired once, from the early callback only.
    expect(mockProcessAiResponse).toHaveBeenCalledTimes(1);
  });

  /**
   * #2190: a combat-start turn's `roll_requests` are the DM's engine declaration channel. The
   * early callback must not prompt with them — the player would roll a die the engine throws
   * away while the engine's own initiative prompt waits behind it. Only the combat confirmation
   * text reaches the transcript from this turn.
   */
  it('shows no roll prompt for a combat-start turn carrying initiative and attack requests', async () => {
    const earlyResponse = {
      text: 'The Chiropteran Hulk drops from the rafters, wings snapping wide.',
      sender: 'dm',
      rollRequests: [
        { type: 'initiative', formula: '1d20+1', purpose: 'Initiative roll for the party' },
        { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack vs Chiropteran Hulk' },
      ],
      context: { combat_transition: 'start' },
      combatDetection: { isCombat: true, shouldStartCombat: true },
    };
    // `dm-actions-handler` strips attack/initiative once `/enter` has seated the encounter, so
    // the final response carries the confirmation only.
    const finalResponse = {
      text: 'Combat begins. Roll for initiative.',
      sender: 'dm',
      rollRequests: [],
      context: { combat_transition: 'none' },
      combatDetection: { isCombat: true, shouldStartCombat: false },
    };
    let resolveAIResponse: ((response: typeof finalResponse) => void) | undefined;
    const pendingAIResponse = new Promise<typeof finalResponse>((resolve) => {
      resolveAIResponse = resolve;
    });

    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as
        | ((
            response: typeof earlyResponse,
            options: { suppressRender: boolean; earlyRollPromptAllowed: boolean },
          ) => Promise<void> | void)
        | undefined;
      await onTextReady?.(earlyResponse, {
        suppressRender: true,
        earlyRollPromptAllowed: false,
      });
      return pendingAIResponse;
    });

    const { ref } = renderHandler('session-combat-entry-requests');
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = ref.send('I attack the hulk with my longsword.');
      await waitFor(() => expect(mockGetAIResponse).toHaveBeenCalled());
    });

    // No prompt, no text, nothing persisted while the entry pipeline runs.
    expect(mockProcessAiResponse).not.toHaveBeenCalled();
    expect(mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm')).toHaveLength(
      0,
    );

    await act(async () => {
      resolveAIResponse?.(finalResponse);
      await sendPromise;
    });

    // Only the engine-filtered confirmation reaches the transcript, and the raw declaration
    // requests were never queued for the player.
    const dmMessages = mockSendMessage.mock.calls.filter(([message]) => message.sender === 'dm');
    expect(dmMessages).toHaveLength(1);
    expect(dmMessages[0]?.[0].text).toBe(finalResponse.text);
    expect(mockProcessAiResponse).not.toHaveBeenCalled();
  });

  /**
   * Defence in depth for #2190: even if the flag says a turn may prompt early, an `attack` or
   * `initiative` request is never forwarded from the early path — those belong to the engine.
   */
  it('never forwards an attack request from the early path even when prompting is allowed', async () => {
    const rollRequests = [
      { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack' },
      { type: 'skill_check', formula: '1d20+3', purpose: 'Athletics to keep your footing' },
    ];
    const rollResponse = {
      text: 'You set your feet and swing.',
      sender: 'dm',
      rollRequests,
    };
    let resolveAIResponse: ((response: typeof rollResponse) => void) | undefined;
    const pendingAIResponse = new Promise<typeof rollResponse>((resolve) => {
      resolveAIResponse = resolve;
    });

    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const onTextReady = args[4] as
        | ((
            response: typeof rollResponse,
            options: { suppressRender: boolean; earlyRollPromptAllowed: boolean },
          ) => Promise<void> | void)
        | undefined;
      await onTextReady?.(rollResponse, { suppressRender: true, earlyRollPromptAllowed: true });
      return pendingAIResponse;
    });

    const { ref } = renderHandler('session-early-attack-filter');
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = ref.send('I swing at the ooze.');
      await waitFor(() => expect(mockProcessAiResponse).toHaveBeenCalled());
    });

    // The narrative check goes up; the attack request does not.
    expect(mockProcessAiResponse).toHaveBeenCalledTimes(1);
    expect(mockProcessAiResponse).toHaveBeenCalledWith([rollRequests[1]]);

    await act(async () => {
      resolveAIResponse?.(rollResponse);
      await sendPromise;
    });
  });

  /**
   * #2200 (NIT from the #2196 review): the final path applies the same engine-channel boundary as
   * the early path. `dm-actions-handler` strips `attack`/`initiative` on combat entry, but an
   * in-combat turn that is not an entry turn does not go through that filter, so a raw declaration
   * request would still reach the dice queue from here.
   */
  it('filters engine-channel requests out of the final-path roll prompt', async () => {
    const rollRequests = [
      { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack vs the Hulk' },
      { type: 'initiative', formula: '1d20+1', purpose: 'Initiative roll for the party' },
      { type: 'skill_check', formula: '1d20+3', purpose: 'Athletics to keep your footing' },
    ];
    // No early callback: this turn's requests arrive only on the final response.
    mockGetAIResponse.mockResolvedValue({
      text: 'You brace against the rubble.',
      sender: 'dm',
      rollRequests,
    });

    const { ref } = renderHandler('session-final-path-filter', mockOnAIResponse);
    await act(async () => {
      await ref.send('I hold the line.');
    });

    expect(mockProcessAiResponse).toHaveBeenCalledTimes(1);
    expect(mockProcessAiResponse).toHaveBeenCalledWith([rollRequests[2]]);
    // The skill check is still owed, so this turn waits on its die exactly as before: no
    // narration, the composer stays blocked, and combat detection waits for the roll turn.
    expect(dmPersisted()).toEqual([
      expect.objectContaining({
        text: '',
        rollRequests: [rollRequests[2]],
        context: expect.objectContaining({
          intent: 'pending_roll_request',
          rollRequests: [rollRequests[2]],
        }),
      }),
    ]);
    expect(composerEnabledCount()).toBe(0);
    expect(mockOnAIResponse).not.toHaveBeenCalled();
  });

  // Review of round 1: the filter alone made this turn a silent dead-end, because
  // `hasRollRequests` still counted the raw list — no narration, no popup, composer never
  // unblocked, no combat callback. An engine-channel-only turn is a resolved turn.
  it('prompts nothing and still renders the turn when the final path carries engine-channel requests only', async () => {
    const text = 'The Hulk wheels toward you.';
    mockGetAIResponse.mockResolvedValue({
      text,
      sender: 'dm',
      rollRequests: [
        { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack vs the Hulk' },
        { type: 'initiative', formula: '1d20+1', purpose: 'Initiative roll for the party' },
      ],
    });

    const { ref } = renderHandler('session-final-path-all-engine', mockOnAIResponse);
    await act(async () => {
      await ref.send('I hold the line.');
    });

    expect(mockProcessAiResponse).not.toHaveBeenCalled();
    expect(dmPersisted()).toEqual([expect.objectContaining({ text })]);
    expect(composerEnabledCount()).toBe(1);
    expect(mockOnAIResponse).toHaveBeenCalledWith(expect.objectContaining({ text }));
  });

  it('shows the text once and unblocks the composer for a final response with text plus [attack] only', async () => {
    const text = 'You press the Hulk back a step.';
    mockGetAIResponse.mockResolvedValue({
      text,
      sender: 'dm',
      rollRequests: [
        { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack vs the Hulk' },
      ],
    });

    const { ref } = renderHandler('session-final-path-attack-only', mockOnAIResponse);
    await act(async () => {
      await ref.send('I swing again.');
    });

    expect(mockProcessAiResponse).not.toHaveBeenCalled();
    expect(dmPersisted()).toEqual([expect.objectContaining({ text })]);
    expect(composerEnabledCount()).toBe(1);
    expect(mockOnAIResponse).toHaveBeenCalledTimes(1);
  });

  it('shows the text but keeps the composer blocked when a text plus [attack] response starts combat', async () => {
    const text = 'Steel rings out as the ambush springs.';
    mockGetAIResponse.mockResolvedValue({
      text,
      sender: 'dm',
      rollRequests: [
        { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack vs the bandit' },
      ],
      context: { combat_transition: 'start' },
      // `dm-response-processor` sets `isCombat` with every `combat_transition: 'start'`.
      combatDetection: { isCombat: true, shouldStartCombat: true },
    });

    const { ref } = renderHandler('session-final-path-attack-combat-start', mockOnAIResponse);
    await act(async () => {
      await ref.send('I draw on them.');
    });

    expect(mockProcessAiResponse).not.toHaveBeenCalled();
    expect(dmPersisted()).toEqual([expect.objectContaining({ text })]);
    expect(composerEnabledCount()).toBe(0);
    expect(mockOnAIResponse).toHaveBeenCalledTimes(1);
  });

  /**
   * #2218: the server persists a display-ready DM reply under an id the client reserves before
   * generation. The early render (#2147) and the single final save must reuse that id, or the
   * server's row and the client's row become two DM messages for one turn.
   */
  it('renders early, replaces in place and saves once, all under the id reserved for the server row', async () => {
    const earlyResponse = {
      text: 'The stair ends in black water.',
      sender: 'dm',
      rollRequests: [],
    };
    const finalResponse = {
      ...earlyResponse,
      text: 'The stair ends in black water. Something beneath it breathes.',
    };
    let reservedId: string | undefined;
    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      reservedId = args[5] as string | undefined;
      const onTextReady = args[4] as
        | ((response: typeof earlyResponse) => Promise<void>)
        | undefined;
      await onTextReady?.(earlyResponse);
      return finalResponse;
    });

    const { ref } = renderHandler('session-reserved-dm-id');
    await act(async () => {
      await ref.send('I look down the stairwell.');
    });

    expect(reservedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const earlyRender = mockUpdateMessage.mock.calls.find(
      ([message]) => message.text === earlyResponse.text,
    );
    expect(earlyRender?.[0].id).toBe(reservedId);
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: reservedId, text: finalResponse.text }),
    );
    expect(dmPersisted()).toEqual([
      expect.objectContaining({ id: reservedId, text: finalResponse.text }),
    ]);
  });

  it('saves a turn with no early render under the reserved id too, so it reconciles with the server row', async () => {
    let reservedId: string | undefined;
    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      reservedId = args[5] as string | undefined;
      return {
        text: 'The engine resolves the swing: a clean miss.',
        sender: 'dm',
        rollRequests: [],
      };
    });

    const { ref } = renderHandler('session-reserved-dm-id-no-early');
    await act(async () => {
      await ref.send('I swing at the ghoul.');
    });

    expect(reservedId).toBeTruthy();
    expect(dmPersisted()).toEqual([expect.objectContaining({ id: reservedId })]);
  });

  /**
   * #2218, the Aug 26 shape: the DM save failed, the queue rolled the optimistic row back off the
   * screen, and nothing ever retried it — the reply reached neither dialogue_history nor the
   * player. Now the row stays on screen and the player can retry the same row.
   */
  it('keeps a DM reply whose save failed on screen and offers a retry that saves the same row', async () => {
    const text = 'Forty steps down, the stair ends in black water.';
    mockGetAIResponse.mockResolvedValue({ text, sender: 'dm', rollRequests: [] });
    mockSendMessage.mockImplementation(async (message: { sender?: string }) => {
      if (message.sender === 'dm' && mockSendMessage.mock.calls.length <= 2) {
        throw new Error('API 503: upstream unavailable');
      }
    });

    const { ref } = renderHandler('session-dm-save-fails');
    await act(async () => {
      await ref.send('I look down the stairwell.');
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const [failedSave] = dmPersisted() as Array<{ id?: string; text?: string }>;
    // Rendered again after the queue's rollback, under the same id.
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: failedSave?.id, text }),
    );
    const retryToast = mockToast.mock.calls
      .map(
        ([options]) =>
          options as { title?: string; action?: { label: string; onClick: () => void } },
      )
      .find((options) => options.action?.label === 'Retry');
    expect(retryToast?.title).toBe("The DM's reply wasn't saved");

    await act(async () => {
      retryToast?.action?.onClick();
    });

    await waitFor(() => expect(dmPersisted()).toHaveLength(2));
    const [first, second] = dmPersisted() as Array<{ id?: string; text?: string }>;
    expect(second?.id).toBe(first?.id);
    expect(second?.text).toBe(text);
  });

  it('unlocks the composer when response memory extraction fails', async () => {
    mockExtractMemories.mockRejectedValue(new Error('extract failed'));
    mockGetAIResponse.mockImplementation(async (...args: unknown[]) => {
      const response = {
        text: 'The door opens onto moonlit stone.',
        sender: 'dm',
        rollRequests: [],
      };
      const onTextReady = args[4] as ((message: typeof response) => Promise<void>) | undefined;
      await onTextReady?.(response);
      return response;
    });

    const { ref } = renderHandler('session-extraction-failure');
    await act(async () => {
      await ref.send('I open the door.');
    });

    expect(ref.processing.current).toBe(false);
  });
});
