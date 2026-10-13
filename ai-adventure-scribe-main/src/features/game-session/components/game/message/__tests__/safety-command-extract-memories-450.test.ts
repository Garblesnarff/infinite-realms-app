/**
 * #450: the safety-command path calls extractMemories(content) with the
 * content string only (the real signature), not an ignored options object.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockExtractMemories = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSendMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ sendMessage: mockSendMessage, messages: [] }),
}));
vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: mockExtractMemories }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: vi.fn() }),
}));
vi.mock('@/services/auth/TokenService', () => ({ clearPendingInput: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({
    isSafetyCommand: true,
    command: { type: 'x_card', context: 'player tapped the X-card', autoTriggered: false },
    response: { sender: 'system', text: 'Scene paused.' },
    shouldPause: false,
    shouldResume: false,
  }),
  processSafetyCommand: vi.fn(),
}));

import { useMessageCommandHandler } from '../use-message-command-handler';

describe('safety command memory (#450)', () => {
  it('calls extractMemories with the content string only', async () => {
    const { result } = renderHook(() =>
      useMessageCommandHandler({
        sessionId: 'session-1',
        updateGameSessionState: vi.fn().mockResolvedValue(undefined),
      }),
    );

    await result.current.handleSafetyCommand('/x');

    expect(mockExtractMemories).toHaveBeenCalledTimes(1);
    expect(mockExtractMemories.mock.calls[0]).toEqual([
      'Safety command x_card activated: player tapped the X-card',
    ]);
  });
});
