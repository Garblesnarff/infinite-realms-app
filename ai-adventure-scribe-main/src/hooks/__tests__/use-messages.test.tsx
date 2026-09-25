/* eslint-disable max-lines */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMessages } from '../use-messages';

import { userDataApi } from '@/services/user-data-api';

// useMessages was migrated from supabase.from('dialogue_history').select()...range() /
// .insert() to userDataApi.listSessionMessages() / userDataApi.saveSessionMessages()
// (real fetch() calls to the Bun server) - see src/hooks/use-messages.ts. The mocks and
// per-test response shapes below were updated to match the new client's return shape
// ({ messages, total, hasMore }) and call signature (sessionId, offset, limit).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessionMessages: vi.fn(),
    saveSessionMessages: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

describe('useMessages', () => {
  let queryClient: QueryClient;
  const sessionId = 'test-session-id';

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should not fetch messages if sessionId is missing', () => {
    const { result } = renderHook(() => useMessages(null), { wrapper });

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('should fetch messages successfully on initial load', async () => {
    const mockMessages = [
      {
        id: 'msg-1',
        message: 'Hello',
        speaker_type: 'player',
        timestamp: new Date().toISOString(),
        sequence_number: 1,
        images: ['img1.jpg'],
        game_sessions: {
          characters: {
            name: 'Hero',
            avatar_url: 'hero-url',
          },
        },
      },
      {
        id: 'msg-2',
        message: 'Hi there',
        speaker_type: 'dm',
        timestamp: new Date().toISOString(),
        sequence_number: 2,
        images: null,
        game_sessions: {
          characters: null,
        },
      },
    ];

    vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
      messages: mockMessages,
      total: 2,
      hasMore: false,
    });

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.data.length).toBe(2), { timeout: 2000 });

    expect(result.current.data[0].text).toBe('Hello');
    expect(result.current.data[0].characterName).toBe('Hero');
    expect(result.current.data[0].images).toEqual(['img1.jpg']);
    expect(result.current.data[1].text).toBe('Hi there');
    expect(result.current.data[1].sender).toBe('dm');
    expect(result.current.data[1].characterName).toBeUndefined();
    expect(result.current.data[1].images).toBeUndefined();
    expect(result.current.hasMore).toBe(false);
  });

  it('restores persisted narration_segments onto loaded DM messages', async () => {
    const narrationSegments = [
      { type: 'dm', text: 'The captain steps forward.', voice_category: 'narrator' },
      {
        type: 'character',
        text: 'Hold the line.',
        character: 'Captain Sarah Reeves',
        voice_category: 'guard',
      },
    ];

    vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'msg-dm',
          message: 'The captain steps forward. "Hold the line," she says.',
          speaker_type: 'dm',
          timestamp: new Date().toISOString(),
          sequence_number: 1,
          context: { narration_segments: narrationSegments },
          game_sessions: { characters: null },
        },
      ],
      total: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.data.length).toBe(1), { timeout: 2000 });

    expect(result.current.data[0].narrationSegments).toEqual(narrationSegments);
  });

  it('restores structured roll requests from a persisted DM context', async () => {
    const rollRequests = [
      { type: 'skill_check', formula: '1d20+5', purpose: 'Stealth check', dc: 13 },
    ];
    vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'dm-roll',
          message: '',
          speaker_type: 'dm',
          timestamp: new Date().toISOString(),
          sequence_number: 1,
          context: { intent: 'pending_roll_request', rollRequests },
          game_sessions: { characters: null },
        },
      ],
      total: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.data.length).toBe(1), { timeout: 2000 });
    expect(result.current.data[0].rollRequests).toEqual(rollRequests);
    expect(result.current.data[0].context?.intent).toBe('pending_roll_request');
  });

  it('should handle pagination with loadMore', async () => {
    const page0Results = {
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        message: `Message ${i}`,
        speaker_type: 'player',
        timestamp: new Date(Date.now() + i).toISOString(),
        sequence_number: i,
        game_sessions: {},
      })),
      total: 100,
      hasMore: true,
    };

    const page1Results = {
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i + 50}`,
        message: `Message ${i + 50}`,
        speaker_type: 'player',
        timestamp: new Date(Date.now() + i + 50).toISOString(),
        sequence_number: i + 50,
        game_sessions: {},
      })),
      total: 100,
      hasMore: false,
    };

    // useMessages() calls userDataApi.listSessionMessages(sessionId, offset, limit) -
    // offset is page * PAGE_SIZE(50), so branch on offset to serve the right page.
    vi.mocked(userDataApi.listSessionMessages).mockImplementation((_sessionId, offset = 0) => {
      if (offset === 0) return Promise.resolve(page0Results);
      return Promise.resolve(page1Results);
    });

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.data.length).toBe(50), { timeout: 2000 });
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.data.length).toBe(100), { timeout: 2000 });
    expect(result.current.hasMore).toBe(false);
  });

  it('should handle errors gracefully', async () => {
    // The Bun REST client throws on a failed request (rather than returning a
    // { data, error } tuple like supabase-js did), so simulate a failure with a rejection.
    vi.mocked(userDataApi.listSessionMessages).mockRejectedValue(new Error('Database error'));

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });
    expect(result.current.data).toEqual([]);
  });

  it('should add a message successfully', async () => {
    vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
      messages: [],
      total: 0,
      hasMore: false,
    });
    vi.mocked(userDataApi.saveSessionMessages).mockResolvedValue({});

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    const newMessage = {
      id: 'new-msg',
      text: 'New message',
      sender: 'player' as const,
      timestamp: new Date().toISOString(),
      context: {
        location: 'Forest',
        emotion: 'Happy',
        intent: 'Explore',
      },
    };

    await act(async () => {
      await result.current.addMessage(newMessage);
    });

    expect(userDataApi.saveSessionMessages).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        id: 'new-msg',
        message: 'New message',
        context: expect.objectContaining({
          location: 'Forest',
          emotion: 'Happy',
          intent: 'Explore',
        }),
      }),
    );
  });

  it('should handle error when adding a message', async () => {
    vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
      messages: [],
      total: 0,
      hasMore: false,
    });
    const mockError = { message: 'Insert failed' };
    vi.mocked(userDataApi.saveSessionMessages).mockRejectedValue(mockError);

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    const newMessage = {
      id: 'fail-msg',
      text: 'Failed message',
      sender: 'player' as const,
      timestamp: new Date().toISOString(),
    };

    // addMessage() rethrows whatever userDataApi.saveSessionMessages() rejects with verbatim.
    await expect(result.current.addMessage(newMessage)).rejects.toEqual(mockError);
  });

  it('should reset pagination', async () => {
    vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          message: 'Hello',
          speaker_type: 'player',
          timestamp: new Date().toISOString(),
          sequence_number: 1,
        },
      ],
      total: 1,
      hasMore: false,
    });

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.data.length).toBe(1), { timeout: 2000 });

    act(() => {
      result.current.resetPagination();
    });

    expect(result.current.data).toEqual([]);
  });

  it('should deduplicate messages when merging pages', async () => {
    const page0Results = {
      messages: [
        {
          id: 'msg-1',
          message: 'M1',
          speaker_type: 'player',
          timestamp: new Date(1000).toISOString(),
          sequence_number: 1,
          game_sessions: {},
        },
        {
          id: 'msg-2',
          message: 'M2',
          speaker_type: 'player',
          timestamp: new Date(2000).toISOString(),
          sequence_number: 2,
          game_sessions: {},
        },
      ],
      total: 100,
      hasMore: true,
    };

    const page1Results = {
      messages: [
        {
          id: 'msg-2',
          message: 'M2',
          speaker_type: 'player',
          timestamp: new Date(2000).toISOString(),
          sequence_number: 2,
          game_sessions: {},
        },
        {
          id: 'msg-3',
          message: 'M3',
          speaker_type: 'player',
          timestamp: new Date(3000).toISOString(),
          sequence_number: 3,
          game_sessions: {},
        },
      ],
      total: 100,
      hasMore: false,
    };

    vi.mocked(userDataApi.listSessionMessages).mockImplementation((_sessionId, offset = 0) => {
      if (offset === 0) return Promise.resolve(page0Results);
      return Promise.resolve(page1Results);
    });

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    // Initial load
    await waitFor(() => expect(result.current.data.length).toBe(2), { timeout: 2000 });
    expect(result.current.hasMore).toBe(true);

    // Load more
    act(() => {
      result.current.loadMore();
    });

    // Should wait for the new data to be merged
    await waitFor(
      () => {
        const ids = result.current.data.map((m) => m.id);
        expect(ids).toEqual(['msg-1', 'msg-2', 'msg-3']);
      },
      { timeout: 4000 },
    );
  });

  it('keeps history chronological when an older page loads after the newest page (#1678)', async () => {
    // Mirrors production ordering: the server returns pages newest-first (ORDER BY
    // timestamp DESC), so the initial load (offset 0) is the NEWEST 50 messages, and
    // loadMore() (offset 50) fetches the next, OLDER 50 messages further back in
    // history. Before the fix, the hook appended each new page to the END of the
    // array regardless of load order, so this older page would be treated as the
    // newest conversation by the prompt's history selector.
    const newestPageResults = {
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i + 51}`,
        message: `Message ${i + 51}`,
        speaker_type: 'player',
        timestamp: new Date(1000 * (i + 51)).toISOString(),
        sequence_number: i + 51,
        game_sessions: {},
      })),
      total: 100,
      hasMore: true,
    };

    const olderPageResults = {
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i + 1}`,
        message: `Message ${i + 1}`,
        speaker_type: 'player',
        timestamp: new Date(1000 * (i + 1)).toISOString(),
        sequence_number: i + 1,
        game_sessions: {},
      })),
      total: 100,
      hasMore: false,
    };

    vi.mocked(userDataApi.listSessionMessages).mockImplementation((_sessionId, offset = 0) => {
      if (offset === 0) return Promise.resolve(newestPageResults);
      return Promise.resolve(olderPageResults);
    });

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    // Initial load returns the newest page (offset 0)
    await waitFor(() => expect(result.current.data.length).toBe(50), { timeout: 2000 });
    expect(result.current.data[0].id).toBe('msg-51');
    expect(result.current.data[49].id).toBe('msg-100');
    expect(result.current.hasMore).toBe(true);

    // Load the older page (scrolling back through history)
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.data.length).toBe(100), { timeout: 4000 });

    const ids = result.current.data.map((m) => m.id);
    const expectedIds = Array.from({ length: 100 }, (_, i) => `msg-${i + 1}`);

    // Array is strictly chronological (oldest first) regardless of load order.
    expect(ids).toEqual(expectedIds);
    // No duplicate messages after merging pages.
    expect(new Set(ids).size).toBe(ids.length);
    // The true newest message (highest sequence number) is last, so the prompt's
    // history selector - which walks from the array end - picks the newest turns.
    expect(ids[ids.length - 1]).toBe('msg-100');
    expect(result.current.hasMore).toBe(false);
  });
});
