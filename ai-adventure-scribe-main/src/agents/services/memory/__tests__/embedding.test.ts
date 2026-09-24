import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MemoryImportanceService } from '../MemoryImportanceService';
import { MemoryRepository } from '../MemoryRepository';
import { MemoryService } from '../MemoryService';

// This file used to test the browser's embedding generator: MemoryRepository.invokeEmbedding()
// calling supabase.functions.invoke('generate-embedding'), gated on
// isSemanticMemoriesEnabled(). #1822 established that the gate was off in production for the
// entire life of the memories table — 4530 rows, 0 embeddings — and that the generator
// swallowed errors (`if (error) return null`), so even switching the flag on would have
// produced nulls indistinguishable from successes. That code is gone: the server embeds a
// memory after inserting it (server-bun MemoryService.insert -> attachEmbedding).
//
// What is worth testing here now is the absence: the client memory write path must send bare
// content and must not reach for an embedding of its own.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createMemories: vi.fn(async () => []),
    listMemories: vi.fn(async () => []),
    matchMemories: vi.fn(async () => []),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/memory/importance', () => ({
  calculateImportance: vi.fn(() => 3),
}));

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    submitMemoryExtraction: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocking
import { supabase } from '@/integrations/supabase/client';
import { userDataApi } from '@/services/user-data-api';

describe('Client memory writes carry no embedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes no embedding generator on the repository', () => {
    expect(
      (new MemoryRepository() as unknown as Record<string, unknown>).invokeEmbedding,
    ).toBeUndefined();
  });

  it('scores importance without producing an embedding', () => {
    const result = new MemoryImportanceService().evaluate(
      'The knight drew her sword',
      'event',
      'general',
    );

    expect(result).toEqual({ importance: 3 });
    expect('embedding' in result).toBe(false);
  });

  it('sends content only, and calls no edge function, when saving memories', async () => {
    await MemoryService.saveMemories([
      {
        session_id: 'session-123',
        type: 'quest',
        content: 'The party swore to find the Dragon Scroll.',
        importance: 4,
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ] as never);

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(userDataApi.createMemories).toHaveBeenCalledTimes(1);

    const records = vi.mocked(userDataApi.createMemories).mock.calls[0]![0];
    expect(records[0]).not.toHaveProperty('embedding');
    expect(records[0]).toMatchObject({ content: 'The party swore to find the Dragon Scroll.' });
  });

  it('does not embed the query when recalling memories', async () => {
    vi.mocked(userDataApi.listMemories).mockResolvedValue([]);

    await MemoryService.getRelevantMemories('session-123', 'where is the scroll?', 5);

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(userDataApi.matchMemories).not.toHaveBeenCalled();
    expect(userDataApi.listMemories).toHaveBeenCalledWith('session-123', { limit: 5, top: true });
  });
});
