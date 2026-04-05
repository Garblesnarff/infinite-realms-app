/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { gameContextBuilder } from '../builder';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GameContextBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockParams = {
    campaignId: 'campaign-123',
    characterId: 'character-456',
    sessionId: 'session-789',
  };

  it('should build a complete game context when all data is available', async () => {
    const mockCampaign = {
      id: 'campaign-123',
      name: 'The Great Adventure',
      description: 'An epic quest',
      genre: 'Fantasy',
      status: 'active',
      era: 'Medieval',
      location: 'Faerûn',
      atmosphere: 'Mysterious',
      thematic_elements: { mainThemes: ['Magic', 'Betrayal'] },
    };

    const mockCharacter = {
      id: 'character-456',
      name: 'Eldrin',
      race: 'Elf',
      class: 'Wizard',
      level: 5,
      character_stats: [{
        current_hit_points: 35,
        max_hit_points: 35,
        armor_class: 12,
        strength: 8,
        dexterity: 14,
        constitution: 12,
        intelligence: 18,
        wisdom: 13,
        charisma: 10,
      }],
      character_equipment: [
        { item_name: 'Staff', item_type: 'weapon', equipped: true },
        { item_name: 'Robes', item_type: 'armor', equipped: true },
      ],
    };

    const mockMemories = [
      { id: 'm1', type: 'event', content: 'Met a mysterious stranger', importance: 5 },
      { id: 'm2', type: 'location', content: 'Found a hidden cave', importance: 3 },
      { id: 'm3', type: 'npc', content: 'Talked to the King', importance: 8 },
      { id: 'm4', type: 'plot_point', content: 'Found the ancient artifact', importance: 10 },
    ];

    // Setup Supabase chain mocks
    const fromSpy = vi.mocked(supabase.from);

    // Mock for campaigns
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
    } as any);

    // Mock for characters
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockCharacter, error: null }),
    } as any);

    // Mock for memories
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockMemories, error: null }),
    } as any);

    const context = await gameContextBuilder.build(mockParams);

    // Verify default fallbacks within compose()
    // Character Stats
    const mockCharacterNoStats = {
      id: 'char-no-stats',
      name: 'Statless',
      character_stats: null
    };
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'C' }, error: null }),
    } as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockCharacterNoStats, error: null }),
    } as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    const contextNoStats = await gameContextBuilder.build(mockParams);
    expect(contextNoStats.character?.stats.health.max).toBe(10);
    expect(contextNoStats.character?.stats.abilities.strength).toBe(10);

    // Campaign with missing fields
    const mockCampaignPartial = { name: 'Partial' };
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockCampaignPartial, error: null }),
    } as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    const contextPartial = await gameContextBuilder.build(mockParams);
    expect(contextPartial.campaign.setting.era).toBe('unknown');
    expect(contextPartial.campaign.basic.status).toBe('active');

    // Verify Campaign Mapping
    expect(context.campaign.basic.name).toBe('The Great Adventure');
    expect(context.campaign.setting.era).toBe('Medieval');
    expect(context.campaign.thematicElements.mainThemes).toContain('Magic');

    // Verify Character Mapping
    expect(context.character?.basic.name).toBe('Eldrin');
    expect(context.character?.stats.health.current).toBe(35);
    expect(context.character?.stats.abilities.intelligence).toBe(18);
    expect(context.character?.equipment).toHaveLength(2);

    // Verify Memory Mapping
    expect(context.memories.recent).toHaveLength(1);
    expect(context.memories.locations).toHaveLength(1);
    expect(context.memories.characters).toHaveLength(1);
    expect(context.memories.plot).toHaveLength(1);
  });

  it('should handle partial failures gracefully', async () => {
    // Setup Supabase chain mocks
    const fromSpy = vi.mocked(supabase.from);

    // Mock for campaigns - Success
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Campaign' }, error: null }),
    } as any);

    // Mock for characters - Failure (Rejected)
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('DB Error')),
    } as any);

    // Mock for memories - Success
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    const context = await gameContextBuilder.build(mockParams);

    expect(context.campaign.basic.name).toBe('Campaign');
    expect(context.character).toBeUndefined(); // Should be undefined due to rejected promise
    expect(context.memories.recent).toEqual([]);
  });

  it('should handle fetch level errors and return default context', async () => {
    // We want to trigger the catch block in the build() method.
    // However, build() uses Promise.allSettled, which doesn't reject if individual promises reject.
    // To trigger the catch block, we need to mock build()'s internal logic or some other failure.
    // Actually, looking at build(), the try-catch is around Promise.allSettled AND compose().
    // Compose is synchronous. If we make compose throw, it should hit the catch.

    // Alternatively, if one of the fetch methods throws directly (not returning a rejected promise),
    // but fetch methods are called within Promise.allSettled as well.

    // Wait, GameContextBuilder is exported as a singleton. We can't easily mock private methods.
    // Let's try to mock fetchCampaign to throw synchronously.

    const fromSpy = vi.mocked(supabase.from);
    fromSpy.mockImplementation(() => {
      throw new Error('Sync Error');
    });

    const context = await gameContextBuilder.build(mockParams);
    expect(context.campaign.basic.name).toBe('Unnamed Campaign');
  });

  it('should handle missing data gracefully', async () => {
    const fromSpy = vi.mocked(supabase.from);

    // Return null data (not found)
    fromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);

    const context = await gameContextBuilder.build(mockParams);

    expect(context.campaign.basic.name).toBe('Unnamed Campaign');
    expect(context.character).toBeUndefined();
    expect(context.memories.recent).toEqual([]);
  });
});
