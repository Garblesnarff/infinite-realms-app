/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NPCGenerator } from '../npc-generator';

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
  },
}));

vi.mock('@/utils/character-level-utils', () => ({
  getAveragePartyLevel: vi.fn(),
}));

describe('NPCGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateNPC', () => {
    const mockRequest: any = {
      role: 'shopkeeper',
      importance: 'minor',
      context: {
        campaignId: 'campaign-123',
        genre: 'fantasy',
      },
    };

    const mockNPCData = {
      name: 'Barnaby',
      description: 'A friendly halfling.',
      race: 'Halfling',
      role: 'shopkeeper',
      personality: { traits: ['Friendly'] },
      goals: { secret: [] },
      secrets: [],
      questHooks: [],
    };

    it('should generate an NPC successfully', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify(mockNPCData));

      const result = await NPCGenerator.generateNPC(mockRequest);

      expect(result.name).toBe('Barnaby');
      expect(result.metadata.campaignId).toBe('campaign-123');
      expect(result.metadata.narrativeWeight).toBeGreaterThanOrEqual(5);
    });

    it('should throw error if no JSON is found', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue('No JSON here');

      await expect(NPCGenerator.generateNPC(mockRequest)).rejects.toThrow('No JSON found');
    });

    it('should throw error if JSON is invalid', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue('{ invalid json }');

      await expect(NPCGenerator.generateNPC(mockRequest)).rejects.toThrow('Invalid JSON format in NPC response');
    });
  });

  describe('calculateNarrativeWeight', () => {
    it('should calculate correct weight for critical NPC', () => {
      // Accessing private method via any
      const weight = (NPCGenerator as any).calculateNarrativeWeight(
        { secrets: ['s1', 's2'], questHooks: ['q1', 'q2', 'q3'], goals: { secret: ['g1'] } },
        { importance: 'critical', role: 'villain' }
      );
      // 5 (base) + 3 (critical) + 1 (secrets > 1) + 1 (questHooks > 2) + 1 (secret goals > 0) + 1 (villain) = 12
      // capped at 10
      expect(weight).toBe(10);
    });

    it('should calculate base weight for minor NPC', () => {
      const weight = (NPCGenerator as any).calculateNarrativeWeight(
        {},
        { importance: 'minor', role: 'commoner' }
      );
      expect(weight).toBe(5);
    });
  });

  describe('saveNPC', () => {
    it('should save NPC successfully', async () => {
      const mockNPC: any = {
        name: 'Barnaby',
        personality: { traits: [] },
        metadata: { createdAt: new Date(), campaignId: 'c1' },
      };

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'npc-123' }, error: null }),
      } as any);

      const id = await NPCGenerator.saveNPC(mockNPC);
      expect(id).toBe('npc-123');
    });

    it('should throw error on database failure', async () => {
      const mockNPC: any = {
        name: 'Barnaby',
        personality: { traits: [] },
        metadata: { createdAt: new Date() },
      };

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } }),
      } as any);

      await expect(NPCGenerator.saveNPC(mockNPC)).rejects.toThrow('Failed to save NPC to database');
    });
  });

  describe('createNPC', () => {
    it('should generate and save NPC', async () => {
      const mockNPCData = { name: 'Barnaby', personality: { traits: [] } };
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify(mockNPCData));

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'npc-123' }, error: null }),
      } as any);

      const result = await NPCGenerator.createNPC({ context: { campaignId: 'c1' } } as any);
      expect(result.id).toBe('npc-123');
    });

    it('should return NPC even if save fails', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify({ name: 'Barnaby', personality: { traits: [] } }));

      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Save Error' } }),
      } as any);

      const result = await NPCGenerator.createNPC({ context: { campaignId: 'c1' } } as any);
      expect(result.name).toBe('Barnaby');
      expect(result.id).toBeUndefined();
    });
  });

  describe('generateContextualNPC', () => {
    it('should handle missing userId insecurely but still proceed', async () => {
      const mockFrom = vi.mocked(supabase.from);
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'c1', genre: 'fantasy' }, error: null }),
      } as any);

      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify({ name: 'Barnaby', personality: { traits: [] } }));
      vi.mocked(getAveragePartyLevel).mockResolvedValue(3);

      await NPCGenerator.generateContextualNPC('c1', 's1', 'The party goes to a shop');

      // Should have queried campaigns without user_id filter
      expect(mockFrom).toHaveBeenCalledWith('campaigns');
    });

    it('should include userId in query if provided', async () => {
      const mockFrom = vi.mocked(supabase.from);
      const mockEq = vi.fn().mockReturnThis();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: mockEq,
        single: vi.fn().mockResolvedValue({ data: { id: 'c1' }, error: null }),
      } as any);

      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify({ name: 'Barnaby', personality: { traits: [] } }));

      await NPCGenerator.generateContextualNPC('c1', 's1', 'action', undefined, 'user-456');

      expect(mockEq).toHaveBeenCalledWith('user_id', 'user-456');
    });

    it('should throw error if campaign not found', async () => {
       vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any);

       await expect(NPCGenerator.generateContextualNPC('c1', 's1', 'action')).rejects.toThrow('Campaign not found or access denied');
    });
  });

  describe('inference logic', () => {
    it('should infer shopkeeper from shop location', () => {
      const role = (NPCGenerator as any).inferNPCRoleFromContext('Exploring', 'The General Shop');
      expect(role).toBe('shopkeeper');
    });

    it('should infer guard from gate location', () => {
       const role = (NPCGenerator as any).inferNPCRoleFromContext('Sneaking in', 'The West Gate');
       expect(role).toBe('guard');
    });

    it('should infer noble from palace location', () => {
       const role = (NPCGenerator as any).inferNPCRoleFromContext('Sneaking in', 'The Royal Palace');
       expect(role).toBe('noble');
    });

    it('should infer mentor from learn action', () => {
      const role = (NPCGenerator as any).inferNPCRoleFromContext('I want to learn magic');
      expect(role).toBe('mentor');
    });

    it('should infer mysterious from hooded action', () => {
      const role = (NPCGenerator as any).inferNPCRoleFromContext('A hooded figure appears');
      expect(role).toBe('mysterious');
    });

    it('should infer villain from boss action', () => {
       const role = (NPCGenerator as any).inferNPCRoleFromContext('Fighting the big boss');
       expect(role).toBe('villain');
    });

    it('should infer importance from action', () => {
       expect((NPCGenerator as any).inferImportanceFromAction('Fighting the boss')).toBe('critical');
       expect((NPCGenerator as any).inferImportanceFromAction('Going on a quest')).toBe('major');
       expect((NPCGenerator as any).inferImportanceFromAction('Walking around')).toBe('minor');
    });
  });
});
