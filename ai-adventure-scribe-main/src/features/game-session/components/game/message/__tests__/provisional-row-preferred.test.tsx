/**
 * #783 task A(b,c): reload-time turn-failure beacon.
 *
 * When useHeldEntryRecovery determines the player message is still the newest
 * on the server (no DM reply exists), offerRetryForSavedMessage shows the
 * "could not finish" chip and sends a ONE-shot beacon with provisionalFetched:
 * false. (If a provisional DM row existed, the hook's gating would prevent the
 * offer from running at all — the row renders via the normal message fetch.)
 */
import { act, render } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const {
  mockGetAIResponse,
  mockReadCombat,
  mockListSessionMessages,
  mockSendMessage,
  mockCheckDeclaredAttack,
  mockReportClientFailure,
  mockLogger,
  contextState,
  character,
} = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockReadCombat: vi.fn(),
  mockListSessionMessages: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockCheckDeclaredAttack: vi.fn(),
  mockReportClientFailure: vi.fn(),
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  contextState: {
    messages: [] as Array<Record<string, unknown>>,
    messagesReady: true,
  },
  character: { id: 'char-1', name: 'The Scholar' },
}));

vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: mockGetAIResponse }),
}));
vi.mock('@/contexts/combat/use-authoritative-combat-sync', () => ({
  readAuthoritativeCombat: mockReadCombat,
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessionMessages: mockListSessionMessages,
    reportClientFailure: mockReportClientFailure,
  },
  isTerminalDefeatError: () => false,
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: contextState.messages,
    messagesReady: contextState.messagesReady,
    sendMessage: mockSendMessage,
    updateMessage: vi.fn(),
    removeMessage: vi.fn(),
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
  useCharacter: () => ({ state: { character } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({ isSafetyCommand: false }),
  processSafetyCommand: vi.fn(),
}));
vi.mock('@/utils/diceCommandParser', () => ({
  parseDiceCommand: vi.fn().mockReturnValue(null),
}));
vi.mock('@/utils/chatSanitizer', () => ({ sanitizeDMText: (text: string) => text }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: mockLogger }));
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('@/hooks/ai/combat-entry-hold', () => ({
  checkDeclaredAttack: mockCheckDeclaredAttack,
  recentNarrationFrom: () => undefined,
}));

import { MessageHandler } from '../MessageHandler';

const SESSION_ID = 'sess-provisional-783';

function renderHandler() {
  let captured: { sendError: string | null } = { sendError: null };
  render(
    <MessageHandler
      sessionId={SESSION_ID}
      campaignId="campaign-1"
      characterId="char-1"
      turnCount={4}
      updateGameSessionState={vi.fn().mockResolvedValue(undefined)}
    >
      {(handler) => {
        captured.sendError = handler.sendError;
        return null;
      }}
    </MessageHandler>,
  );
  return captured;
}

describe('reload-time turn-failure beacon (#783)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextState.messages = [];
    contextState.messagesReady = true;
    // No combat: the recovery hook proceeds to the orphaned-message check.
    mockReadCombat.mockResolvedValue({ state: 'none' });
    mockCheckDeclaredAttack.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the chip and sends the beacon when the player message is still newest', async () => {
    const playerMessage = {
      id: 'player-1',
      sender: 'player',
      text: 'I look around the tavern.',
      timestamp: '2026-10-19T01:00:00.000Z',
    };
    contextState.messages = [playerMessage];
    // Server confirms the player message is still the newest row: the hook
    // will call offerRetryForSavedMessage. Shape follows the real
    // listSessionMessages response (speaker_type, not sender).
    mockListSessionMessages.mockResolvedValue({
      total: 1,
      messages: [{ id: 'player-1', speaker_type: 'player', text: 'I look around the tavern.' }],
    });

    const captured = renderHandler();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      // Allow the async playerMessageIsStillNewest to resolve.
      await new Promise((r) => setTimeout(r, 10));
    });

    // The chip shows: no DM reply (provisional or otherwise) exists.
    expect(captured.sendError).toBe(
      'The DM could not finish this turn. Your message is still here. Retry to continue.',
    );
    // ONE beacon fires with provisionalFetched: false.
    expect(mockReportClientFailure).toHaveBeenCalledTimes(1);
    expect(mockReportClientFailure).toHaveBeenCalledWith(
      'client_turn_failure',
      SESSION_ID,
      'The DM could not finish this turn. Your message is still here. Retry to continue.',
      expect.objectContaining({
        messageId: 'player-1',
        provisionalFetched: false,
      }),
    );
  });
});
