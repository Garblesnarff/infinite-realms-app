/**
 * Regression test for #1654: "Action options are stored as memories, poisoning DM context".
 *
 * Root cause: actualSendMessage passed the FULL DM response — narrative plus the
 * trailing lettered/numbered action options every non-combat turn ends with — straight
 * into extractMemories(). The memory extractor then classified option lines (e.g. "Rush
 * to the kitchen, follow his order...") as story facts, which later got retrieved back
 * into DM prompts by MemoryManager.getRelevantMemories(), corrupting context for the
 * rest of the session.
 *
 * Fix: strip options with the same parseMessageOptions() helper the UI already uses to
 * render the narrative, and only call extractMemories() when narrative content remains.
 */
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ------- hoisted mock factories (must be accessible inside vi.mock factories) -------
const { mockExtractMemories, mockGetAIResponse, mockSendMessage, mockValidateSession } = vi.hoisted(
  () => ({
    mockExtractMemories: vi.fn().mockResolvedValue(undefined),
    mockGetAIResponse: vi.fn().mockResolvedValue({
      text: 'The goblin snarls.',
      rollRequests: [],
    }),
    mockSendMessage: vi.fn().mockResolvedValue(undefined),
    mockValidateSession: vi.fn().mockResolvedValue(true),
  }),
);

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

// ------- test helpers -------
interface HandlerRef {
  send: (text: string) => Promise<void>;
}

function makeUpdateStateMock() {
  return vi.fn().mockResolvedValue(undefined);
}

function renderHandler(sessionId: string) {
  const ref: HandlerRef = { send: async () => {} };
  const updateGameSessionState = makeUpdateStateMock();

  const result = render(
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

  return { result, ref, updateGameSessionState };
}

// A DM turn shaped like the live playtest capture from issue #1654: narrative
// followed by three lettered, bolded action options.
const NARRATIVE = 'A crash of metal signals a fresh disaster.';
const AI_RESPONSE_WITH_OPTIONS = [
  NARRATIVE,
  '',
  'A. **Rush to the kitchen**, follow his order and attempt to mitigate the disaster unfolding among the staff.',
  'B. **Defy his command**, stand your ground and demand to know who exactly "defines" the rules of the storm.',
  'C. **Observe the static**, focus on the energy radiating from him.',
].join('\n');

describe('extractMemories option stripping (#1654)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateSession.mockResolvedValue(true);
    mockSendMessage.mockResolvedValue(undefined);
    mockExtractMemories.mockResolvedValue(undefined);
    mockGetAIResponse.mockResolvedValue({ text: AI_RESPONSE_WITH_OPTIONS, rollRequests: [] });
  });

  it('extracts memories from the narrative only, never from the lettered action options', async () => {
    const { ref } = renderHandler('session-1654');

    await act(async () => {
      await ref.send('I look around the tavern.');
    });

    await waitFor(() => {
      // extractMemories is called once for the player input, once for the AI response.
      expect(mockExtractMemories).toHaveBeenCalledWith(NARRATIVE);
    });

    // No call to extractMemories should ever contain option text or letter markers —
    // this is the exact corruption reported in #1654 ("Rush to the kitchen, follow his
    // order..." was stored as an `item` memory).
    for (const [content] of mockExtractMemories.mock.calls) {
      expect(content).not.toMatch(/Rush to the kitchen/);
      expect(content).not.toMatch(/Defy his command/);
      expect(content).not.toMatch(/Observe the static/);
      expect(content).not.toMatch(/^[A-C]\.\s/m);
    }
  });

  it('does not write option text into current_scene_description', async () => {
    const { ref, updateGameSessionState } = renderHandler('session-1654-scene');

    await act(async () => {
      await ref.send('I look around the tavern.');
    });

    await waitFor(() => {
      expect(updateGameSessionState).toHaveBeenCalled();
    });

    // Find the updater call that sets current_scene_description and inspect its result.
    const sceneUpdates = updateGameSessionState.mock.calls
      .map(([updater]: [(prev: Record<string, unknown>) => Record<string, unknown>]) => updater({}))
      .filter((result: Record<string, unknown>) => 'current_scene_description' in result);

    expect(sceneUpdates.length).toBeGreaterThan(0);
    for (const update of sceneUpdates) {
      const blurb = String(update.current_scene_description ?? '');
      expect(blurb).not.toMatch(/Rush to the kitchen/);
      expect(blurb).not.toMatch(/^[A-C]\.\s/m);
    }
  });

  it('skips extraction entirely when stripping options leaves no narrative', async () => {
    // Edge case per parseMessageOptions' own "trailing incomplete sentence" cleanup:
    // a narrative fragment with no terminal punctuation directly before the options
    // gets popped down to an empty string. extractMemories must not be called with
    // that empty/garbage result for the AI-response turn.
    const AI_RESPONSE_NO_NARRATIVE_LEFT = [
      'Ok',
      '',
      'A. **Rush to the kitchen**, follow his order.',
      'B. **Defy his command**, stand your ground.',
    ].join('\n');
    mockGetAIResponse.mockResolvedValue({ text: AI_RESPONSE_NO_NARRATIVE_LEFT, rollRequests: [] });

    const { ref } = renderHandler('session-1654-empty-narrative');

    await act(async () => {
      await ref.send('I wait.');
    });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });

    // Only the player-input extraction call should have happened; the AI-response call
    // must have been skipped because narrativeOnly was empty.
    expect(mockExtractMemories).toHaveBeenCalledTimes(1);
    expect(mockExtractMemories).toHaveBeenCalledWith('I wait.');
  });
});
