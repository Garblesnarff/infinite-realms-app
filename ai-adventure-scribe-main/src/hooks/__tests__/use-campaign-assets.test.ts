/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
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

import { useCampaignAssets } from '../use-campaign-assets';

import { supabase } from '@/integrations/supabase/client';


describe('useCampaignAssets', () => {
  const mockCampaignId = 'test-campaign-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty assets if no campaignId is provided', () => {
    const { result } = renderHook(() => useCampaignAssets(null));

    expect(result.current.assets).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('should load assets successfully from all sources and parallelize calls', async () => {
    const mockCharacters = [
      {
        template_key: 'hero-1',
        name: 'Test Hero',
        tagline: 'A brave warrior',
        portrait_url: 'http://example.com/hero.jpg',
      },
      {
        template_key: null, // Test fallback to generateKey (line 108)
        name: 'No Key Hero',
        portrait_url: 'http://example.com/nokey.jpg',
      }
    ];

    const mockChunks = [
      {
        entity_name: 'Friendly NPC',
        chunk_type: 'npc_helper',
        metadata: {
          image_url: 'http://example.com/npc.jpg',
          description: 'A helpful villager',
        },
      },
      {
        entity_name: 'Dungeon Entrance',
        chunk_type: 'location',
        metadata: {
          image_url: 'http://example.com/location.jpg',
        },
      },
      {
        entity_name: 'Sword of Destiny',
        chunk_type: 'item',
        metadata: {
          image_url: 'http://example.com/sword.jpg',
        },
      },
      {
        entity_name: 'Dragon',
        chunk_type: 'monster',
        metadata: {
          image_url: 'http://example.com/dragon.jpg',
        },
      },
      {
        entity_name: 'Ambush',
        chunk_type: 'encounter',
        metadata: {
          image_url: 'http://example.com/ambush.jpg',
        },
      },
      {
        entity_name: 'Unknown',
        chunk_type: 'unknown_type', // Should be skipped (line 140)
        metadata: {
          image_url: 'http://example.com/unknown.jpg',
        },
      },
    ];

    const mockCampaign = {
      title: 'Epic Adventure',
      cover_image_url: 'http://example.com/cover.jpg',
      banner_image_url: 'http://example.com/banner.jpg',
    };

    const mockFromSpy = vi.spyOn(supabase, 'from');

    (mockFromSpy as any).mockImplementation((table: string) => {
      if (table === 'starter_character_templates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
        };
      }
      if (table === 'campaign_chunks') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ data: mockChunks, error: null }),
        };
      }
      if (table === 'starter_campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const { result } = renderHook(() => useCampaignAssets(mockCampaignId));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Verify all tables were called
    expect(supabase.from).toHaveBeenCalledWith('starter_character_templates');
    expect(supabase.from).toHaveBeenCalledWith('campaign_chunks');
    expect(supabase.from).toHaveBeenCalledWith('starter_campaigns');

    expect(result.current.assets).toHaveLength(9); // 2 char, 5 chunks, 2 scene (cover + banner). Unknown skipped.

    // Check type mapping for chunks
    expect(result.current.getAsset('npc', 'friendly-npc')).not.toBeNull();
    expect(result.current.getAsset('location', 'dungeon-entrance')).not.toBeNull();
    expect(result.current.getAsset('item', 'sword-of-destiny')).not.toBeNull();
    expect(result.current.getAsset('monster', 'dragon')).not.toBeNull();
    expect(result.current.getAsset('monster', 'ambush')).not.toBeNull(); // encounter maps to monster

    // Check fallback key (line 108)
    const noKeyHero = result.current.getAsset('character', 'no-key-hero');
    expect(noKeyHero).not.toBeNull();
    expect(noKeyHero?.name).toBe('No Key Hero');
  });

  it('should handle special characters and normalization in key generation', async () => {
    const mockChunks = [
      {
        entity_name: 'O\'Malley"s «Pub» & Grill -- The Best!',
        chunk_type: 'location',
        metadata: {
          image_url: 'http://example.com/pub.jpg',
        },
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'campaign_chunks') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ data: mockChunks, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        not: vi.fn().mockReturnThis(),
      };
    });

    const { result } = renderHook(() => useCampaignAssets(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const normalizedKey = 'omalleys-pub-grill-the-best';
    const pub = result.current.getAsset('location', normalizedKey);
    expect(pub).not.toBeNull();
    expect(pub?.name).toBe('O\'Malley"s «Pub» & Grill -- The Best!');

    // Test lookup by unnormalized name
    const pubByName = result.current.getAsset('location', 'O\'Malley"s «Pub» & Grill -- The Best!');
    expect(pubByName).toEqual(pub);
  });

  it('should generate correctly formatted and grouped asset list for AI prompt', async () => {
    const mockCharacters = [
      { template_key: 'hero', name: 'Test Hero', portrait_url: 'url' },
    ];
    const mockChunks = [
      { entity_name: 'Shop', chunk_type: 'location', metadata: { image_url: 'url' } },
      { entity_name: 'Orc', chunk_type: 'monster', metadata: { image_url: 'url' } },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'starter_character_templates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
        };
      }
      if (table === 'campaign_chunks') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ data: mockChunks, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        not: vi.fn().mockReturnThis(),
      };
    });

    const { result } = renderHook(() => useCampaignAssets(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const prompt = result.current.assetListForPrompt;
    expect(prompt).toContain('## Available Visual Assets');

    // Check grouping
    expect(prompt).toContain('### Characters');
    expect(prompt).toContain('- Test Hero [ASSET:character:hero]');

    expect(prompt).toContain('### Locations');
    expect(prompt).toContain('- Shop [ASSET:location:shop]');

    expect(prompt).toContain('### Monsters');
    expect(prompt).toContain('- Orc [ASSET:monster:orc]');
  });

  it('should handle mixed successful and failed requests', async () => {
    const mockFromSpy = vi.spyOn(supabase, 'from');

    (mockFromSpy as any).mockImplementation((table: string) => {
      if (table === 'starter_character_templates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: { message: 'Char failed' } }),
        };
      }
      if (table === 'campaign_chunks') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ data: [], error: { message: 'Chunks failed' } }),
        };
      }
      if (table === 'starter_campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Campaign failed' } }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
      };
    });

    const { result } = renderHook(() => useCampaignAssets(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.assets).toEqual([]);
    expect(result.current.error).toBeNull(); // Hook doesn't set error on partial failures
  });

  it('should handle global failure in loadAssets', async () => {
    // Force a generic error in the try block
    (supabase.from as any).mockImplementation(() => {
      throw new Error('Global crash');
    });

    const { result } = renderHook(() => useCampaignAssets(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).not.toBeNull();
    // Test fallback error message (line 185)
    (supabase.from as any).mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'Not an error object';
    });

    const { result: result2 } = renderHook(() => useCampaignAssets('new-campaign'));
    await waitFor(() => expect(result2.current.isLoading).toBe(false));
    expect(result2.current.error?.message).toBe('Failed to load campaign assets');
  });

  it('should correctly provide image URL via getAssetImageUrl', async () => {
    const mockCharacters = [
      {
        template_key: 'hero-1',
        name: 'Test Hero',
        portrait_url: 'http://example.com/hero.jpg',
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'starter_character_templates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        not: vi.fn().mockReturnThis(),
      };
    });

    const { result } = renderHook(() => useCampaignAssets(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Call getAssetImageUrl and verify coverage
    const url = result.current.getAssetImageUrl('character', 'hero-1');
    expect(url).toBe('http://example.com/hero.jpg');

    const nullUrl = result.current.getAssetImageUrl('character', 'non-existent');
    expect(nullUrl).toBeNull();
  });
});
