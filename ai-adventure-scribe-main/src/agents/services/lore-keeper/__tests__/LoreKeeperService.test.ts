/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LoreKeeperService, getLoreKeeperService } from '../LoreKeeperService';

import { supabase } from '@/integrations/supabase/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } } }) },
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

  describe('getCampaignOverview', () => {
    it('should return campaign data by id', async () => {
      const mockData = {
        id: mockCampaignId,
        title: 'Test Campaign',
        is_published: true,
        is_complete: true,
      };
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

  describe('getRules', () => {
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

  describe('getLoreKeeperService singleton', () => {
    it('should return a singleton instance', () => {
      const instance1 = getLoreKeeperService();
      const instance2 = getLoreKeeperService();
      expect(instance1).toBe(instance2);
    });
  });
});
