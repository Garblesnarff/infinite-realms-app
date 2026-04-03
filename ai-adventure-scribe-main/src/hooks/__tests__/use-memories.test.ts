/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMemoryCreation } from '../memory/useMemoryCreation';
import { useMemoryRetrieval } from '../memory/useMemoryRetrieval';
import { useMemories } from '../use-memories';

vi.mock('../memory/useMemoryCreation', () => ({
  useMemoryCreation: vi.fn(),
}));

vi.mock('../memory/useMemoryRetrieval', () => ({
  useMemoryRetrieval: vi.fn(),
}));

describe('useMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return combined data from creation and retrieval hooks', () => {
    const mockMemories = [{ id: '1', content: 'test' }];
    const mockCreateMemory = vi.fn();
    const mockExtractMemories = vi.fn();

    vi.mocked(useMemoryRetrieval).mockReturnValue({
      data: mockMemories,
      isLoading: false,
    } as any);

    vi.mocked(useMemoryCreation).mockReturnValue({
      createMemory: mockCreateMemory,
      extractMemories: mockExtractMemories,
    } as any);

    const { result } = renderHook(() => useMemories('session-123'));

    expect(result.current.memories).toEqual(mockMemories);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.createMemory).toBe(mockCreateMemory);
    expect(result.current.extractMemories).toBe(mockExtractMemories);
    expect(useMemoryRetrieval).toHaveBeenCalledWith('session-123');
    expect(useMemoryCreation).toHaveBeenCalledWith('session-123');
  });

  it('should handle default memories when retrieval returns undefined', () => {
    vi.mocked(useMemoryRetrieval).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    vi.mocked(useMemoryCreation).mockReturnValue({
      createMemory: vi.fn(),
      extractMemories: vi.fn(),
    } as any);

    const { result } = renderHook(() => useMemories('session-123'));

    expect(result.current.memories).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('should pass null sessionId to sub-hooks', () => {
    vi.mocked(useMemoryRetrieval).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    vi.mocked(useMemoryCreation).mockReturnValue({
      createMemory: vi.fn(),
      extractMemories: vi.fn(),
    } as any);

    renderHook(() => useMemories(null));

    expect(useMemoryRetrieval).toHaveBeenCalledWith(null);
    expect(useMemoryCreation).toHaveBeenCalledWith(null);
  });
});
