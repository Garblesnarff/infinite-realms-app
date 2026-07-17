/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CampaignContextLoader } from '../campaign-context-loader';

import { userDataApi } from '@/services/user-data-api';

// CampaignContextLoader.loadCampaignContext() now fetches the campaign via
// userDataApi.getCampaign() (a real fetch() to the Bun server) instead of
// supabase.from('campaigns')...single() - see
// src/agents/services/campaign/campaign-context-loader.ts. The current source also no
// longer wraps errors (it rethrows userDataApi failures verbatim) or logs a "without
// userId validation" warning, so the mocks and assertions below were updated to match.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
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

    vi.mocked(userDataApi.getCampaign).mockResolvedValue(mockCampaignData);

    const result = await loader.loadCampaignContext(mockCampaignId, mockUserId);

    expect(userDataApi.getCampaign).toHaveBeenCalledWith(mockCampaignId);

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

    vi.mocked(userDataApi.getCampaign).mockResolvedValue(mockCampaignData);

    const result = await loader.loadCampaignContext(mockCampaignId);

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

    vi.mocked(userDataApi.getCampaign).mockResolvedValue(mockCampaignData);

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

    vi.mocked(userDataApi.getCampaign).mockResolvedValue(mockCampaignData);

    const result = await loader.loadCampaignContext(mockCampaignId);

    expect(result.thematicElements.importantNPCs).toEqual([]);
  });

  it('should handle non-object setting_details and thematic_elements', async () => {
    const mockCampaignData = {
      name: 'Test',
      setting_details: 'not-an-object',
      thematic_elements: 'not-an-object',
    };

    vi.mocked(userDataApi.getCampaign).mockResolvedValue(mockCampaignData);

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
    vi.mocked(userDataApi.getCampaign).mockResolvedValue(null);

    await expect(loader.loadCampaignContext(mockCampaignId)).rejects.toThrow(
      `Campaign with ID ${mockCampaignId} not found or access denied.`,
    );
  });

  // loadCampaignContext() no longer wraps userDataApi.getCampaign() failures with a
  // "Failed to load campaign context: ..." message or logs via logger.error - it just
  // rethrows verbatim (see src/agents/services/campaign/campaign-context-loader.ts,
  // which has no try/catch around the userDataApi.getCampaign() call).
  it('should throw error on database error', async () => {
    const mockError = new Error('Database connection failed');
    vi.mocked(userDataApi.getCampaign).mockRejectedValue(mockError);

    await expect(loader.loadCampaignContext(mockCampaignId)).rejects.toThrow(
      'Database connection failed',
    );
  });
});
