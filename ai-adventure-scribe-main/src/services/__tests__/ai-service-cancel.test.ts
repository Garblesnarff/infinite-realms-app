import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AIService } from '../ai-service';

import { llmApiClient } from '@/infrastructure/api';
import { useDmWaiting } from '@/services/ai/dm-wait';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: { generateText: vi.fn(), lastRequestId: null, lastGenerateRequestId: null },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn().mockResolvedValue([]),
    extractMemories: vi.fn().mockResolvedValue({ memories: [] }),
    saveMemories: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/services/narrative/scene-state-client', () => ({
  fetchSceneState: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/world-builders/world-builder-service', () => ({
  WorldBuilderService: {
    respondToPlayerAction: vi.fn().mockResolvedValue({ locations: [], npcs: [], quests: [] }),
  },
}));

const turn = (message: string, signal?: AbortSignal) => ({
  message,
  context: { campaignId: 'camp', characterId: 'char', sessionId: 'session-2418' },
  conversationHistory: [],
  ...(signal ? { signal } : {}),
});

describe('AIService.chatWithDM: cancelling and the DM wait (#2418)', () => {
  beforeEach(() => {
    vi.mocked(llmApiClient.generateText).mockReset();
  });

  it('hands the signal to the generate request, so aborting stops the wait', async () => {
    const controller = new AbortController();
    vi.mocked(llmApiClient.generateText).mockImplementation(
      (params) =>
        new Promise<string>((_resolve, reject) => {
          params.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    const pending = AIService.chatWithDM(turn('I cast Acid Splash', controller.signal));
    const assertion = expect(pending).rejects.toThrow('Failed to get DM response');
    await vi.waitFor(() => expect(llmApiClient.generateText).toHaveBeenCalledTimes(1));
    expect(vi.mocked(llmApiClient.generateText).mock.calls[0][0].signal).toBe(controller.signal);

    controller.abort();
    await assertion;
  });

  it('does not answer a retry of the same message from the cancelled call', async () => {
    const controller = new AbortController();
    vi.mocked(llmApiClient.generateText).mockImplementationOnce(
      (params) =>
        new Promise<string>((_resolve, reject) => {
          params.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    vi.mocked(llmApiClient.generateText).mockResolvedValue('The acid hisses.');

    const first = AIService.chatWithDM(turn('I cast Acid Splash again', controller.signal));
    const firstSettled = first.catch(() => undefined);
    await vi.waitFor(() => expect(llmApiClient.generateText).toHaveBeenCalledTimes(1));
    controller.abort();
    await firstSettled;

    const retry = await AIService.chatWithDM(
      turn('I cast Acid Splash again', new AbortController().signal),
    );

    expect(retry.text).toBe('The acid hisses.');
    expect(llmApiClient.generateText).toHaveBeenCalledTimes(2);
  });

  it('counts the whole call as a DM wait, and stops counting when it fails', async () => {
    const { result } = renderHook(() => useDmWaiting());
    expect(result.current).toBe(false);
    let answer!: (value: string) => void;
    vi.mocked(llmApiClient.generateText).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );

    let call!: Promise<unknown>;
    act(() => {
      call = AIService.chatWithDM(turn('I look around'));
    });
    expect(result.current).toBe(true);

    await act(async () => {
      await vi.waitFor(() => expect(llmApiClient.generateText).toHaveBeenCalled());
      answer('You see a hall.');
      await call;
    });
    expect(result.current).toBe(false);

    vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('down'));
    await act(async () => {
      await AIService.chatWithDM(turn('I look again')).catch(() => undefined);
    });
    expect(result.current).toBe(false);
  });
});
