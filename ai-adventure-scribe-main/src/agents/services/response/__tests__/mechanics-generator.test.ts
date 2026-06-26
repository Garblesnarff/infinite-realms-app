/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '../../../../lib/logger';
import { MechanicsGenerator } from '../mechanics-generator';

import type { CampaignContext } from '@/types/dm';

// Mock logger
vi.mock('../../../../lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

// Mock supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/client';

describe('MechanicsGenerator', () => {
  let generator: MechanicsGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new MechanicsGenerator();
  });

  const mockContext: CampaignContext = {
    genre: 'fantasy',
    tone: 'serious',
    setting: {
      era: 'medieval',
      location: 'village',
      atmosphere: 'peaceful',
    },
    thematicElements: {
      mainThemes: [],
      recurringMotifs: [],
      keyLocations: [],
      importantNPCs: [],
    },
  };

  it('should generate basic mechanics with rules', async () => {
    const mockRules = [{ rule_description: 'Rule 1' }, { rule_description: 'Rule 2' }];
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockRules, error: null }),
    });

    const result = await generator.generateMechanics(mockContext);

    expect(result.availableActions).toEqual(['Move', 'Interact', 'Attack', 'Cast Spell']);
    expect(result.relevantRules).toEqual(['Rule 1', 'Rule 2']);
    expect(result.suggestions).toEqual(["Consider your character's goals and surroundings."]);
  });

  it('should handle error fetching rules', async () => {
    const dbError = new Error('DB Error');
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: dbError }),
    });

    const result = await generator.generateMechanics(mockContext);

    expect(result.relevantRules).toEqual(['Error fetching rules.']);
    expect(logger.error).toHaveBeenCalledWith('Error fetching rules for context:', dbError);
  });

  it('should return default message if no rules found', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await generator.generateMechanics(mockContext);

    expect(result.relevantRules).toEqual(['No specific rules highlighted currently.']);
  });

  it('should return default message if rules is null', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const result = await generator.generateMechanics(mockContext);

    expect(result.relevantRules).toEqual(['No specific rules highlighted currently.']);
  });

  it('should provide suggestions for Mystery genre', async () => {
    const mysteryContext: CampaignContext = {
      ...mockContext,
      genre: 'Mystery',
    };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await generator.generateMechanics(mysteryContext);
    expect(result.suggestions).toContain('Search for hidden clues or inconsistencies.');
    expect(result.suggestions).toContain('Interrogate a suspicious character.');
  });

  it('should provide suggestions for Humorous tone', async () => {
    const humorousContext: CampaignContext = {
      ...mockContext,
      tone: 'Humorous',
    };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await generator.generateMechanics(humorousContext);
    expect(result.suggestions).toContain('Try something unexpected or comical.');
    expect(result.suggestions).toContain('Engage in witty banter.');
  });

  it('should provide suggestions for Tense atmosphere', async () => {
    const tenseContext: CampaignContext = {
      ...mockContext,
      setting: {
        ...mockContext.setting,
        atmosphere: 'Tense and ominous',
      },
    };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await generator.generateMechanics(tenseContext);
    expect(result.suggestions).toContain('Be cautious and observant.');
  });
});
