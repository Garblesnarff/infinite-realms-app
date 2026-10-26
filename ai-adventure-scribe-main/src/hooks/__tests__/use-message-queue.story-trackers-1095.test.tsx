/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same harness as use-message-queue.test.tsx (#570 precedent): the save
// payload is captured at the userDataApi boundary, which is exactly the
// row the post-save refetch and every reload read back.
const { mockInsert, mockSaveSessionMessages } = vi.hoisted(() => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    mockInsert: insert,
    mockSaveSessionMessages: vi.fn(
      async (
        _sessionId: string,
        payload: unknown,
      ): Promise<{
        messages: Array<{
          id: string;
          speaker_type: string;
          message: string;
          timestamp: string;
          context?: Record<string, unknown>;
        }>;
      }> => {
        const result = await insert(payload);
        if (result.error) throw result.error;
        return { messages: [] };
      },
    ),
  };
});

vi.mock('@/services/user-data-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    isTerminalDefeatError: actual.isTerminalDefeatError,
    userDataApi: {
      saveSessionMessages: mockSaveSessionMessages,
    },
  };
});

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

import { useMessageQueue, persistableStoryTrackers } from '../use-message-queue';

import { useToast } from '@/hooks/use-toast';

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

/**
 * #1095 (Hark V-003): the inline Story clock element renders on only
 * some DM replies. Root cause: the use-ai-response latch attaches
 * context.storyTrackers to the live reply, but the save whitelist below
 * dropped it — so the post-save refetch and every reload read back a row
 * with no tracker line. These tests drive the real save path with
 * latch-shaped messages: a multi-reply session fixture where the clock
 * moves on reply 2 and holds on reply 3. On main they fail (saved
 * contexts carry no storyTrackers); after the fix every saved reply
 * carries its turn's line.
 */
describe('useMessageQueue story trackers (#1095)', () => {
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

  // A latch-shaped DM reply: the context use-ai-response builds, with the
  // storyTrackers the latch attached for that turn.
  const dmReply = (id: string, text: string, storyTrackers: unknown) => ({
    id,
    text,
    sender: 'dm',
    timestamp: new Date().toISOString(),
    context: {
      emotion: 'neutral',
      intent: 'response',
      combat_transition: 'none',
      storyTrackers,
    },
  });

  const savedContexts = () =>
    mockInsert.mock.calls.map((call) => (call[0] as { context: Record<string, unknown> }).context);

  it("persists every reply of a multi-reply session with its turn's storyTrackers", async () => {
    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });

    await act(async () => {
      await result.current.messageMutation.mutateAsync(
        dmReply('dm-1', 'The clock ticks once.', [
          { name: 'Wall Clock', value: 1, limit: 6 },
        ]) as any,
      );
      await result.current.messageMutation.mutateAsync(
        dmReply('dm-2', 'The clock ticks again.', [
          { name: 'Wall Clock', value: 2, limit: 6 },
        ]) as any,
      );
      await result.current.messageMutation.mutateAsync(
        dmReply('dm-3', 'Nothing moves the clock.', [
          { name: 'Wall Clock', value: 2, limit: 6 },
        ]) as any,
      );
    });

    const contexts = savedContexts();
    expect(contexts).toHaveLength(3);
    expect(contexts[0].storyTrackers).toEqual([{ name: 'Wall Clock', value: 1, limit: 6 }]);
    expect(contexts[1].storyTrackers).toEqual([{ name: 'Wall Clock', value: 2, limit: 6 }]);
    expect(contexts[2].storyTrackers).toEqual([{ name: 'Wall Clock', value: 2, limit: 6 }]);
  });

  it('drops malformed tracker entries and persists no key when nothing well-formed survives', async () => {
    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });

    await act(async () => {
      await result.current.messageMutation.mutateAsync(
        dmReply('dm-mixed', 'Mixed entries.', [
          { name: 'Wall Clock', value: 2, limit: 6 },
          { name: 'Broken Clock', value: 1 },
          { name: '   ', value: 1, limit: 6 },
          { name: 'String Clock', value: '2', limit: 6 },
        ]) as any,
      );
      await result.current.messageMutation.mutateAsync(
        dmReply('dm-bad', 'All malformed.', [{ name: 'Broken Clock', value: 1 }]) as any,
      );
    });

    const contexts = savedContexts();
    expect(contexts).toHaveLength(2);
    expect(contexts[0].storyTrackers).toEqual([{ name: 'Wall Clock', value: 2, limit: 6 }]);
    expect(contexts[1]).not.toHaveProperty('storyTrackers');
  });

  it("a retried save flushed through the batch path keeps the reply's storyTrackers", async () => {
    // The queued-batch flush (processMessageBatch) is the second whitelist;
    // a DM reply whose first save failed must not lose its line on retry.
    mockInsert
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: { message: 'Fail' } })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });

    await act(async () => {
      const p = result.current.messageMutation.mutateAsync(
        dmReply('dm-queued', 'Queued DM.', [{ name: 'Wall Clock', value: 2, limit: 6 }]) as any,
      );
      const handled = p.catch(() => undefined);
      await vi.runAllTimersAsync();
      await handled;
    });

    (uuidv4 as any).mockReturnValue('new-uuid');
    await act(async () => {
      await result.current.messageMutation.mutateAsync({
        text: 'Success',
        sender: 'player',
      } as any);
    });

    // 5 calls: 3 failed attempts, 1 successful message, 1 batch flush.
    expect(mockInsert).toHaveBeenCalledTimes(5);
    expect(mockInsert).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Queued DM.',
          context: expect.objectContaining({
            storyTrackers: [{ name: 'Wall Clock', value: 2, limit: 6 }],
          }),
        }),
      ]),
    );
  });

  it('a reply without storyTrackers persists exactly as today (no key added)', async () => {
    const { result } = renderHook(() => useMessageQueue(sessionId), { wrapper });

    await act(async () => {
      await result.current.messageMutation.mutateAsync({
        id: 'dm-plain',
        text: 'No clock on this campaign.',
        sender: 'dm',
        timestamp: new Date().toISOString(),
        context: { emotion: 'neutral', intent: 'response', combat_transition: 'none' },
      } as any);
    });

    expect(savedContexts()).toHaveLength(1);
    expect(savedContexts()[0]).not.toHaveProperty('storyTrackers');
  });

  it('persistableStoryTrackers mirrors the DMMessage render check field for field', () => {
    expect(
      persistableStoryTrackers({
        storyTrackers: [
          { name: 'Wall Clock', value: 2, limit: 6 },
          { name: '', value: 1, limit: 6 },
          { name: 'Zero Clock', value: 0, limit: 0 },
        ],
      } as any),
    ).toEqual({ storyTrackers: [{ name: 'Wall Clock', value: 2, limit: 6 }] });
    expect(persistableStoryTrackers({ storyTrackers: [] } as any)).toEqual({});
    expect(persistableStoryTrackers({} as any)).toEqual({});
    expect(persistableStoryTrackers(null as any)).toEqual({});
  });
});
