/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { formatDMTask, fetchGameContext, fetchMemories, buildAIContext } from '../ai-utils';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    listMemories: vi.fn(),
  },
}));

describe('ai-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatDMTask', () => {
    it('should format a task object correctly with full context', () => {
      const messages: any[] = [{ id: '1', text: 'Hello', role: 'user' }];
      const latestMessage: any = {
        text: 'What do I see?',
        context: { intent: 'explore', emotion: 'curious' },
      };

      const result = formatDMTask(messages, latestMessage);

      expect(result).toMatchObject({
        description: 'Respond to player message: What do I see?',
        expectedOutput: 'D&D appropriate response with game context',
        context: {
          messageHistory: messages,
          playerIntent: 'explore',
          playerEmotion: 'curious',
        },
      });
      expect(result.id).toMatch(/^task_\d+$/);
    });

    it('should use default intent and emotion if not provided', () => {
      const messages: any[] = [];
      const latestMessage: any = { text: 'Hello' };

      const result = formatDMTask(messages, latestMessage);

      expect(result.context.playerIntent).toBe('query');
      expect(result.context.playerEmotion).toBe('neutral');
    });
  });

  describe('fetchGameContext', () => {
    it('should fetch and return campaign, character details, and starterCampaignId', async () => {
      const mockSession = {
        id: 'session-123',
        campaign_id: 'campaign-456',
        character_id: 'char-789',
        starter_campaign_id: 'starter-111',
        campaign: { id: 'campaign-456', name: 'Lost Mine' },
        character: { id: 'char-789', name: 'Gundren' },
      };
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(mockSession as any);

      const result = await fetchGameContext('session-123');

      expect(userDataApi.getSessionContext).toHaveBeenCalledWith('session-123');
      expect(result).toEqual({
        campaign: mockSession.campaign,
        character: mockSession.character,
        starterCampaignId: 'starter-111',
      });
    });

    it('should return null and log error if the context route fails', async () => {
      vi.mocked(userDataApi.getSessionContext).mockRejectedValue(new Error('Request failed'));

      const result = await fetchGameContext('session-123');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Error in fetchGameContext:', expect.any(Error));
    });

    it('should return null if campaign_id or character_id is missing', async () => {
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
        id: 'session-123',
        campaign_id: null,
        character_id: 'char-789',
        campaign: {},
        character: {},
      });

      const result = await fetchGameContext('session-123');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('No campaign or character IDs found in session');
    });
  });

  describe('buildAIContext', () => {
    it('should construct the correct AI context object', () => {
      const params = {
        sessionId: 'session-123',
        userId: 'user-456',
        starterCampaignId: 'starter-789',
        campaign: { id: 'campaign-456', name: 'Lost Mine' },
        character: { id: 'char-789', name: 'Gundren' },
        currentPhase: 'exploration',
        isInCombat: true,
        currentTurnParticipantId: 'p1',
        pendingRollsCount: 2,
        currentRound: 3,
        participants: [
          {
            id: 'p1',
            name: 'Gundren',
            participantType: 'player',
            currentHitPoints: 20,
            maxHitPoints: 30,
            armorClass: 15,
            conditions: [{ name: 'Poisoned' }],
          },
        ] as any[],
      };

      const result = buildAIContext(params);

      expect(result).toEqual({
        campaignId: 'campaign-456',
        characterId: 'char-789',
        sessionId: 'session-123',
        userId: 'user-456',
        starterCampaignId: 'starter-789',
        isStarterPlaythrough: true,
        campaignDetails: params.campaign,
        characterDetails: params.character,
        gameState: {
          currentPhase: 'exploration',
          isInCombat: true,
          currentTurnPlayerId: 'p1',
          pendingRolls: 2,
          round: 3,
          participants: [
            {
              id: 'p1',
              name: 'Gundren',
              type: 'player',
              hp: 20,
              maxHp: 30,
              armorClass: 15,
              conditions: ['Poisoned'],
            },
          ],
        },
      });
    });

    it('should handle missing optional fields and return defaults', () => {
      const params = {
        sessionId: 'session-123',
        campaign: {},
        character: {},
        currentPhase: 'exploration',
        isInCombat: false,
        pendingRollsCount: 0,
      };

      const result = buildAIContext(params);

      expect(result).toEqual({
        campaignId: '',
        characterId: '',
        sessionId: 'session-123',
        userId: undefined,
        starterCampaignId: undefined,
        campaignDetails: {},
        characterDetails: {},
        gameState: {
          currentPhase: 'exploration',
          isInCombat: false,
          currentTurnPlayerId: undefined,
          pendingRolls: 0,
          round: undefined,
          participants: [],
        },
      });
    });
  });

  describe('fetchMemories', () => {
    it('should fetch memories and validate their types', async () => {
      const mockMemories = [
        { id: 'm1', content: 'Met a goblin', type: 'npc' },
        { id: 'm2', content: 'Found a sword', type: 'invalid-type' },
        { id: 'm3', content: 'It was rainy', type: null },
      ];

      vi.mocked(userDataApi.listMemories).mockResolvedValue(mockMemories as any);

      const result = await fetchMemories('session-123');

      expect(userDataApi.listMemories).toHaveBeenCalledWith('session-123');

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('npc');
      expect(result[1].type).toBe('general'); // Normalized
      expect(result[2].type).toBe('general'); // Normalized

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        "[Memory] Invalid memory type detected: invalid-type, defaulting to 'general'",
      );
    });

    it('should return empty array if no memories found', async () => {
      vi.mocked(userDataApi.listMemories).mockResolvedValue([]);

      const result = await fetchMemories('session-123');

      expect(result).toEqual([]);
    });
  });
});
