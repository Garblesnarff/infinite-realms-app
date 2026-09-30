/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMemoryCreation } from '../useMemoryCreation';

import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { processContent } from '@/utils/memoryClassification';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('@/services/user-data-api', async () => {
  const { supabase } = await import('@/integrations/supabase/client');
  return {
    userDataApi: {
      createMemories: async (records: unknown[]) => {
        const { data, error } = await supabase.from('memories').insert(records).select().single();
        if (error) throw error;
        return [data];
      },
    },
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('@/utils/memoryClassification', () => ({
  processContent: vi.fn(),
}));

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
      mutations: {
        retry: false,
      },
    },
  });

describe('useMemoryCreation', () => {
  let queryClient: QueryClient;
  const sessionId = 'test-session-id';
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    (useToast as any).mockReturnValue({ toast: mockToast });
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const mockInsertChain = (data: unknown) => {
    const insertSpy = vi.fn().mockReturnThis();
    vi.mocked(supabase.from).mockReturnValue({
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data, error: null }),
    } as any);
    return insertSpy;
  };

  describe('createMemory', () => {
    // The point of #1822's PR2: the browser sends what the memory is and nothing else. The
    // server generates the vector, so a client-side embedding failure can no longer be the
    // reason a row lands without one.
    it('sends bare content and never calls an embedding function', async () => {
      const mockMemory = {
        type: 'npc' as const,
        content: 'Met a mysterious traveler named Elara.',
        importance: 3,
        metadata: {},
      };

      const mockData = { id: 'mem-1', ...mockMemory, session_id: sessionId };
      const insertSpy = mockInsertChain(mockData);

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory(mockMemory);
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
      expect(supabase.from).toHaveBeenCalledWith('memories');

      const records = insertSpy.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(records).toHaveLength(1);
      expect(records[0]).not.toHaveProperty('embedding');
      expect(records[0]).toMatchObject({
        content: mockMemory.content,
        session_id: sessionId,
      });

      // Verify cache update
      const cachedMemories = queryClient.getQueryData<any[]>(['memories', sessionId]);
      expect(cachedMemories).toHaveLength(1);
      expect(cachedMemories![0].id).toBe('mem-1');
    });

    it('should clamp importance score to range 1-10', async () => {
      const mockMemory = {
        type: 'event' as const,
        content: 'A massive dragon attacked the city.',
        importance: 14, // Should be clamped to 10
      };

      const insertSpy = mockInsertChain({ id: 'mem-3', ...mockMemory, importance: 10 });

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory(mockMemory);
      });

      expect(insertSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            importance: 10,
          }),
        ]),
      );
    });

    it('should fail if content is missing', async () => {
      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory({ type: 'npc', content: '' });
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          variant: 'destructive',
        }),
      );
    });

    it('should fail if type is invalid', async () => {
      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory({
          type: 'invalid-type',
          content: 'Valid content',
        });
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
        }),
      );
    });
  });

  describe('extractMemories', () => {
    it('should filter short segments and duplicates, and prioritize by importance', async () => {
      const longContent1 =
        'This is a long enough segment that should be processed correctly and it has more than fifty characters.';
      const longContent2 =
        'Another long enough segment that is different from the previous one and also has high importance.';

      const mockSegments = [
        { content: 'Too short', type: 'general', importance: 1 }, // < 50 chars
        { content: longContent1, type: 'npc', importance: 3 },
        { content: longContent1, type: 'npc', importance: 3 }, // Duplicate
        { content: longContent2, type: 'location', importance: 5 },
      ];

      (processContent as any).mockReturnValue(mockSegments);

      const insertSpy = mockInsertChain({ id: 'mem-ext' });

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await result.current.extractMemories('Some content');
      });

      // Based on MAX_SEGMENTS_PER_MESSAGE = 1, it should only pick the one with importance 5
      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(insertSpy).toHaveBeenCalledWith([
        expect.objectContaining({ content: longContent2, session_id: sessionId }),
      ]);
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('should skip segments with invalid types', async () => {
      const mockSegments = [
        {
          content:
            'Valid length segment that has an invalid type assigned to it by the classifier.',
          type: 'invalid' as any,
          importance: 5,
        },
      ];

      (processContent as any).mockReturnValue(mockSegments);
      const insertSpy = mockInsertChain({ id: 'mem-none' });

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await result.current.extractMemories('Some content');
      });

      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('should handle error during extraction', async () => {
      (processContent as any).mockImplementation(() => {
        throw new Error('Extraction failed');
      });

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await expect(result.current.extractMemories('Some content')).rejects.toThrow(
        'Extraction failed',
      );
    });
  });
});
