/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LocationGenerator } from '../location-generator';
import { calculateNarrativeWeight } from '../location-prompts';
import { WorldBuildingAnalyzer } from '../world-building-analyzer';

import { llmApiClient } from '@/infrastructure/api';
import { supabase } from '@/integrations/supabase/client';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/character-level-utils', () => ({
  getAveragePartyLevel: vi.fn(),
}));

describe('LocationGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateLocation', () => {
    const mockRequest: any = {
      type: 'dungeon',
      size: 'medium',
      context: {
        campaignId: 'campaign-123',
        genre: 'fantasy',
        currentStory: 'Looking for a lost sword',
      },
    };

    const mockLocationData = {
      name: 'Crystal Caves',
      description: 'A glowing dungeon.',
      type: 'dungeon',
      atmosphere: 'mysterious',
      sizeCategory: 'medium',
      keyFeatures: ['Glow crystals'],
      inhabitants: ['Bats'],
      threats: ['Darkness'],
      treasures: ['Sword'],
      secrets: ['Hidden door'],
      connections: [],
      lore: 'Ancient caves.',
      narrativeHooks: ['Hook 1'],
      sensoryDetails: { sights: [], sounds: [], smells: [], atmosphere: '' },
      mechanics: { skillChallenges: [], hiddenElements: [], interactiveFeatures: [] },
    };

    it('should generate a location successfully', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue(`Here is your JSON: ${JSON.stringify(mockLocationData)}`);

      const result = await LocationGenerator.generateLocation(mockRequest);

      expect(result.name).toBe('Crystal Caves');
      expect(result.metadata.campaignId).toBe('campaign-123');
      expect(result.metadata.storyArc).toBe('Looking for a lost sword');
      expect(result.metadata.createdAt).toBeInstanceOf(Date);
      expect(result.metadata.narrativeWeight).toBeGreaterThanOrEqual(5);
    });

    it('should throw error if no JSON is found', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue('No JSON here');

      await expect(LocationGenerator.generateLocation(mockRequest)).rejects.toThrow('No JSON found');
    });

    it('should throw error if JSON is invalid', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue('{ invalid json }');

      await expect(LocationGenerator.generateLocation(mockRequest)).rejects.toThrow('Invalid response format');
    });
  });

  describe('calculateNarrativeWeight', () => {
    it('should calculate base weight of 5', () => {
      const weight = calculateNarrativeWeight({}, { context: {} } as any);
      expect(weight).toBe(5);
    });

    it('should add weight for various factors', () => {
      const location = {
        type: 'dungeon',
        narrativeHooks: ['h1', 'h2', 'h3'],
        secrets: ['s1', 's2', 's3'],
      };
      const request: any = {
        atmosphere: 'dangerous',
        context: { currentStory: 'Active' },
      };

      const weight = calculateNarrativeWeight(location, request);
      // 5 (base) + 2 (story + hooks) + 1 (secrets) + 1 (dungeon) + 1 (dangerous) = 10
      expect(weight).toBe(10);
    });

    it('should cap weight at 10', () => {
      const location = {
        type: 'landmark',
        narrativeHooks: ['h1', 'h2', 'h3', 'h4'],
        secrets: ['s1', 's2', 's3', 's4'],
      };
      const request: any = {
        atmosphere: 'sacred',
        context: { currentStory: 'Critical' },
      };

      const weight = calculateNarrativeWeight(location, request);
      expect(weight).toBe(10);
    });
  });

  describe('saveLocation', () => {
    it('should save location successfully', async () => {
      const mockLocation: any = {
        name: 'The Keep',
        type: 'building',
        metadata: { createdAt: new Date(), campaignId: 'c1' },
      };

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'loc-123' }, error: null }),
      } as any);

      const id = await LocationGenerator.saveLocation(mockLocation);
      expect(id).toBe('loc-123');
      expect(mockFrom).toHaveBeenCalledWith('locations');
    });

    it('should throw error on database failure', async () => {
      const mockLocation: any = {
        name: 'The Keep',
        metadata: { createdAt: new Date() },
      };

      vi.mocked(supabase.from).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } }),
      } as any);

      await expect(LocationGenerator.saveLocation(mockLocation)).rejects.toThrow('Failed to save location to database');
    });
  });

  describe('createLocation', () => {
    it('should generate and save location', async () => {
      const mockLocationData = { name: 'The Forest', type: 'wilderness' };
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify(mockLocationData));

      vi.mocked(supabase.from).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'loc-123' }, error: null }),
      } as any);

      const result = await LocationGenerator.createLocation({ context: { campaignId: 'c1' } } as any);
      expect(result.id).toBe('loc-123');
      expect(result.name).toBe('The Forest');
    });

    it('should return location even if save fails', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify({ name: 'The Cave' }));

      vi.mocked(supabase.from).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Save Error' } }),
      } as any);

      const result = await LocationGenerator.createLocation({ context: { campaignId: 'c1' } } as any);
      expect(result.name).toBe('The Cave');
      expect(result.id).toBeUndefined();
    });
  });

  describe('generateContextualLocation', () => {
    it('should verify campaign ownership and generate location', async () => {
      const mockFrom = vi.mocked(supabase.from);
      const mockEq = vi.fn().mockReturnThis();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: mockEq,
        single: vi.fn().mockResolvedValue({ data: { id: 'c1', genre: 'horror' }, error: null }),
      } as any);

      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify({ name: 'Spooky House' }));
      vi.mocked(getAveragePartyLevel).mockResolvedValue(5);

      await LocationGenerator.generateContextualLocation('c1', 's1', 'Enter building', undefined, 'u1');

      expect(mockEq).toHaveBeenCalledWith('id', 'c1');
      expect(mockEq).toHaveBeenCalledWith('user_id', 'u1');
      expect(getAveragePartyLevel).toHaveBeenCalledWith('c1', 's1');
    });

    it('should fail closed when userId is missing', async () => {
      await expect(
        LocationGenerator.generateContextualLocation('c1', 's1', 'Action', undefined, undefined as any),
      ).rejects.toThrow('User ID is required for location generation');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('should throw if campaign is not owned by the user', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any);

      await expect(LocationGenerator.generateContextualLocation('c1', 's1', 'Action', undefined, 'u1')).rejects.toThrow('Campaign not found or access denied');
    });
  });

  describe('inferLocationTypeFromAction', () => {
    const infer = (action: string) => WorldBuildingAnalyzer.inferLocationTypeFromAction(action);

    it('should infer building', () => {
      expect(infer('Enter the building')).toBe('building');
      expect(infer('Go to the shop')).toBe('building');
    });

    it('should infer wilderness', () => {
      expect(infer('Travel through the forest')).toBe('wilderness');
      expect(infer('Explore the wilderness')).toBe('wilderness');
    });

    it('should infer dungeon', () => {
      expect(infer('Enter the dungeon')).toBe('dungeon');
      expect(infer('Go into the cave')).toBe('dungeon');
      expect(infer('Underground tunnel')).toBe('dungeon');
    });

    it('should infer settlement', () => {
      expect(infer('Visit the town')).toBe('settlement');
      expect(infer('Welcome to the city')).toBe('settlement');
      expect(infer('Tiny village')).toBe('settlement');
    });

    it('should default to room', () => {
      expect(infer('Look around')).toBe('room');
      expect(infer('Sleep in the bed')).toBe('room');
    });
  });
});
