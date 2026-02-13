/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  getSessionPartyLevel,
  getCampaignPartyLevel,
  getContentDifficultyLevel,
  getAveragePartyLevel,
} from '../character-level-utils';

import { supabase } from '@/integrations/supabase/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('character-level-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSessionPartyLevel', () => {
    it('should return party level for a valid session', async () => {
      const mockSession = { campaign_id: 'campaign-123' };
      const mockCharacters = [
        { characters: { id: 'char-1', name: 'Hero 1', level: 5, class: 'Fighter' } },
        { characters: { id: 'char-2', name: 'Hero 2', level: 3, class: 'Wizard' } },
      ];

      const fromSpy = vi.mocked(supabase.from);

      // Mock session lookup
      fromSpy.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      } as any);

      // Mock campaign characters lookup
      fromSpy.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
      } as any);

      const result = await getSessionPartyLevel('session-123');

      expect(result.averageLevel).toBe(4);
      expect(result.minLevel).toBe(3);
      expect(result.maxLevel).toBe(5);
      expect(result.partySize).toBe(2);
      expect(result.characters).toHaveLength(2);
      expect(result.characters[0].name).toBe('Hero 1');
    });

    it('should return default party level if session is not found', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      } as any);

      const result = await getSessionPartyLevel('invalid-session');

      expect(result.averageLevel).toBe(3);
      expect(result.partySize).toBe(4);
      expect(result.characters).toHaveLength(0);
    });

    it('should handle exceptions and return default party level', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const result = await getSessionPartyLevel('session-123');

      expect(result.averageLevel).toBe(3);
      expect(result.partySize).toBe(4);
    });
  });

  describe('getCampaignPartyLevel', () => {
    it('should calculate party info correctly', async () => {
      const mockCharacters = [
        { characters: { id: 'char-1', name: 'Hero 1', level: 10, class: 'Paladin' } },
        { characters: { id: 'char-2', name: 'Hero 2', level: 12, class: 'Cleric' } },
        { characters: { id: 'char-3', name: 'Hero 3', level: 8, class: 'Rogue' } },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
      } as any);

      const result = await getCampaignPartyLevel('campaign-123');

      expect(result.averageLevel).toBe(10);
      expect(result.minLevel).toBe(8);
      expect(result.maxLevel).toBe(12);
      expect(result.partySize).toBe(3);
    });

    it('should filter out invalid characters', async () => {
      const mockCharacters = [
        { characters: { id: 'char-1', name: 'Hero 1', level: 5 } },
        { characters: null }, // Null character
        { characters: { id: 'char-2', name: 'Hero 2', level: 0 } }, // Zero level
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
      } as any);

      const result = await getCampaignPartyLevel('campaign-123');

      expect(result.partySize).toBe(1);
      expect(result.averageLevel).toBe(5);
    });

    it('should return default if all characters are filtered out', async () => {
      const mockCharacters = [
        { characters: { id: 'char-1', name: 'Hero 1', level: 0 } },
        { characters: null },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
      } as any);

      const result = await getCampaignPartyLevel('campaign-123');

      expect(result.averageLevel).toBe(3);
      expect(result.partySize).toBe(4); // Default party size
    });

    it('should return default if no valid characters found', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      } as any);

      const result = await getCampaignPartyLevel('campaign-empty');

      expect(result.averageLevel).toBe(3);
    });

    it('should handle database error by returning default level', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database error' } }),
      } as any);

      const result = await getCampaignPartyLevel('campaign-123');

      expect(result.averageLevel).toBe(3);
    });

    it('should handle exceptions and return default party level', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const result = await getCampaignPartyLevel('campaign-123');

      expect(result.averageLevel).toBe(3);
    });
  });

  describe('getContentDifficultyLevel', () => {
    it('should return easy for levels 1-2', () => {
      const result1 = getContentDifficultyLevel({ averageLevel: 1 } as any);
      expect(result1.difficulty).toBe('easy');

      const result2 = getContentDifficultyLevel({ averageLevel: 2 } as any);
      expect(result2.difficulty).toBe('easy');
    });

    it('should return moderate for levels 3-10', () => {
      const result3 = getContentDifficultyLevel({ averageLevel: 3 } as any);
      expect(result3.difficulty).toBe('moderate');

      const result5 = getContentDifficultyLevel({ averageLevel: 5 } as any);
      expect(result5.difficulty).toBe('moderate');

      const result10 = getContentDifficultyLevel({ averageLevel: 10 } as any);
      expect(result10.difficulty).toBe('moderate');
    });

    it('should return hard for levels 11-15', () => {
      const result11 = getContentDifficultyLevel({ averageLevel: 11 } as any);
      expect(result11.difficulty).toBe('hard');

      const result15 = getContentDifficultyLevel({ averageLevel: 15 } as any);
      expect(result15.difficulty).toBe('hard');
    });

    it('should return deadly for levels 16+', () => {
      const result16 = getContentDifficultyLevel({ averageLevel: 16 } as any);
      expect(result16.difficulty).toBe('deadly');

      const result20 = getContentDifficultyLevel({ averageLevel: 20 } as any);
      expect(result20.difficulty).toBe('deadly');
    });
  });

  describe('getAveragePartyLevel', () => {
    it('should work with sessionId', async () => {
      const mockSession = { campaign_id: 'campaign-123' };
      const mockCharacters = [
        { characters: { id: 'char-1', name: 'Hero 1', level: 6 } },
      ];

      const fromSpy = vi.mocked(supabase.from);
      fromSpy.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      } as any);

      fromSpy.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
      } as any);

      const level = await getAveragePartyLevel(undefined, 'session-123');
      expect(level).toBe(6);
    });

    it('should work with campaignId', async () => {
      const mockCharacters = [
        { characters: { id: 'char-1', name: 'Hero 1', level: 4 } },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockCharacters, error: null }),
      } as any);

      const level = await getAveragePartyLevel('campaign-123');
      expect(level).toBe(4);
    });

    it('should return default level if no IDs provided', async () => {
      const level = await getAveragePartyLevel();
      expect(level).toBe(3);
    });

    it('should handle exceptions and return default level', async () => {
      // Force getSessionPartyLevel to throw by mocking supabase.from to throw
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const level = await getAveragePartyLevel(undefined, 'session-123');
      expect(level).toBe(3);
    });
  });
});
