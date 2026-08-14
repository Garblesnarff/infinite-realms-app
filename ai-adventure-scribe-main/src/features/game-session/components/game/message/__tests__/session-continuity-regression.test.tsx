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
  mockValidateSession,
} = vi.hoisted(() => ({
  mockExtractMemories: vi.fn().mockResolvedValue(undefined),
  mockGetAIResponse: vi.fn().mockResolvedValue({
    text: 'The goblin snarls.',
    rollRequests: [],
  }),
  mockOnAIResponse: vi.fn().mockResolvedValue(undefined),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockValidateSession: vi.fn().mockResolvedValue(true),
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
    queueStatus: 'idle' as const,
    isLoading: false,
    isFetchingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({ processAiResponse: vi.fn(), state: {} }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({ isSafetyCommand: false }),
  processSafetyCommand: vi.fn(),
}));

vi.mock('@/utils/diceCommandParser', () => ({
  parseDiceCommand: vi.fn().mockReturnValue(null),
}));

vi.mock('@/utils/chatSanitizer', () => ({
  sanitizeDMText: (text: string) => text,
}));

vi.mock('@/utils/roll-request/validate', () => ({
  truncateAtRollRequest: (text: string) => text,
}));

vi.mock('@/utils/diceUtils', () => ({ rollDice: vi.fn() }));

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
}

function makeUpdateStateMock() {
  // updateGameSessionState is called with a function updater (prev) => ({...prev, ...})
  return vi.fn().mockResolvedValue(undefined);
}

function renderHandler(
  sessionId: string,
  onAIResponse?: (message: { text: string }) => Promise<void>,
) {
  const ref: HandlerRef = { send: async () => {} };
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
      {({ handleSendMessage }) => {
        ref.send = handleSendMessage;
        return null;
      }}
    </MessageHandler>,
  );

  return { result, ref, updateGameSessionState };
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
      {({ handleSendMessage }) => {
        ref.send = handleSendMessage;
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
    );
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
});
