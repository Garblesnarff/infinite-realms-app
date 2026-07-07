/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMemoryRetrieval } from '../useMemoryRetrieval';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/services/user-data-api', async () => {
  const { supabase } = await import('@/integrations/supabase/client');
  return {
    userDataApi: {
      listMemories: async (sessionId: string) => {
        const { data, error } = await supabase
          .from('memories')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
      },
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

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe('useMemoryRetrieval', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should return empty array and not fetch if sessionId is null', async () => {
    const { result } = renderHook(() => useMemoryRetrieval(null), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('should successfully fetch and transform memories', async () => {
    const sessionId = 'test-session-123';
    const mockMemories = [
      {
        id: 'mem-1',
        type: 'npc',
        content: 'Met Elara',
        importance: 3,
        metadata: { npcId: 'elara' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        session_id: sessionId,
      },
      {
        id: 'mem-2',
        type: 'location',
        content: 'Arrived at Neverwinter',
        importance: 2,
        metadata: null,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        session_id: sessionId,
      },
    ];

    const mockFrom = vi.mocked(supabase.from);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockMemories, error: null }),
    } as any);

    const { result } = renderHook(() => useMemoryRetrieval(sessionId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0]).toEqual(
      expect.objectContaining({
        id: 'mem-1',
        type: 'npc',
        content: 'Met Elara',
        embedding: null, // Should be null as per Bolt optimization
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[Memory Retrieval] Fetching memories for session:',
      sessionId,
    );
  });

  it('should default invalid memory types to general and log a warning', async () => {
    const sessionId = 'test-session-123';
    const mockMemories = [
      {
        id: 'mem-1',
        type: 'invalid-type',
        content: 'Something happened',
        session_id: sessionId,
      },
    ];

    const mockFrom = vi.mocked(supabase.from);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockMemories, error: null }),
    } as any);

    const { result } = renderHook(() => useMemoryRetrieval(sessionId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0].type).toBe('general');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid memory type detected: invalid-type, defaulting to 'general'",
      ),
    );
  });

  it('should provide sensible defaults for missing fields', async () => {
    const sessionId = 'test-session-123';
    const mockMemories = [
      {
        id: 'mem-1',
        type: 'npc',
        content: 'Met Elara',
        session_id: sessionId,
        // missing importance, created_at, updated_at
      },
    ];

    const mockFrom = vi.mocked(supabase.from);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockMemories, error: null }),
    } as any);

    const { result } = renderHook(() => useMemoryRetrieval(sessionId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const memory = result.current.data![0];
    expect(memory.importance).toBe(0);
    expect(memory.created_at).toBeDefined();
    expect(memory.updated_at).toBeDefined();
    // Verify they are ISO strings
    expect(new Date(memory.created_at).toISOString()).toBe(memory.created_at);
  });

  it('should throw error when Supabase query fails', async () => {
    const sessionId = 'test-session-123';
    const mockError = { message: 'Database error' };

    const mockFrom = vi.mocked(supabase.from);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: mockError }),
    } as any);

    const { result } = renderHook(() => useMemoryRetrieval(sessionId), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
    expect(logger.error).toHaveBeenCalledWith(
      '[Memory Retrieval] Error fetching memories:',
      mockError,
    );
  });
});
