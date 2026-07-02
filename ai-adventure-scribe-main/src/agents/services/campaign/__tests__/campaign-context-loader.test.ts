/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CampaignContextLoader } from '../campaign-context-loader';

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('CampaignContextLoader', () => {
  let loader: CampaignContextLoader;
  const mockCampaignId = 'test-campaign-id';
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    loader = new CampaignContextLoader();
  });

  it('should successfully load a full campaign context', async () => {
    const mockCampaignData = {
      name: 'The Great Adventure',
      description: 'An epic journey',
      genre: 'High Fantasy',
      tone: 'Epic',
      setting_details: {
        era: 'Third Age',
        location: 'Middle-earth',
        atmosphere: 'Foreboding',
      },
      thematic_elements: {
        mainThemes: ['Heroism', 'Sacrifice'],
        recurringMotifs: ['Ancient runes'],
        keyLocations: ['Mount Doom'],
        importantNPCs: ['Gandalf'],
      },
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockCampaignData, error: null });
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    (supabase.from as any).mockReturnValue({ select: mockSelect });

    const result = await loader.loadCampaignContext(mockCampaignId, mockUserId);

    expect(supabase.from).toHaveBeenCalledWith('campaigns');
    expect(mockSelect).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', mockCampaignId);
    expect(mockEq).toHaveBeenCalledWith('user_id', mockUserId);

    expect(result).toEqual({
      id: mockCampaignId,
      name: 'The Great Adventure',
      description: 'An epic journey',
      genre: 'High Fantasy',
      tone: 'Epic',
      setting: {
        era: 'Third Age',
        location: 'Middle-earth',
        atmosphere: 'Foreboding',
      },
      thematicElements: {
        mainThemes: ['Heroism', 'Sacrifice'],
        recurringMotifs: ['Ancient runes'],
        keyLocations: ['Mount Doom'],
        importantNPCs: ['Gandalf'],
      },
    });
  });

  it('should load with default values when fields are missing', async () => {
    const mockCampaignData = {
      name: null,
      description: null,
      genre: null,
      tone: null,
      setting_details: null,
      thematic_elements: null,
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockCampaignData, error: null });
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    (supabase.from as any).mockReturnValue({ select: mockSelect });

    const result = await loader.loadCampaignContext(mockCampaignId);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('without userId validation'));

    expect(result).toEqual({
      id: mockCampaignId,
      name: 'Unnamed Campaign',
      description: '',
      genre: 'fantasy',
      tone: 'serious',
      setting: {
        era: 'medieval',
        location: 'unknown',
        atmosphere: 'mysterious',
      },
      thematicElements: {
        mainThemes: [],
        recurringMotifs: [],
        keyLocations: [],
        importantNPCs: [],
      },
    });
  });

  it('should handle malformed thematic_elements and setting_details with fallbacks', async () => {
    const mockCampaignData = {
      name: 'Test',
      setting_details: {
        era: '', // should fallback
        // location missing, should fallback
        atmosphere: null, // should fallback
      },
      thematic_elements: {
        mainThemes: 'not-an-array',
        recurringMotifs: [null, 'Valid Motif', ''],
        keyLocations: [123, 'Valid Location'],
        importantNPCs: [undefined, 'Valid NPC'],
      },
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockCampaignData, error: null });
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    (supabase.from as any).mockReturnValue({ select: mockSelect });

    const result = await loader.loadCampaignContext(mockCampaignId);

    expect(result.setting).toEqual({
      era: 'medieval',
      location: 'unknown',
      atmosphere: 'mysterious',
    });
    expect(result.thematicElements.mainThemes).toEqual([]);
    expect(result.thematicElements.recurringMotifs).toEqual(['Valid Motif']);
    expect(result.thematicElements.keyLocations).toEqual(['Valid Location']);
    expect(result.thematicElements.importantNPCs).toEqual(['Valid NPC']);
  });

  it('should handle thematic_elements with missing array fields', async () => {
    const mockCampaignData = {
      name: 'Test',
      thematic_elements: {
        // importantNPCs missing
      },
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockCampaignData, error: null });
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    (supabase.from as any).mockReturnValue({ select: mockSelect });

    const result = await loader.loadCampaignContext(mockCampaignId);

    expect(result.thematicElements.importantNPCs).toEqual([]);
  });

  it('should handle non-object setting_details and thematic_elements', async () => {
    const mockCampaignData = {
      name: 'Test',
      setting_details: 'not-an-object',
      thematic_elements: 'not-an-object',
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockCampaignData, error: null });
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    (supabase.from as any).mockReturnValue({ select: mockSelect });

    const result = await loader.loadCampaignContext(mockCampaignId);

    expect(result.setting).toEqual({
      era: 'medieval',
      location: 'unknown',
      atmosphere: 'mysterious',
    });
    expect(result.thematicElements).toEqual({
      mainThemes: [],
      recurringMotifs: [],
      keyLocations: [],
      importantNPCs: [],
    });
  });

  it('should throw error when campaign is not found', async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    (supabase.from as any).mockReturnValue({ select: mockSelect });

    await expect(loader.loadCampaignContext(mockCampaignId)).rejects.toThrow(
      `Campaign with ID ${mockCampaignId} not found or access denied.`,
    );
  });

  it('should throw error on database error', async () => {
    const mockError = { message: 'Database connection failed' };
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    (supabase.from as any).mockReturnValue({ select: mockSelect });

    await expect(loader.loadCampaignContext(mockCampaignId)).rejects.toThrow(
      'Failed to load campaign context: Database connection failed',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});
