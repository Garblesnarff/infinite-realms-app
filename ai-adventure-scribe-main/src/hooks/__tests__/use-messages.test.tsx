/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMessages } from '../use-messages';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn()
  }
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}));

const createQueryClient = (): QueryClient => new QueryClient({
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
            avatar_url: 'hero-url'
          }
        }
      },
      {
        id: 'msg-2',
        message: 'Hi there',
        speaker_type: 'dm',
        timestamp: new Date().toISOString(),
        sequence_number: 2,
        images: null,
        game_sessions: {
          characters: null
        }
      }
    ];

    const mockFrom = vi.mocked(supabase.from);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: mockMessages,
        error: null,
        count: 2
      })
    } as any);

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

  it('should handle pagination with loadMore', async () => {
    const mockFrom = vi.mocked(supabase.from);

    const page0Results = {
      data: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        message: `Message ${i}`,
        speaker_type: 'player',
        timestamp: new Date(Date.now() + i).toISOString(),
        sequence_number: i,
        game_sessions: {}
      })),
      error: null,
      count: 100
    };

    const page1Results = {
      data: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i + 50}`,
        message: `Message ${i + 50}`,
        speaker_type: 'player',
        timestamp: new Date(Date.now() + i + 50).toISOString(),
        sequence_number: i + 50,
        game_sessions: {}
      })),
      error: null,
      count: 100
    };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation((start: number) => {
        if (start === 0) return Promise.resolve(page0Results);
        return Promise.resolve(page1Results);
      })
    } as any);

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.data.length).toBe(50), { timeout: 2000 });
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.data.length).toBe(100), { timeout: 2000 });
    expect(result.current.hasMore).toBe(false);
  });

  it('should handle Supabase errors gracefully', async () => {
    const mockFrom = vi.mocked(supabase.from);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
        count: 0
      })
    } as any);

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });
    expect(result.current.data).toEqual([]);
  });

  it('should add a message successfully', async () => {
    const mockFrom = vi.mocked(supabase.from);
    const mockInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      insert: mockInsert
    } as any);

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    const newMessage = {
      id: 'new-msg',
      text: 'New message',
      sender: 'player' as const,
      timestamp: new Date().toISOString(),
      context: {
        location: 'Forest',
        emotion: 'Happy',
        intent: 'Explore'
      }
    };

    await act(async () => {
      await result.current.addMessage(newMessage);
    });

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-msg',
      message: 'New message',
      session_id: sessionId,
      context: {
        location: 'Forest',
        emotion: 'Happy',
        intent: 'Explore'
      }
    }));
  });

  it('should handle error when adding a message', async () => {
    const mockFrom = vi.mocked(supabase.from);
    const mockError = { message: 'Insert failed' };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: mockError })
    } as any);

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    const newMessage = {
      id: 'fail-msg',
      text: 'Failed message',
      sender: 'player' as const,
      timestamp: new Date().toISOString()
    };

    await expect(result.current.addMessage(newMessage)).rejects.toEqual(mockError);
  });

  it('should reset pagination', async () => {
    const mockFrom = vi.mocked(supabase.from);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [{ id: 'msg-1', message: 'Hello', speaker_type: 'player', timestamp: new Date().toISOString(), sequence_number: 1 }],
        error: null,
        count: 1
      })
    } as any);

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    await waitFor(() => expect(result.current.data.length).toBe(1), { timeout: 2000 });

    act(() => {
      result.current.resetPagination();
    });

    expect(result.current.data).toEqual([]);
  });

  it('should deduplicate messages when merging pages', async () => {
    const mockFrom = vi.mocked(supabase.from);

    const page0Results = {
      data: [
        { id: 'msg-1', message: 'M1', speaker_type: 'player', timestamp: new Date(1000).toISOString(), sequence_number: 1, game_sessions: {} },
        { id: 'msg-2', message: 'M2', speaker_type: 'player', timestamp: new Date(2000).toISOString(), sequence_number: 2, game_sessions: {} }
      ],
      error: null,
      count: 100
    };

    const page1Results = {
      data: [
        { id: 'msg-2', message: 'M2', speaker_type: 'player', timestamp: new Date(2000).toISOString(), sequence_number: 2, game_sessions: {} },
        { id: 'msg-3', message: 'M3', speaker_type: 'player', timestamp: new Date(3000).toISOString(), sequence_number: 3, game_sessions: {} }
      ],
      error: null,
      count: 100
    };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation((start: number) => {
        if (start === 0) return Promise.resolve(page0Results);
        return Promise.resolve(page1Results);
      })
    } as any);

    const { result } = renderHook(() => useMessages(sessionId), { wrapper });

    // Initial load
    await waitFor(() => expect(result.current.data.length).toBe(2), { timeout: 2000 });
    expect(result.current.hasMore).toBe(true);

    // Load more
    act(() => {
      result.current.loadMore();
    });

    // Should wait for the new data to be merged
    await waitFor(() => {
      const ids = result.current.data.map(m => m.id);
      expect(ids).toEqual(['msg-1', 'msg-2', 'msg-3']);
    }, { timeout: 4000 });
  });
});
