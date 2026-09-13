/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use hoisted to define mocks that can be used in vi.mock
const { mockInsert, mockSaveSessionMessages } = vi.hoisted(() => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    mockInsert: insert,
    mockSaveSessionMessages: vi.fn(async (_sessionId: string, payload: unknown) => {
      const result = await insert(payload);
      if (result.error) throw result.error;
      return { messages: [] };
    }),
  };
});

// Mock dependencies BEFORE importing module under test
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    saveSessionMessages: mockSaveSessionMessages,
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

import { useMessageQueue } from '../use-message-queue';

import { useToast } from '@/hooks/use-toast';

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

describe('useMessageQueue', () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const sessionId = 'test-session-id';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    queryClient = createQueryClient();
    (useToast as any).mockReturnValue({ toast: mockToast });
    (uuidv4 as any).mockReturnValue('test-uuid');
    mockInsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should successfully persist a message', async () => {
    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });
    const message: any = {
      text: 'Hello',
      sender: 'player',
      context: {
        location: 'Tavern',
        emotion: 'happy',
        intent: 'greeting',
        combat_transition: 'start',
        scene_spec: { width: 10, height: 10 },
      },
    };

    let persistedMessage;
    await act(async () => {
      persistedMessage = await result.current.messageMutation.mutateAsync(message);
    });

    expect(mockSaveSessionMessages).toHaveBeenCalledWith(sessionId, expect.any(Object));
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-uuid',
        message: 'Hello',
        speaker_type: 'player',
        context: expect.objectContaining({
          location: 'Tavern',
          emotion: 'happy',
          intent: 'greeting',
          handouts: null,
          combat_transition: 'start',
          scene_spec: true,
        }),
        timestamp: expect.any(String),
      }),
    );
    expect(persistedMessage.id).toBe('test-uuid');
    expect(result.current.queueStatus).toBe('idle');
  });

  it('persists narration_segments with the session message', async () => {
    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });
    const narrationSegments = [
      { type: 'dm', text: 'The captain steps forward.', voice_category: 'narrator' },
      {
        type: 'character',
        text: 'Hold the line.',
        character: 'Captain Sarah Reeves',
        voice_category: 'guard',
      },
    ];
    const message: any = {
      text: 'The captain steps forward. "Hold the line," she says.',
      sender: 'dm',
      context: { location: 'Deck', emotion: 'tense', intent: 'response' },
      narrationSegments,
    };

    await act(async () => {
      await result.current.messageMutation.mutateAsync(message);
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        speaker_type: 'dm',
        context: expect.objectContaining({
          narration_segments: narrationSegments,
        }),
      }),
    );
  });

  it('does not persist an already-persisted seating transcript', async () => {
    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });
    const seatingTranscript = '⚙️ Engine: Initiative — You: 16 + 2 = 18 (you rolled).';

    await act(async () => {
      await result.current.messageMutation.mutateAsync({
        text: seatingTranscript,
        sender: 'system',
        persist: false,
      });
    });

    expect(mockSaveSessionMessages).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.current.queueStatus).toBe('idle');
  });

  it('should retry on failure with exponential backoff', async () => {
    mockInsert
      .mockResolvedValueOnce({ error: { message: 'Failed 1' } })
      .mockResolvedValueOnce({ error: { message: 'Failed 2' } })
      .mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });
    const message: any = { text: 'Retry me', sender: 'player' };

    let persistedMessage;
    await act(async () => {
      const mutationPromise = result.current.messageMutation.mutateAsync(message);

      // Advance for first retry
      await vi.advanceTimersByTimeAsync(1000);
      // Advance for second retry
      await vi.advanceTimersByTimeAsync(2000);

      persistedMessage = await mutationPromise;
    });

    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(persistedMessage.id).toBe('test-uuid');
    expect(result.current.queueStatus).toBe('idle');
  });

  it('should add to queue and set error status after max retries', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'Persistent failure' } });

    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });
    const message: any = { text: 'Fail me', sender: 'player' };

    await act(async () => {
      const mutationPromise = result.current.messageMutation.mutateAsync(message);
      const handledPromise = mutationPromise.catch(() => undefined);

      // Max retries is 3
      for (let i = 0; i < 3; i++) {
        await vi.runAllTimersAsync();
      }

      await handledPromise;
    });

    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(result.current.queueStatus).toBe('error');
    expect(result.current.queueLength).toBe(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
      }),
    );
  });

  it('should process batch of queued messages when a new message succeeds', async () => {
    mockInsert
      // Initial failures to get message into queue (3 attempts)
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      // Next attempt (new message) succeeds
      .mockResolvedValueOnce({ error: null }) // Individual insert
      .mockResolvedValueOnce({ error: null }); // Batch insert

    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });

    // 1. Get a message into the queue
    await act(async () => {
      const p = result.current.messageMutation.mutateAsync({
        text: 'Queued',
        sender: 'player',
        context: {
          location: 'Cave',
          combat_transition: 'start',
          scene_spec: { width: 10, height: 10 },
        },
      } as any);
      const handled = p.catch(() => undefined);
      await vi.runAllTimersAsync();
      await handled;
    });

    expect(result.current.queueLength).toBe(1);

    // 2. Send a new message that succeeds
    (uuidv4 as any).mockReturnValue('new-uuid');
    await act(async () => {
      await result.current.messageMutation.mutateAsync({
        text: 'Success',
        sender: 'player',
      } as any);
    });

    // 5 calls: 3 for failed message, 1 for successful message, 1 for batch
    expect(mockInsert).toHaveBeenCalledTimes(5);
    expect(result.current.queueLength).toBe(0);
    // Verify batch insert had the context
    expect(mockInsert).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Queued',
          context: expect.objectContaining({
            location: 'Cave',
            combat_transition: 'start',
            scene_spec: true,
          }),
        }),
      ]),
    );
  });

  it('should manually retry queued messages', async () => {
    mockInsert
      // 3 fails for the first message
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      // success for manual retry
      .mockResolvedValue({ error: null });

    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });

    await act(async () => {
      const p = result.current.messageMutation.mutateAsync({
        text: 'Queued',
        sender: 'player',
      } as any);
      const handled = p.catch(() => undefined);
      await vi.runAllTimersAsync();
      await handled;
    });

    expect(result.current.queueLength).toBe(1);

    // Manually retry
    await act(async () => {
      await result.current.retryQueuedMessages();
    });

    expect(mockInsert).toHaveBeenCalledTimes(4); // 3 fails + 1 batch success
    expect(result.current.queueLength).toBe(0);
  });

  it('should handle failure in manual retry', async () => {
    mockInsert
      // 3 fails for the first message
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      // failure for manual retry
      .mockResolvedValue({ error: { message: 'Manual retry failed' } });

    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });

    await act(async () => {
      const p = result.current.messageMutation.mutateAsync({
        text: 'Queued',
        sender: 'player',
      } as any);
      const handled = p.catch(() => undefined);
      await vi.runAllTimersAsync();
      await handled;
    });

    expect(result.current.queueLength).toBe(1);

    // Manually retry
    await act(async () => {
      await result.current.retryQueuedMessages();
    });

    expect(mockInsert).toHaveBeenCalledTimes(4);
    expect(result.current.queueLength).toBe(1); // Still 1 because it failed
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
        description: 'Failed to process message batch. Will retry later.',
      }),
    );
  });
});
