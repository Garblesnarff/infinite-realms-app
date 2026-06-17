/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LoreKeeperService, getLoreKeeperService } from '../LoreKeeperService';

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('LoreKeeperService', () => {
  let service: LoreKeeperService;
  const mockCampaignId = 'test-campaign-id';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LoreKeeperService('test-api-key');
  });

  describe('listCampaigns', () => {
    it('should list published and complete campaigns', async () => {
      const mockData = [{ id: '1', title: 'Campaign 1', genre: ['fantasy'] }];
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      const result = await service.listCampaigns();

      expect(supabase.from).toHaveBeenCalledWith('starter_campaigns');
      expect(mockQuery.eq).toHaveBeenCalledWith('is_published', true);
      expect(mockQuery.eq).toHaveBeenCalledWith('is_complete', true);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Campaign 1');
    });

    it('should apply filters correctly', async () => {
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      await service.listCampaigns({ genre: 'Fantasy', difficulty: 'Hard' });

      expect(mockQuery.contains).toHaveBeenCalledWith('genre', ['fantasy']);
      expect(mockQuery.eq).toHaveBeenCalledWith('difficulty', 'Hard');
    });

    it('should return empty array on error', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }),
      });

      const result = await service.listCampaigns();

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getCampaignOverview', () => {
    it('should return campaign data by id', async () => {
      const mockData = { id: mockCampaignId, title: 'Test Campaign', is_published: true, is_complete: true };
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const result = await service.getCampaignOverview(mockCampaignId);

      expect(result?.id).toBe(mockCampaignId);
      expect(result?.title).toBe('Test Campaign');
    });

    it('should return null if not found or error', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      });

      const result = await service.getCampaignOverview(mockCampaignId);
      expect(result).toBeNull();
    });
  });

  describe('Entity getters (NPC, Location, Faction)', () => {
    it('should get NPC by name', async () => {
      const mockData = { id: 'chunk-1', entity_name: 'Bob', chunk_type: 'npc_tier1' };
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const result = await service.getNPC(mockCampaignId, 'Bob');
      expect(result?.entityName).toBe('Bob');
    });

    it('should get Location by name', async () => {
      const mockData = { id: 'chunk-1', entity_name: 'Cave', chunk_type: 'location' };
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const result = await service.getLocation(mockCampaignId, 'Cave');
      expect(result?.chunkType).toBe('location');
    });

    it('should log non-PGRST116 errors', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'OTHER' } }),
      });

      await service.getNPC(mockCampaignId, 'Bob');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getMechanics, getRules, getSessionOutlines', () => {
    it('should get mechanics', async () => {
      const mockData = [{ id: '1', entity_name: 'Resting', chunk_type: 'mechanic' }];
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const result = await service.getMechanics(mockCampaignId);
      expect(result).toHaveLength(1);
      expect(result[0].entityName).toBe('Resting');
    });

    it('should get rules', async () => {
      const mockData = [{ id: '1', rule_type: 'mechanic', priority: 10 }];
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const result = await service.getRules(mockCampaignId);
      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe(10);
    });

    it('should get session outlines', async () => {
      const mockData = [{ id: '1', chunk_type: 'session_outline', sequence_order: 1 }];
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const result = await service.getSessionOutlines(mockCampaignId);
      expect(result).toHaveLength(1);
      expect(result[0].sequenceOrder).toBe(1);
    });

    it('should handle session outlines error', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'error' } }),
      });

      const result = await service.getSessionOutlines(mockCampaignId);
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getEntities', () => {
    it('should deduplicate and group entities by type', async () => {
      const mockData = [
        { id: '1', entity_name: 'NPC 1', chunk_type: 'npc_tier1' },
        { id: '2', entity_name: 'NPC 1', chunk_type: 'npc_tier1' }, // Duplicate name
        { id: '3', entity_name: 'Location 1', chunk_type: 'location' },
        { id: '4', entity_name: 'Faction 1', chunk_type: 'faction' },
        { id: '5', entity_name: 'Item 1', chunk_type: 'item' },
        { id: '6', entity_name: 'Monster 1', chunk_type: 'monster' },
      ];

      // Need a more robust chain for multiple orders
      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn(),
      };
      mockQuery.order.mockReturnValue(mockQuery);
      // For the final call in the chain, it should also be a promise or thenable
      mockQuery.then = (onResolve: any) => onResolve({ data: mockData, error: null });
      (supabase.from as any).mockReturnValue(mockQuery);

      const result = await service.getEntities(mockCampaignId);

      expect(result.npcs).toHaveLength(1); // One deduplicated
      expect(result.locations).toHaveLength(1);
      expect(result.factions).toHaveLength(1);
      expect(result.items).toHaveLength(1);
      expect(result.monsters).toHaveLength(1);
    });
  });

  describe('searchLore', () => {
    it('should return results from semantic search', async () => {
      // Mock global fetch for embedding generation
      const mockEmbedding = Array(768).fill(0.1);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ embedding: { values: mockEmbedding } }),
      });

      const mockData = [{ id: '1', entity_name: 'Match', similarity: 0.9 }];
      (supabase.rpc as any).mockResolvedValue({ data: mockData, error: null });

      const result = await service.searchLore(mockCampaignId, 'find something');

      expect(global.fetch).toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledWith('search_campaign_lore', expect.objectContaining({
        p_campaign_id: mockCampaignId,
        p_query_embedding: expect.stringContaining('0.1'),
      }));
      expect(result).toHaveLength(1);
      expect(result[0].similarity).toBe(0.9);
    });

    it('should return empty if no API key', async () => {
      const noKeyService = new LoreKeeperService('');
      const result = await noKeyService.searchLore(mockCampaignId, 'query');
      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle fetch failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('API Error'),
      });

      const result = await service.searchLore(mockCampaignId, 'query');
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle RPC failure', async () => {
      const mockEmbedding = Array(768).fill(0.1);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ embedding: { values: mockEmbedding } }),
      });

      (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: 'rpc error' } });

      const result = await service.searchLore(mockCampaignId, 'query');
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getCreativeDirection', () => {
    it('should return creative brief', async () => {
      const mockCampaign = { id: mockCampaignId, creative_brief: 'Be scary' };
      vi.spyOn(service, 'getCampaignOverview').mockResolvedValue(service['mapCampaignRow'](mockCampaign));

      const result = await service.getCreativeDirection(mockCampaignId);
      expect(result).toBe('Be scary');
    });

    it('should return null if campaign not found', async () => {
      vi.spyOn(service, 'getCampaignOverview').mockResolvedValue(null);
      const result = await service.getCreativeDirection(mockCampaignId);
      expect(result).toBeNull();
    });
  });

  describe('isStarterCampaignSession', () => {
    it('should return starter campaign info if present', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { starter_campaign_id: 'camp-1', campaign_version: 1 },
          error: null
        }),
      });

      const result = await service.isStarterCampaignSession('session-1');
      expect(result.isStarter).toBe(true);
      expect(result.campaignId).toBe('camp-1');
    });

    it('should return false if not a starter campaign session', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.isStarterCampaignSession('session-1');
      expect(result.isStarter).toBe(false);
    });
  });

  describe('getLoreKeeperService singleton', () => {
    it('should return a singleton instance', () => {
      const instance1 = getLoreKeeperService();
      const instance2 = getLoreKeeperService();
      expect(instance1).toBe(instance2);
    });
  });
});
