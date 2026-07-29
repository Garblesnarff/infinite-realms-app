/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WorldBuilderRepository } from '../world-builder-repository';

import { userDataApi } from '@/services/user-data-api';

// Declare hoisted mocks
const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mockFrom,
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
    listQuests: vi.fn(),
    upsertQuest: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WorldBuilderRepository', () => {
  const campaignId = 'camp-123';
  const userId = 'user-456';

  // Helper to create a chainable mock thenable
  function createMockChain(resolveValue: any): any {
    const chain: any = {
      select: vi.fn().mockImplementation(() => chain),
      eq: vi.fn().mockImplementation(() => chain),
      ilike: vi.fn().mockImplementation(() => chain),
      limit: vi.fn().mockImplementation(() => chain),
      insert: vi.fn().mockImplementation(() => Promise.resolve(resolveValue)),
      then: vi.fn().mockImplementation((onfulfilled) => {
        return Promise.resolve(onfulfilled(resolveValue));
      }),
    };
    return chain;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateUserCampaignAccess', () => {
    it('should return false if userId is not provided', async () => {
      const result = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, '');
      expect(result).toBe(false);
    });

    it('should return false if campaign is not found', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue(null);
      const result = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, userId);
      expect(result).toBe(false);
      expect(userDataApi.getCampaign).toHaveBeenCalledWith(campaignId);
    });

    it('should return false if campaign owner does not match caller user id', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({
        id: campaignId,
        user_id: 'mismatched-user',
      } as any);

      const result = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, userId);
      expect(result).toBe(false);
    });

    it('should handle different property casings for owner ID (user_id)', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({
        id: campaignId,
        user_id: userId,
      } as any);

      const result = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, userId);
      expect(result).toBe(true);
    });

    it('should handle different casings for owner ID (userId)', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({
        id: campaignId,
        userId: userId,
      } as any);

      const result = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, userId);
      expect(result).toBe(true);
    });

    it('should return false and catch error if userDataApi throws an exception', async () => {
      vi.mocked(userDataApi.getCampaign).mockRejectedValue(new Error('API failure'));
      const result = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, userId);
      expect(result).toBe(false);
    });
  });

  describe('getWorldStats', () => {
    it('should return default zero stats if user campaign access is denied', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue(null);
      const stats = await WorldBuilderRepository.getWorldStats(campaignId, userId);
      expect(stats).toEqual({ locations: 0, npcs: 0, quests: 0, totalElements: 0 });
    });

    it('should aggregate stats correctly if user campaign access is valid', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);
      vi.mocked(userDataApi.listQuests).mockResolvedValue([
        { id: 'q1' },
        { id: 'q2' },
      ] as any);

      mockFrom.mockImplementation((table: string) => {
        if (table === 'locations') {
          return createMockChain({ data: [{ id: 'loc-1' }, { id: 'loc-2' }, { id: 'loc-3' }], error: null });
        }
        if (table === 'npcs') {
          return createMockChain({ data: [{ id: 'npc-1' }], error: null });
        }
        return createMockChain({ data: [], error: null });
      });

      const stats = await WorldBuilderRepository.getWorldStats(campaignId, userId);

      expect(stats).toEqual({
        locations: 3,
        npcs: 1,
        quests: 2,
        totalElements: 6,
      });
      expect(mockFrom).toHaveBeenCalledWith('locations');
      expect(mockFrom).toHaveBeenCalledWith('npcs');
      expect(userDataApi.listQuests).toHaveBeenCalledWith(campaignId);
    });

    it('should return default zero stats on exceptions', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);
      mockFrom.mockImplementation(() => {
        throw new Error('Supabase fail');
      });

      const stats = await WorldBuilderRepository.getWorldStats(campaignId, userId);
      expect(stats).toEqual({ locations: 0, npcs: 0, quests: 0, totalElements: 0 });
    });
  });

  describe('saveNPCFromXML', () => {
    const mockNpc = {
      name: 'Eldrin',
      description: 'An ancient elf mage.',
      location: 'Mage Tower',
    };

    it('should return false if user campaign access is denied', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue(null);
      const result = await WorldBuilderRepository.saveNPCFromXML(campaignId, 'sess-1', mockNpc, userId);
      expect(result).toBe(false);
    });

    it('should skip insertion and return true if NPC already exists', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);

      mockFrom.mockReturnValue(createMockChain({ data: [{ id: 'existing-npc' }], error: null }));

      const result = await WorldBuilderRepository.saveNPCFromXML(campaignId, 'sess-1', mockNpc, userId);

      expect(result).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('npcs');
    });

    it('should insert NPC and return true if NPC does not exist', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);

      // First call is query, returns empty data. Second call is insert.
      mockFrom.mockReturnValueOnce(createMockChain({ data: [], error: null }))
              .mockReturnValueOnce(createMockChain({ error: null }));

      const result = await WorldBuilderRepository.saveNPCFromXML(campaignId, 'sess-1', mockNpc, userId);

      expect(result).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('npcs');
    });

    it('should return false if insert fails', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);

      mockFrom.mockReturnValueOnce(createMockChain({ data: [], error: null }))
              .mockReturnValueOnce(createMockChain({ error: new Error('Insert fail') }));

      const result = await WorldBuilderRepository.saveNPCFromXML(campaignId, 'sess-1', mockNpc, userId);
      expect(result).toBe(false);
    });

    it('should return false and catch error on exceptions', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);
      mockFrom.mockImplementation(() => {
        throw new Error('Unexpected crash');
      });

      const result = await WorldBuilderRepository.saveNPCFromXML(campaignId, 'sess-1', mockNpc, userId);
      expect(result).toBe(false);
    });
  });

  describe('saveLocationFromXML', () => {
    const mockLocation = {
      name: 'Neverwinter',
      description: 'A bustling city.',
    };

    it('should return false if user campaign access is denied', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue(null);
      const result = await WorldBuilderRepository.saveLocationFromXML(campaignId, 'sess-1', mockLocation, userId);
      expect(result).toBe(false);
    });

    it('should skip insertion and return true if location already exists', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);

      mockFrom.mockReturnValue(createMockChain({ data: [{ id: 'existing-loc' }], error: null }));

      const result = await WorldBuilderRepository.saveLocationFromXML(campaignId, 'sess-1', mockLocation, userId);

      expect(result).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('locations');
    });

    it('should insert location and return true if location does not exist', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);

      mockFrom.mockReturnValueOnce(createMockChain({ data: [], error: null }))
              .mockReturnValueOnce(createMockChain({ error: null }));

      const result = await WorldBuilderRepository.saveLocationFromXML(campaignId, 'sess-1', mockLocation, userId);

      expect(result).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('locations');
    });

    it('should return false if insert fails', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);

      mockFrom.mockReturnValueOnce(createMockChain({ data: [], error: null }))
              .mockReturnValueOnce(createMockChain({ error: new Error('Insert fail') }));

      const result = await WorldBuilderRepository.saveLocationFromXML(campaignId, 'sess-1', mockLocation, userId);
      expect(result).toBe(false);
    });

    it('should return false and catch error on exceptions', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);
      mockFrom.mockImplementation(() => {
        throw new Error('Unexpected crash');
      });

      const result = await WorldBuilderRepository.saveLocationFromXML(campaignId, 'sess-1', mockLocation, userId);
      expect(result).toBe(false);
    });
  });

  describe('saveQuestFromXML', () => {
    const mockQuest = {
      name: 'Retrieve the Goblet',
      update: 'Find and bring back the ancient goblet from the cave.',
    };

    it('should return false if user campaign access is denied', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue(null);
      const result = await WorldBuilderRepository.saveQuestFromXML(campaignId, 'sess-1', mockQuest, userId);
      expect(result).toBe(false);
    });

    it('should call upsertQuest and return true if campaign access is valid', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);
      vi.mocked(userDataApi.upsertQuest).mockResolvedValue({} as any);

      const result = await WorldBuilderRepository.saveQuestFromXML(campaignId, 'sess-1', mockQuest, userId);

      expect(result).toBe(true);
      expect(userDataApi.upsertQuest).toHaveBeenCalledWith({
        campaign_id: campaignId,
        title: mockQuest.name,
        description: mockQuest.update,
        status: 'active',
        quest_type: 'side',
      });
    });

    it('should return false and catch error on exceptions', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({ id: campaignId, user_id: userId } as any);
      vi.mocked(userDataApi.upsertQuest).mockRejectedValue(new Error('Upsert fail'));

      const result = await WorldBuilderRepository.saveQuestFromXML(campaignId, 'sess-1', mockQuest, userId);
      expect(result).toBe(false);
    });
  });
});
