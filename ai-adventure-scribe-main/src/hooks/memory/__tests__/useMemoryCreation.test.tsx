/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMemoryCreation } from '../useMemoryCreation';

import { isSemanticMemoriesEnabled } from '@/config/featureFlags';
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

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('@/utils/memoryClassification', () => ({
  processContent: vi.fn(),
}));

vi.mock('@/config/featureFlags', () => ({
  isSemanticMemoriesEnabled: vi.fn(),
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
    (isSemanticMemoriesEnabled as any).mockReturnValue(true);
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('createMemory', () => {
    it('should successfully create a memory with embedding', async () => {
      const mockMemory = {
        type: 'npc' as const,
        content: 'Met a mysterious traveler named Elara.',
        importance: 3,
        metadata: {},
      };

      const mockData = { id: 'mem-1', ...mockMemory, session_id: sessionId };

      (supabase.functions.invoke as any).mockResolvedValue({
        data: { embedding: [0.1, 0.2, 0.3] },
        error: null,
      });

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      } as any);

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory(mockMemory);
      });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('generate-embedding', {
        body: { text: mockMemory.content },
      });
      expect(mockFrom).toHaveBeenCalledWith('memories');

      // Verify cache update
      const cachedMemories = queryClient.getQueryData<any[]>(['memories', sessionId]);
      expect(cachedMemories).toHaveLength(1);
      expect(cachedMemories![0].id).toBe('mem-1');
    });

    it('should successfully create a memory without embedding if disabled', async () => {
      (isSemanticMemoriesEnabled as any).mockReturnValue(false);

      const mockMemory = {
        type: 'location' as const,
        content: 'The party arrived at the Whispering Woods.',
        importance: 2,
      };

      const mockData = { id: 'mem-2', ...mockMemory, session_id: sessionId };

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      } as any);

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory(mockMemory);
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalledWith('memories');
    });

    it('should clamp importance score to range 1-5', async () => {
      const mockMemory = {
        type: 'event' as const,
        content: 'A massive dragon attacked the city.',
        importance: 10, // Should be clamped to 5
      };

      const mockFrom = vi.mocked(supabase.from);
      const insertSpy = vi.fn().mockReturnThis();
      mockFrom.mockReturnValue({
        insert: insertSpy,
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: 'mem-3', ...mockMemory, importance: 5 }, error: null }),
      } as any);

      (supabase.functions.invoke as any).mockResolvedValue({
        data: { embedding: [0.1] },
        error: null,
      });

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory(mockMemory);
      });

      expect(insertSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            importance: 5,
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

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'mem-ext' }, error: null }),
      } as any);

      (supabase.functions.invoke as any).mockResolvedValue({
        data: { embedding: [0.1] },
        error: null,
      });

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await result.current.extractMemories('Some content');
      });

      // Based on MAX_SEGMENTS_PER_MESSAGE = 1, it should only pick the one with importance 5
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('generate-embedding', {
        body: { text: longContent2 },
      });
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

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await result.current.extractMemories('Some content');
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
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

  describe('generateEmbedding error', () => {
    it('should handle error during embedding generation', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: null,
        error: new Error('Embedding failed'),
      });

      const mockMemory = {
        type: 'npc' as const,
        content: 'Valid content',
        importance: 3,
      };

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory(mockMemory);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: expect.stringContaining('Embedding failed'),
        }),
      );
    });

    it('should handle missing embedding in response', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {}, // Missing embedding
        error: null,
      });

      const mockMemory = {
        type: 'npc' as const,
        content: 'Valid content',
        importance: 3,
      };

      const { result } = renderHook(() => useMemoryCreation(sessionId), { wrapper });

      await act(async () => {
        await (result.current as any).createMemory(mockMemory);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: expect.stringContaining('Invalid embedding format'),
        }),
      );
    });
  });
});
