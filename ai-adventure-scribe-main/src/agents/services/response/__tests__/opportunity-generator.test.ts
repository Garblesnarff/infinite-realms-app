/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '../../../../lib/logger';
import { OpportunityGenerator } from '../opportunity-generator';

import type { CampaignContext } from '@/types/dm';

import { supabase } from '@/integrations/supabase/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
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

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback) => callback({ data: mockQuests, error: null })),
    });

    const result = await generator.generateOpportunities('camp-123', mockContext);

    expect(result.questHooks).toEqual(['Find the Lost Ring', 'Clear the Goblins']);
    expect(result.nearby).toEqual(['Statue of Heroes', 'Old Library', 'The Fountain']);
    expect(result.immediate).toContain('Look around more closely.');
  });

  it('should handle quest fetching error', async () => {
    const mockError = { message: 'Database error' };

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback) => callback({ data: null, error: mockError })),
    });

    const result = await generator.generateOpportunities('camp-123', mockContext);

    expect(logger.error).toHaveBeenCalledWith('Error fetching quests:', mockError);
    expect(result.questHooks).toEqual([]);
  });

  it('should generate dangerous actions', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback) => callback({ data: [], error: null })),
    });

    const dangerousContext = {
      ...mockContext,
      setting: { atmosphere: 'Dangerous' },
    };

    const result = await generator.generateOpportunities('camp-123', dangerousContext as any);
    expect(result.immediate).toContain('Stay alert and watch for threats.');
  });

  it('should generate mysterious actions', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback) => callback({ data: [], error: null })),
    });

    const mysteriousContext = {
      ...mockContext,
      setting: { atmosphere: 'Mysterious' },
    };

    const result = await generator.generateOpportunities('camp-123', mysteriousContext as any);
    expect(result.immediate).toContain('Try to uncover a hidden detail.');
  });

  it('should generate tavern actions', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback) => callback({ data: [], error: null })),
    });

    const tavernContext = {
      ...mockContext,
      setting: { location: 'The Broken Barrel Tavern' },
    };

    const result = await generator.generateOpportunities('camp-123', tavernContext as any);
    expect(result.immediate).toContain('Listen to any nearby conversations.');
    expect(result.immediate).toContain('Ask the barkeep for rumors.');
  });

  it('should handle undefined thematic elements', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback) => callback({ data: [], error: null })),
    });

    const emptyContext: CampaignContext = { setting: { location: 'Nowhere' } } as any;

    const result = await generator.generateOpportunities('camp-123', emptyContext);
    expect(result.nearby).toEqual([]);
  });
});
