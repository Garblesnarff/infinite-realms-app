import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { useMemoryFiltering, groupMemories } from '../useMemoryFiltering';

import type { Memory } from '@/types/memory';

describe('useMemoryFiltering', () => {
  const mockMemories: Memory[] = [
    {
      id: '1',
      type: 'npc',
      subcategory: 'npc_action',
      content: 'Eldrin cast a spell',
      importance: 3,
      created_at: '2024-01-01T10:00:00Z',
      updated_at: '2024-01-01T10:00:00Z',
      tags: ['magic', 'eldrin'],
      metadata: {},
    },
    {
      id: '2',
      type: 'location',
      subcategory: 'description',
      content: 'The tavern was smoky',
      importance: 1,
      created_at: '2024-01-01T09:00:00Z',
      updated_at: '2024-01-01T09:00:00Z',
      context_id: 'ctx-1',
      metadata: {},
    },
    {
      id: '3',
      type: 'quest',
      content: 'Find the lost crown',
      importance: 5,
      created_at: '2024-01-01T11:00:00Z',
      updated_at: '2024-01-01T11:00:00Z',
      tags: ['main-quest'],
      metadata: {},
    },
  ];

  it('should return empty array if memories is null or undefined', () => {
    const { result: resultNull } = renderHook(() => useMemoryFiltering(null));
    expect(resultNull.current).toEqual([]);

    const { result: resultUndefined } = renderHook(() => useMemoryFiltering(undefined));
    expect(resultUndefined.current).toEqual([]);
  });

  it('should return all memories sorted by importance (desc) by default', () => {
    const { result } = renderHook(() => useMemoryFiltering(mockMemories));
    expect(result.current).toHaveLength(3);
    expect(result.current[0].id).toBe('3'); // Importance 5
    expect(result.current[1].id).toBe('1'); // Importance 3
    expect(result.current[2].id).toBe('2'); // Importance 1
  });

  it('should sort by recency if importance is equal', () => {
    const sameImportance: Memory[] = [
      {
        id: '1',
        importance: 3,
        created_at: '2024-01-01T10:00:00Z',
        type: 'general',
        content: 'A',
        updated_at: '2024-01-01T10:00:00Z',
        metadata: {},
      },
      {
        id: '2',
        importance: 3,
        created_at: '2024-01-01T11:00:00Z',
        type: 'general',
        content: 'B',
        updated_at: '2024-01-01T11:00:00Z',
        metadata: {},
      },
    ];
    const { result } = renderHook(() => useMemoryFiltering(sameImportance));
    expect(result.current[0].id).toBe('2'); // More recent
    expect(result.current[1].id).toBe('1');
  });

  it('should filter by type', () => {
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, { types: ['npc'] }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].type).toBe('npc');
  });

  it('should filter by multiple types', () => {
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, { types: ['npc', 'location'] }));
    expect(result.current).toHaveLength(2);
    expect(result.current.map(m => m.type)).toContain('npc');
    expect(result.current.map(m => m.type)).toContain('location');
  });

  it('should filter by subcategory', () => {
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, { subcategories: ['description'] }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].subcategory).toBe('description');
  });

  it('should filter by tags', () => {
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, { tags: ['magic'] }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('1');
  });

  it('should filter by contextId', () => {
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, { contextId: 'ctx-1' }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('2');
  });

  it('should filter by minImportance', () => {
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, { minImportance: 4 }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('3'); // Importance 5
  });

  it('should filter by recent timeframe', () => {
    const now = Date.now();
    const recentMemory: Memory = {
      id: 'recent',
      importance: 1,
      created_at: new Date(now - 1000 * 60 * 30).toISOString(), // 30 mins ago
      type: 'general',
      content: 'Recent',
      updated_at: new Date(now - 1000 * 60 * 30).toISOString(),
      metadata: {},
    };
    const oldMemory: Memory = {
      id: 'old',
      importance: 1,
      created_at: new Date(now - 1000 * 60 * 120).toISOString(), // 2 hours ago
      type: 'general',
      content: 'Old',
      updated_at: new Date(now - 1000 * 60 * 120).toISOString(),
      metadata: {},
    };

    const { result } = renderHook(() => useMemoryFiltering([recentMemory, oldMemory], { timeframe: 'recent' }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('recent');
  });

  it('should sanitize invalid filter options', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // @ts-expect-error - testing runtime sanitization of invalid types
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, { types: ['invalid-type'] as any, subcategories: ['invalid-sub'] as any }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    // It should filter out invalid types/subcategories and return all since no valid filters left
    expect(result.current).toHaveLength(3);
  });

  it('should handle non-object options', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // @ts-expect-error - testing runtime handling of non-object options
    const { result } = renderHook(() => useMemoryFiltering(mockMemories, 'not-an-object' as any));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    expect(result.current).toHaveLength(3);
  });
});

describe('groupMemories', () => {
  const mockMemories: Memory[] = [
    {
      id: '1',
      type: 'npc',
      subcategory: 'npc_action',
      content: 'Eldrin cast a spell',
      importance: 3,
      created_at: '2024-01-01T10:00:00Z',
      updated_at: '2024-01-01T10:00:00Z',
      tags: ['magic', 'eldrin'],
      context_id: 'ctx-1',
      metadata: {},
    },
    {
      id: '2',
      type: 'location',
      subcategory: 'description',
      content: 'The tavern was smoky',
      importance: 1,
      created_at: '2024-01-01T09:00:00Z',
      updated_at: '2024-01-01T09:00:00Z',
      context_id: 'ctx-1',
      metadata: {},
    },
    {
      id: '3',
      type: 'npc',
      subcategory: 'general',
      content: 'Another NPC',
      importance: 2,
      created_at: '2024-01-01T08:00:00Z',
      updated_at: '2024-01-01T08:00:00Z',
      metadata: {},
    },
  ];

  it('should group by type', () => {
    const groups = groupMemories(mockMemories, 'type');
    expect(groups['npc']).toHaveLength(2);
    expect(groups['location']).toHaveLength(1);
  });

  it('should group by subcategory', () => {
    const groups = groupMemories(mockMemories, 'subcategory');
    expect(groups['npc_action']).toHaveLength(1);
    expect(groups['description']).toHaveLength(1);
    expect(groups['general']).toHaveLength(1);
  });

  it('should group by contextId', () => {
    const groups = groupMemories(mockMemories, 'contextId');
    expect(groups['ctx-1']).toHaveLength(2);
    expect(groups['none']).toHaveLength(1);
  });

  it('should group by tags', () => {
    const groups = groupMemories(mockMemories, 'tags');
    expect(groups['magic']).toHaveLength(1);
    expect(groups['eldrin']).toHaveLength(1);
    expect(Object.keys(groups)).toHaveLength(2);
  });
});
