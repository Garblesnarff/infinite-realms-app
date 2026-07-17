/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '../../../../lib/logger';
import { OpportunityGenerator } from '../opportunity-generator';

import type { CampaignContext } from '@/types/dm';

import { userDataApi } from '@/services/user-data-api';

// OpportunityGenerator now fetches quests via userDataApi.listQuests() (a real fetch()
// to the Bun server) instead of supabase.from('quests')... - see
// src/agents/services/response/opportunity-generator.ts. The mock target was updated
// to match.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listQuests: vi.fn(),
  },
}));

vi.mock('../../../../lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('OpportunityGenerator', () => {
  let generator: OpportunityGenerator;

  beforeEach(() => {
    generator = new OpportunityGenerator();
    vi.clearAllMocks();
  });

  const mockContext: CampaignContext = {
    setting: {
      location: 'City Square',
      atmosphere: 'peaceful',
    },
    thematicElements: {
      keyLocations: ['Statue of Heroes', 'Old Library', 'The Fountain', 'Market Stand'],
    },
  } as any;

  it('should generate opportunities with quests', async () => {
    const mockQuests = [
      { id: '1', title: 'Find the Lost Ring', status: 'available' },
      { id: '2', title: 'Clear the Goblins', status: 'available' },
    ];

    vi.mocked(userDataApi.listQuests).mockResolvedValue(mockQuests as any);

    const result = await generator.generateOpportunities('camp-123', mockContext);

    expect(result.questHooks).toEqual(['Find the Lost Ring', 'Clear the Goblins']);
    expect(result.nearby).toEqual(['Statue of Heroes', 'Old Library', 'The Fountain']);
    expect(result.immediate).toContain('Look around more closely.');
  });

  it('should handle quest fetching error', async () => {
    const mockError = { message: 'Database error' };

    vi.mocked(userDataApi.listQuests).mockRejectedValue(mockError);

    const result = await generator.generateOpportunities('camp-123', mockContext);

    expect(logger.error).toHaveBeenCalledWith('Error fetching quests:', mockError);
    expect(result.questHooks).toEqual([]);
  });

  it('should generate dangerous actions', async () => {
    vi.mocked(userDataApi.listQuests).mockResolvedValue([]);

    const dangerousContext = {
      ...mockContext,
      setting: { atmosphere: 'Dangerous' },
    };

    const result = await generator.generateOpportunities('camp-123', dangerousContext as any);
    expect(result.immediate).toContain('Stay alert and watch for threats.');
  });

  it('should generate mysterious actions', async () => {
    vi.mocked(userDataApi.listQuests).mockResolvedValue([]);

    const mysteriousContext = {
      ...mockContext,
      setting: { atmosphere: 'Mysterious' },
    };

    const result = await generator.generateOpportunities('camp-123', mysteriousContext as any);
    expect(result.immediate).toContain('Try to uncover a hidden detail.');
  });

  it('should generate tavern actions', async () => {
    vi.mocked(userDataApi.listQuests).mockResolvedValue([]);

    const tavernContext = {
      ...mockContext,
      setting: { location: 'The Broken Barrel Tavern' },
    };

    const result = await generator.generateOpportunities('camp-123', tavernContext as any);
    expect(result.immediate).toContain('Listen to any nearby conversations.');
    expect(result.immediate).toContain('Ask the barkeep for rumors.');
  });

  it('should handle undefined thematic elements', async () => {
    vi.mocked(userDataApi.listQuests).mockResolvedValue([]);

    const emptyContext: CampaignContext = { setting: { location: 'Nowhere' } } as any;

    const result = await generator.generateOpportunities('camp-123', emptyContext);
    expect(result.nearby).toEqual([]);
  });
});
