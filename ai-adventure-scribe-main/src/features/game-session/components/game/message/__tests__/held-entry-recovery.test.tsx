/**
 * #2341 — a reload while the combat-entry popup holds a turn must not strand the player.
 *
 * The hold is client-only: the player's message is saved, no DM has been called, and nothing on
 * the server remembers the popup. On the first ready page the handler re-runs that turn, once,
 * without saving the message a second time.
 */
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const {
  mockGetAIResponse,
  mockReadCombat,
  mockListSessionMessages,
  mockSendMessage,
  mockCheckDeclaredAttack,
  mockLogger,
  contextState,
  character,
} = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockReadCombat: vi.fn(),
  mockListSessionMessages: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockCheckDeclaredAttack: vi.fn(),
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
  userDataApi: { listSessionMessages: mockListSessionMessages },
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: contextState.messages,
    messagesReady: contextState.messagesReady,
    sendMessage: mockSendMessage,
    updateMessage: vi.fn(),
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
vi.mock('@/utils/diceCommandParser', () => ({ parseDiceCommand: vi.fn().mockReturnValue(null) }));
vi.mock('@/utils/chatSanitizer', () => ({ sanitizeDMText: (text: string) => text }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: mockLogger }));
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('@/hooks/ai/combat-entry-hold', () => ({
  checkDeclaredAttack: mockCheckDeclaredAttack,
  recentNarrationFrom: (messages: Array<{ sender?: string; text?: string }>) =>
    [...messages].reverse().find((message) => message.sender === 'dm')?.text,
}));

import { MessageHandler } from '../MessageHandler';

const SESSION_ID = 'd3d075ef-fec7-4442-b684-c5c35084f41e';
const dmScene = { id: 'dm-1', sender: 'dm', text: 'Valerius hangs from the ceiling.' };
const attack = {
  id: 'player-1',
  sender: 'player',
  text: 'I cast Chill Touch at Valerius.',
  context: { intent: 'query' },
};

const pending = { trigger: 'player_intent', combatants: [{ name: 'Valerius', count: 1 }] };

function renderHandler(updateGameSessionState = vi.fn().mockResolvedValue(undefined)) {
  // A fresh element each time: React skips re-rendering an identical one.
  const tree = (): React.ReactElement => (
    <MessageHandler
      sessionId={SESSION_ID}
      campaignId="campaign-1"
      characterId="char-1"
      turnCount={4}
      updateGameSessionState={updateGameSessionState}
    >
      {() => null}
    </MessageHandler>
  );
  const view = render(tree());
  return { view, tree, updateGameSessionState };
}

/** The server's history: `rows` in order; a page read returns the slice asked for. */
function serverNewest(rows: Array<{ id: string; speaker_type: string }>): void {
  mockListSessionMessages.mockImplementation(
    async (_sessionId: string, offset = 0, limit = 50) => ({
      messages: rows.slice(offset, offset + limit),
      total: rows.length,
      hasMore: false,
    }),
  );
}

describe('resuming a turn the combat-entry popup was holding when the page reloaded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextState.messages = [dmScene, attack];
    contextState.messagesReady = true;
    mockGetAIResponse.mockResolvedValue({ text: 'Frost takes Valerius.', rollRequests: [] });
    mockCheckDeclaredAttack.mockResolvedValue({ kind: 'pending', pending });
    // No encounter, and the server's newest message is still the player's.
    mockReadCombat.mockResolvedValue({ state: 'none' });
    serverNewest([{ id: 'player-1', speaker_type: 'player' }]);
  });

  it('re-runs the unanswered turn without saving the player message or counting the turn again', async () => {
    const { updateGameSessionState } = renderHandler();

    await waitFor(() => expect(mockGetAIResponse).toHaveBeenCalledTimes(1));

    expect(mockCheckDeclaredAttack).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        message: attack.text,
        characterRecord: character,
        recentNarration: dmScene.text,
      }),
    );
    // The saved message goes back to the DM flow as the last message, not as a copy after it.
    const sentMessages = mockGetAIResponse.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1]).toBe(attack);
    // Nothing was saved as a player row, and no updater moved the turn counter.
    expect(
      mockSendMessage.mock.calls.filter(([message]) => message.sender === 'player'),
    ).toHaveLength(0);
    for (const [updater] of updateGameSessionState.mock.calls) {
      const next = typeof updater === 'function' ? updater({ turn_count: 4 }) : updater;
      expect(next.turn_count ?? 4).toBe(4);
    }
    expect(mockLogger.info).toHaveBeenCalledWith('COMBAT_ENTRY_HOLD_RESUMED', {
      sessionId: SESSION_ID,
    });
  });

  it('does not resume in an encounter: the engine may already have acted on the message', async () => {
    mockReadCombat.mockResolvedValue({ state: 'combat', combat: { encounter: { id: 'enc-1' } } });
    renderHandler();

    await waitFor(() => expect(mockReadCombat).toHaveBeenCalledWith(SESSION_ID));
    await Promise.resolve();
    expect(mockCheckDeclaredAttack).not.toHaveBeenCalled();
    expect(mockGetAIResponse).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('COMBAT_ENTRY_HOLD_RESUME_SKIPPED', {
      sessionId: SESSION_ID,
      reason: 'encounter_active',
    });
  });

  it('does not resume when the encounter read failed: unknown is not "no encounter"', async () => {
    mockReadCombat.mockResolvedValue({ state: 'unknown' });
    renderHandler();

    await waitFor(() =>
      expect(mockLogger.info).toHaveBeenCalledWith('COMBAT_ENTRY_HOLD_RESUME_SKIPPED', {
        sessionId: SESSION_ID,
        reason: 'encounter_unknown',
      }),
    );
    expect(mockCheckDeclaredAttack).not.toHaveBeenCalled();
    expect(mockGetAIResponse).not.toHaveBeenCalled();
  });

  it('does not resume when a DM reply landed after the page loaded (a call in flight at reload)', async () => {
    // The loaded page ends on the player's message; the server has since saved the reply.
    serverNewest([
      { id: 'dm-1', speaker_type: 'dm' },
      { id: 'player-1', speaker_type: 'player' },
      { id: 'dm-late', speaker_type: 'dm' },
    ]);
    renderHandler();

    await waitFor(() => expect(mockCheckDeclaredAttack).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockLogger.info).toHaveBeenCalledWith('COMBAT_ENTRY_HOLD_RESUME_SKIPPED', {
        sessionId: SESSION_ID,
        reason: 'answered_or_superseded',
      }),
    );
    expect(mockGetAIResponse).not.toHaveBeenCalled();
  });

  it('does not resume when the newest message is a different player message', async () => {
    serverNewest([
      { id: 'player-1', speaker_type: 'player' },
      { id: 'player-2', speaker_type: 'player' },
    ]);
    renderHandler();

    await waitFor(() =>
      expect(mockLogger.info).toHaveBeenCalledWith(
        'COMBAT_ENTRY_HOLD_RESUME_SKIPPED',
        expect.objectContaining({ reason: 'answered_or_superseded' }),
      ),
    );
    expect(mockGetAIResponse).not.toHaveBeenCalled();
  });

  it('does not resume when the history cannot be read again', async () => {
    mockListSessionMessages.mockRejectedValue(new Error('offline'));
    renderHandler();

    await waitFor(() =>
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'COMBAT_ENTRY_HOLD_RESUME_FAILED',
        expect.objectContaining({ sessionId: SESSION_ID }),
      ),
    );
    expect(mockGetAIResponse).not.toHaveBeenCalled();
  });

  it('reads the history immediately before resuming, after the attack check', async () => {
    const order: string[] = [];
    mockCheckDeclaredAttack.mockImplementation(async () => {
      order.push('check');
      return { kind: 'pending', pending };
    });
    mockListSessionMessages.mockImplementation(async (_s: string, offset = 0) => {
      order.push('history');
      return {
        messages: [{ id: 'player-1', speaker_type: 'player' }],
        total: 1,
        hasMore: false,
        offset,
      };
    });
    mockGetAIResponse.mockImplementation(async () => {
      order.push('turn');
      return { text: 'Frost takes Valerius.', rollRequests: [] };
    });
    renderHandler();

    await waitFor(() => expect(mockGetAIResponse).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['check', 'history', 'history', 'turn']);
  });

  it('leaves a session alone whose last message is the DM reply', async () => {
    contextState.messages = [attack, { id: 'dm-2', sender: 'dm', text: 'The spell fades.' }];
    renderHandler();

    await Promise.resolve();
    expect(mockCheckDeclaredAttack).not.toHaveBeenCalled();
    expect(mockGetAIResponse).not.toHaveBeenCalled();
  });

  it('leaves a message alone that the server no longer reads as an attack', async () => {
    mockCheckDeclaredAttack.mockResolvedValue(null);
    renderHandler();

    await waitFor(() => expect(mockCheckDeclaredAttack).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(mockGetAIResponse).not.toHaveBeenCalled();
  });

  it('waits for the messages to load, then resumes once', async () => {
    contextState.messagesReady = false;
    const { view, tree } = renderHandler();
    await Promise.resolve();
    expect(mockCheckDeclaredAttack).not.toHaveBeenCalled();

    contextState.messagesReady = true;
    view.rerender(tree());
    await waitFor(() => expect(mockGetAIResponse).toHaveBeenCalledTimes(1));

    // A live turn later adds messages; the session is not checked again.
    contextState.messages = [...contextState.messages, { id: 'dm-3', sender: 'dm', text: 'x' }];
    view.rerender(tree());
    contextState.messages = [...contextState.messages, { ...attack, id: 'player-2' }];
    view.rerender(tree());
    await Promise.resolve();
    expect(mockCheckDeclaredAttack).toHaveBeenCalledTimes(1);
    expect(mockGetAIResponse).toHaveBeenCalledTimes(1);
  });
});
