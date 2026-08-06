/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NPCGenerator } from '../npc-generator';

import { llmApiClient } from '@/infrastructure/api';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
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

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
    createWorldBuilderNpc: vi.fn(),
  },
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

      await expect(NPCGenerator.generateNPC(mockRequest)).rejects.toThrow(
        'Invalid JSON format in NPC response',
      );
    });
  });

  describe('calculateNarrativeWeight', () => {
    it('should calculate correct weight for critical NPC', () => {
      // Accessing private method via any
      const weight = (NPCGenerator as any).calculateNarrativeWeight(
        { secrets: ['s1', 's2'], questHooks: ['q1', 'q2', 'q3'], goals: { secret: ['g1'] } },
        { importance: 'critical', role: 'villain' },
      );
      // 5 (base) + 3 (critical) + 1 (secrets > 1) + 1 (questHooks > 2) + 1 (secret goals > 0) + 1 (villain) = 12
      // capped at 10
      expect(weight).toBe(10);
    });

    it('should calculate base weight for minor NPC', () => {
      const weight = (NPCGenerator as any).calculateNarrativeWeight(
        {},
        { importance: 'minor', role: 'commoner' },
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

      vi.mocked(userDataApi.createWorldBuilderNpc).mockResolvedValue({ id: 'npc-123' });

      const id = await NPCGenerator.saveNPC(mockNPC);
      expect(id).toBe('npc-123');
    });

    it('should throw error on database failure', async () => {
      const mockNPC: any = {
        name: 'Barnaby',
        personality: { traits: [] },
        metadata: { createdAt: new Date() },
      };

      vi.mocked(userDataApi.createWorldBuilderNpc).mockRejectedValue(new Error('DB Error'));

      await expect(NPCGenerator.saveNPC(mockNPC)).rejects.toThrow('Failed to save NPC to database');
    });
  });

  describe('createNPC', () => {
    it('should generate and save NPC', async () => {
      const mockNPCData = { name: 'Barnaby', personality: { traits: [] } };
      vi.mocked(llmApiClient.generateText).mockResolvedValue(JSON.stringify(mockNPCData));

      vi.mocked(userDataApi.createWorldBuilderNpc).mockResolvedValue({ id: 'npc-123' });

      const result = await NPCGenerator.createNPC({ context: { campaignId: 'c1' } } as any);
      expect(result.id).toBe('npc-123');
    });

    it('should return NPC even if save fails', async () => {
      vi.mocked(llmApiClient.generateText).mockResolvedValue(
        JSON.stringify({ name: 'Barnaby', personality: { traits: [] } }),
      );

      vi.mocked(userDataApi.createWorldBuilderNpc).mockRejectedValue(new Error('Save Error'));

      const result = await NPCGenerator.createNPC({ context: { campaignId: 'c1' } } as any);
      expect(result.name).toBe('Barnaby');
      expect(result.id).toBeUndefined();
    });
  });

  describe('generateContextualNPC', () => {
    it('should fail closed when userId is missing', async () => {
      await expect(
        NPCGenerator.generateContextualNPC(
          'c1',
          's1',
          'The party goes to a shop',
          undefined,
          undefined as any,
        ),
      ).rejects.toThrow('User ID is required for NPC generation');
      expect(userDataApi.getCampaign).not.toHaveBeenCalled();
    });

    it('should query secure API and verify campaign ownership', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({
        id: 'c1',
        user_id: 'user-456',
        genre: 'fantasy',
      } as any);

      vi.mocked(llmApiClient.generateText).mockResolvedValue(
        JSON.stringify({ name: 'Barnaby', personality: { traits: [] } }),
      );

      await NPCGenerator.generateContextualNPC('c1', 's1', 'action', undefined, 'user-456');

      expect(userDataApi.getCampaign).toHaveBeenCalledWith('c1');
    });

    it('should throw error if campaign is not owned by the user', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue(null);

      await expect(
        NPCGenerator.generateContextualNPC('c1', 's1', 'action', undefined, 'user-456'),
      ).rejects.toThrow('Campaign not found or access denied');
    });

    it('should throw error if campaign owner does not match user context', async () => {
      vi.mocked(userDataApi.getCampaign).mockResolvedValue({
        id: 'c1',
        user_id: 'different-user',
        genre: 'fantasy',
      } as any);

      await expect(
        NPCGenerator.generateContextualNPC('c1', 's1', 'action', undefined, 'user-456'),
      ).rejects.toThrow('Campaign not found or access denied');
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
