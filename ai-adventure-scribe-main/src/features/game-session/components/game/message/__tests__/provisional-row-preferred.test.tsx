/**
 * #783 task A(c): provisional row preferred over the error chip on reload.
 *
 * When the client reloads after a failed turn, if the #795 fallback wrote a
 * provisional DM row, the chat must render that reply instead of the
 * "The DM could not finish this turn" chip. With no provisional row, the chip
 * still shows (and the beacon fires).
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

describe('provisional row preferred over error chip (#783)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextState.messages = [];
    contextState.messagesReady = true;
    // No combat: the recovery hook proceeds to the orphaned-message check.
    mockReadCombat.mockResolvedValue({ state: 'none' });
    mockCheckDeclaredAttack.mockResolvedValue(false);
    // The player message is the newest server-side row.
    mockListSessionMessages.mockResolvedValue({ total: 1, messages: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show the chip when a provisional DM row is present', async () => {
    const playerMessage = {
      id: 'player-1',
      sender: 'player',
      text: 'I look around the tavern.',
      timestamp: '2026-10-19T01:00:00.000Z',
    };
    const provisionalDmRow = {
      id: 'dm-provisional-1',
      sender: 'dm',
      text: 'The tavern door creaks open.',
      timestamp: '2026-10-19T01:00:05.000Z',
      context: { provisional: true },
    };
    contextState.messages = [playerMessage, provisionalDmRow];

    const captured = renderHandler();
    // Let the recovery hook's async check run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No error chip: the provisional reply renders instead.
    expect(captured.sendError).toBeNull();
    // A beacon notes the provisional row was fetched.
    expect(mockReportClientFailure).toHaveBeenCalledWith(
      'client_turn_failure',
      SESSION_ID,
      expect.any(String),
      expect.objectContaining({ provisionalFetched: true }),
    );
  });

  it('shows the chip when no provisional DM row exists', async () => {
    const playerMessage = {
      id: 'player-1',
      sender: 'player',
      text: 'I look around the tavern.',
      timestamp: '2026-10-19T01:00:00.000Z',
    };
    contextState.messages = [playerMessage];

    const captured = renderHandler();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The chip shows: no provisional reply to render.
    expect(captured.sendError).toBe(
      'The DM could not finish this turn. Your message is still here. Retry to continue.',
    );
    // Beacon fires with provisionalFetched: false.
    expect(mockReportClientFailure).toHaveBeenCalledWith(
      'client_turn_failure',
      SESSION_ID,
      expect.any(String),
      expect.objectContaining({ provisionalFetched: false }),
    );
  });
});
