/**
 * P0 #783 task A: a roll-request DM turn whose SSE stream carries `reset`
 * events (a rejected attempt retried, or Haiku failing ajv then failing over
 * to Gemini) must still persist the DM reply and open the roll tray.
 *
 * Replays, through the real `useMessageHandlerLogic` (only the transport is
 * mocked): N `reset` events → narration chunks → `onTextReady` with a reply
 * carrying `roll_requests` → the final parsed reply. Asserts the DM roll
 * reply is persisted via `sendMessage` and the roll tray opens via
 * `processAiResponse`. Runs with 0, 1 and 2 resets; the 1- and 2-reset cases
 * are the regression proof for the #783 stall.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageHandler } from '../MessageHandler';

const {
  mockGetAIResponse,
  mockSendMessage,
  mockUpdateMessage,
  mockRemoveMessage,
  mockProcessAiResponse,
  mockToast,
  mockValidateSession,
} = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockUpdateMessage: vi.fn(),
  mockRemoveMessage: vi.fn(),
  mockProcessAiResponse: vi.fn(),
  mockToast: vi.fn(),
  mockValidateSession: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: mockGetAIResponse }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [],
    sendMessage: mockSendMessage,
    updateMessage: mockUpdateMessage,
    removeMessage: mockRemoveMessage,
    queueStatus: 'idle' as const,
    isLoading: false,
  }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({ processAiResponse: mockProcessAiResponse, state: {} }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({ isSafetyCommand: false }),
  processSafetyCommand: vi.fn(),
}));
vi.mock('@/utils/diceCommandParser', () => ({ parseDiceCommand: vi.fn().mockReturnValue(null) }));
vi.mock('@/utils/chatSanitizer', () => ({ sanitizeDMText: (text: string) => text }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => mockValidateSession,
}));

// A narrative (non-engine-channel) roll request, shaped like the DM envelope's
// `roll_requests` entries after `processDMResponse` parses the model JSON.
const rollRequests = (): Array<Record<string, unknown>> => [
  {
    type: 'check',
    formula: '1d20',
    purpose: 'Investigation check to search the room',
    dc: 15,
  },
];

const dmReply = (text: string): Record<string, unknown> => ({
  id: 'dm-1',
  text,
  sender: 'dm' as const,
  timestamp: new Date().toISOString(),
  context: { intent: 'response' as const },
  rollRequests: rollRequests(),
});

describe('roll-request turn across SSE reset events (P0 #783)', () => {
  let send: (text: string) => Promise<void>;

  const renderHandler = (): void => {
    render(
      <MessageHandler
        sessionId="session-783"
        campaignId="campaign-783"
        characterId="character-783"
        turnCount={0}
        updateGameSessionState={vi.fn().mockResolvedValue(undefined)}
        onAIResponse={vi.fn().mockResolvedValue(undefined)}
      >
        {(handler) => {
          send = handler.handleSendMessage;
          return null;
        }}
      </MessageHandler>,
    );
  };

  /**
   * Drives one DM turn: `resets` reset events, then narration chunks, then the
   * early callback with a roll-request reply, then the final parsed reply.
   */
  const runRollRequestTurn = async (resets: number): Promise<void> => {
    mockGetAIResponse.mockImplementationOnce(async (...args: unknown[]) => {
      const onStreamChunk = args[8] as (chunk: string) => void;
      const onStreamReset = args[9] as () => void;
      const onTextReady = args[4] as (
        early: unknown,
        options: { suppressRender: boolean; earlyRollPromptAllowed: boolean },
      ) => Promise<void>;
      expect(typeof onStreamChunk).toBe('function');
      expect(typeof onStreamReset).toBe('function');
      const prose = 'Dust coats every surface. Something glints under the desk.';
      for (let i = 0; i < resets; i += 1) onStreamReset();
      onStreamChunk(prose);
      await onTextReady(dmReply(prose), {
        suppressRender: true,
        earlyRollPromptAllowed: true,
      });
      return dmReply(prose);
    });
    renderHandler();
    await act(async () => {
      await send('I search the room');
    });
    // The roll-reply persistence runs in a deferred microtask.
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    mockValidateSession.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([0, 1, 2])(
    'persists the DM roll reply and opens the roll tray with %i reset events',
    async (resets: number) => {
      await runRollRequestTurn(resets);

      // The roll tray opens from the early roll requests.
      expect(mockProcessAiResponse).toHaveBeenCalledTimes(1);
      const trayRequests = mockProcessAiResponse.mock.calls[0][0] as Array<{
        purpose: string;
        rollRequestId: string;
      }>;
      expect(trayRequests).toHaveLength(1);
      expect(trayRequests[0].purpose).toBe('Investigation check to search the room');
      expect(trayRequests[0].rollRequestId).toBe('dm-1:roll:0');

      // The DM reply is persisted under the turn's id with its roll requests,
      // so a reload can restore the popup from the same row (#2280).
      const persisted = mockSendMessage.mock.calls
        .map((call) => call[0] as { sender: string; rollRequests?: unknown[] })
        .find((message) => message.sender === 'dm' && Array.isArray(message.rollRequests));
      expect(persisted).toBeDefined();
      expect(persisted?.rollRequests).toHaveLength(1);
    },
  );
});
