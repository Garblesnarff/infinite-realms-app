/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MemoryManager } from '../../memory-manager';
import { voiceConsistencyService } from '../../voice-consistency-service';
import { WorldBuilderService, WorldBuilderRepository } from '../../world-builders';
import { applyAssetPostProcessing, getCachedAssets, insertAssetTags } from '../asset-processor';
import { processDMResponse } from '../dm-response-processor';
import { parseXMLTagsFromResponse } from '../xml-parser';

import { normalizeAssetTagsInContent } from '@/utils/normalize-asset-tags';

// Mock dependencies
vi.mock('../asset-processor', () => ({
  applyAssetPostProcessing: vi.fn((params) => params),
  insertAssetTags: vi.fn((text) => text),
  getCachedAssets: vi.fn(() => []),
}));

vi.mock('../xml-parser', () => ({
  parseXMLTagsFromResponse: vi.fn(() => ({
    hadTags: false,
    narrative: '',
    memories: [],
    worldUpdates: { npcs: [], locations: [], quests: [] },
  })),
}));

vi.mock('../../memory-manager', () => ({
  MemoryManager: {
    saveMemories: vi.fn(),
    extractMemories: vi.fn(() => ({ memories: [] })),
  },
}));

vi.mock('../../voice-consistency-service', () => ({
  voiceConsistencyService: {
    processVoiceAssignments: vi.fn(),
  },
}));

vi.mock('../../world-builders', () => ({
  WorldBuilderService: {
    respondToPlayerAction: vi.fn(),
  },
  WorldBuilderRepository: {
    saveNPCFromXML: vi.fn(),
    saveLocationFromXML: vi.fn(),
    saveQuestFromXML: vi.fn(),
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

vi.mock('@/utils/memory/segmentation', () => ({
  sanitizeForMemoryExtraction: vi.fn((text) => text),
}));

vi.mock('@/utils/normalize-asset-tags', () => ({
  normalizeAssetTagsInContent: vi.fn((text) => text),
}));

describe('processDMResponse', () => {
  const mockContext = {
    sessionId: 'session-123',
    campaignId: 'campaign-456',
    characterId: 'character-789',
  };

  const defaultParams = {
    rawResponse: 'Hello world',
    context: mockContext,
    message: 'hi',
    conversationHistory: [],
    isFirstMessage: false,
    combatDetection: { isCombat: false, confidence: 0 } as any,
    voiceContext: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getCachedAssets as any).mockReturnValue([]);
    (applyAssetPostProcessing as any).mockImplementation(({ text }: any) => ({ text }));
    (normalizeAssetTagsInContent as any).mockImplementation((text: string) => text);
  });

  it('should process a basic narrative response', async () => {
    const result = await processDMResponse(defaultParams);

    expect(result.text).toBe('Hello world');
    expect(applyAssetPostProcessing).toHaveBeenCalled();
    expect(normalizeAssetTagsInContent).toHaveBeenCalled();
  });

  describe('Opening Message Processing', () => {
    it('should strip markdown fences from opening messages', async () => {
      const params = {
        ...defaultParams,
        isFirstMessage: true,
        rawResponse:
          '```\nWelcome to the adventure! The old gate groans open as moonlight spills across the road.\n```',
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe(
        'Welcome to the adventure! The old gate groans open as moonlight spills across the road.',
      );
    });

    it('should strip leading metadata blocks from opening messages', async () => {
      const params = {
        ...defaultParams,
        isFirstMessage: true,
        rawResponse:
          '```json\n{"meta": "data"}\n```\nReal narrative starts here, where lanterns burn beside the road and distant bells mark the hour.',
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe(
        'Real narrative starts here, where lanterns burn beside the road and distant bells mark the hour.',
      );
    });

    it('uses the text field from a valid structured opening response', async () => {
      const openingText =
        'The harbor wakes beneath a violet dawn while gulls wheel above the silent watchtowers.';
      const result = await processDMResponse({
        ...defaultParams,
        isFirstMessage: true,
        rawResponse: JSON.stringify({ text: openingText, narration_segments: [] }),
      });

      expect(result.text).toBe(openingText);
    });

    it('rejects JSON soup instead of persisting a leading brace', async () => {
      await expect(
        processDMResponse({
          ...defaultParams,
          isFirstMessage: true,
          rawResponse: '{"text":"A long response that is never closed',
        }),
      ).rejects.toThrow('structured-output integrity');
    });
  });

  describe('Structured Voice Response', () => {
    const voiceContext = { voiceId: 'v1' } as any;

    it('should parse valid JSON structured responses', async () => {
      const jsonResponse = JSON.stringify({
        text: 'The dragon roars.',
        narration_segments: [
          { type: 'narration', text: 'The dragon roars.' }
        ]
      });

      const params = {
        ...defaultParams,
        rawResponse: jsonResponse,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe('The dragon roars.');
      expect(result.narrationSegments).toHaveLength(1);
      expect(voiceConsistencyService.processVoiceAssignments).toHaveBeenCalled();
    });

    it('should handle malformed JSON by extracting text field', async () => {
      const malformedJson = 'Some garbage {"text": "Recovered text"} more garbage';
      const params = {
        ...defaultParams,
        rawResponse: malformedJson,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe('Recovered text');
    });

    it('should handle malformed JSON with nested quotes and newlines', async () => {
      const malformedJson = 'Some garbage {"text": "Recovered \\"text\\" with \\n newlines"} more garbage';
      const params = {
        ...defaultParams,
        rawResponse: malformedJson,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe('Recovered "text" with \n newlines');
    });

    it('should handle extreme malformed JSON fallback', async () => {
      const malformedJson = 'Totally broken JSON';
      const params = {
        ...defaultParams,
        rawResponse: malformedJson,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe('Totally broken JSON');
    });

    it('should map narration_segments to camelCase and handle type normalization', async () => {
      const jsonResponse = JSON.stringify({
        text: 'Hello',
        narration_segments: [
          { type: 'dm', text: 'Narration' },
          { type: 'character', text: 'Dialogue' },
          { type: 'other', text: 'Other' }
        ]
      });

      const params = {
        ...defaultParams,
        rawResponse: jsonResponse,
        voiceContext,
      };

      await processDMResponse(params);

      expect(voiceConsistencyService.processVoiceAssignments).toHaveBeenCalledWith(
        'session-123',
        [
          expect.objectContaining({ type: 'narration', text: 'Narration' }),
          expect.objectContaining({ type: 'dialogue', text: 'Dialogue' }),
          expect.objectContaining({ type: 'other', text: 'Other' })
        ]
      );
    });

    it('should handle JSON with extra text around it', async () => {
      const wrappedJson = 'Here is the response: {"text": "Dragon attacks!"} end of message';
      const params = {
        ...defaultParams,
        rawResponse: wrappedJson,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe('Dragon attacks!');
    });

    it('should handle JSON with trailing commas', async () => {
      const trailingCommaJson = '{"text": "Hello", "narration_segments": [{"type": "dm", "text": "Hi",},],}';
      const params = {
        ...defaultParams,
        rawResponse: trailingCommaJson,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe('Hello');
    });

    it('should handle missing narration_segments in structured response', async () => {
      const jsonResponse = JSON.stringify({
        text: 'Only text',
      });

      const params = {
        ...defaultParams,
        rawResponse: jsonResponse,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.text).toBe('Only text');
      expect(result.narrationSegments).toBeUndefined();
    });

    it('should handle narrationSegments (camelCase) in structured response', async () => {
      const jsonResponse = JSON.stringify({
        text: 'Hello',
        narrationSegments: [
          { type: 'narration', text: 'Hi' }
        ]
      });

      const params = {
        ...defaultParams,
        rawResponse: jsonResponse,
        voiceContext,
      };

      const result = await processDMResponse(params);

      expect(result.narrationSegments).toHaveLength(1);
    });
  });

  describe('XML Tag Processing', () => {
    it('should process memories from XML tags', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean narrative',
        memories: ['Met a mysterious stranger'],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      const result = await processDMResponse(defaultParams);

      expect(result.text).toBe('Clean narrative');
      expect(MemoryManager.saveMemories).toHaveBeenCalledWith([
        expect.objectContaining({ content: 'Met a mysterious stranger' })
      ]);
    });

    it('should process world updates from XML tags', async () => {
      const mockNpc = { name: 'Bob' };
      const mockLocation = { name: 'Cave' };
      const mockQuest = { title: 'Find gold' };

      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean narrative',
        memories: [],
        worldUpdates: {
          npcs: [mockNpc],
          locations: [mockLocation],
          quests: [mockQuest]
        },
      });

      // Mock successful saves
      (WorldBuilderRepository.saveNPCFromXML as any).mockResolvedValue(true);
      (WorldBuilderRepository.saveLocationFromXML as any).mockResolvedValue(true);
      (WorldBuilderRepository.saveQuestFromXML as any).mockResolvedValue(true);

      await processDMResponse(defaultParams);

      expect(WorldBuilderRepository.saveNPCFromXML).toHaveBeenCalled();
      expect(WorldBuilderRepository.saveLocationFromXML).toHaveBeenCalled();
      expect(WorldBuilderRepository.saveQuestFromXML).toHaveBeenCalled();
    });

    it('should handle failed world update saves from XML', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean narrative',
        memories: [],
        worldUpdates: {
          npcs: [{ name: 'Failed NPC' }],
          locations: [],
          quests: []
        },
      });

      (WorldBuilderRepository.saveNPCFromXML as any).mockResolvedValue(false);

      await processDMResponse(defaultParams);

      expect(WorldBuilderRepository.saveNPCFromXML).toHaveBeenCalled();
    });

    it('should handle errors in XML world update saving gracefully', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Narrative',
        memories: [],
        worldUpdates: { npcs: [{ name: 'Error NPC' }], locations: [], quests: [] },
      });

      (WorldBuilderRepository.saveNPCFromXML as any).mockRejectedValue(new Error('DB Error'));

      const result = await processDMResponse(defaultParams);
      expect(result.text).toBe('Narrative');
    });
  });

  describe('Fallback Extraction', () => {
    it('should use fallback memory extraction when XML tags are missing', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: false,
        narrative: 'Hello world',
        memories: [],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      await processDMResponse(defaultParams);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
      expect(WorldBuilderService.respondToPlayerAction).toHaveBeenCalled();
    });

    it('should respect turn-based extraction logic for free tier', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: false,
        narrative: 'Hello world',
        memories: [],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      const params = {
        ...defaultParams,
        userPlan: 'free' as any,
        turnCount: 1, // Not a multiple of 3
      };

      await processDMResponse(params);

      expect(MemoryManager.extractMemories).not.toHaveBeenCalled();
    });

    it('should handle extraction for free tier on turn multiples of 3', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: false,
        narrative: 'Hello world',
        memories: [],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      const params = {
        ...defaultParams,
        userPlan: 'free' as any,
        turnCount: 3,
      };

      await processDMResponse(params);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
    });

    it('should skip memory extraction if turnCount is undefined for free tier', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: false,
        narrative: 'Hello world',
        memories: [],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      const params = {
        ...defaultParams,
        userPlan: 'free' as any,
        turnCount: undefined,
      };

      await processDMResponse(params);

      expect(MemoryManager.extractMemories).not.toHaveBeenCalled();
    });

    it('should handle extraction for undefined userPlan on any turn', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: false,
        narrative: 'Hello world',
        memories: [],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      const params = {
        ...defaultParams,
        userPlan: undefined,
        turnCount: 1,
      };

      await processDMResponse(params);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
    });

    it('should extract memories for pro/enterprise tiers on any turn', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: false,
        narrative: 'Hello world',
        memories: [],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      const params = {
        ...defaultParams,
        userPlan: 'pro' as any,
        turnCount: 1,
      };

      await processDMResponse(params);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
    });

    it('should skip world expansion if sessionId is missing', async () => {
      const params = {
        ...defaultParams,
        context: { ...mockContext, sessionId: undefined },
      };

      await processDMResponse(params);

      expect(MemoryManager.extractMemories).not.toHaveBeenCalled();
      expect(WorldBuilderService.respondToPlayerAction).not.toHaveBeenCalled();
    });

    it('should handle errors in extraction gracefully', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: false,
        narrative: 'Hello world',
        memories: [],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      (MemoryManager.extractMemories as any).mockRejectedValue(new Error('Extraction failed'));
      (WorldBuilderService.respondToPlayerAction as any).mockRejectedValue(new Error('World building failed'));

      const result = await processDMResponse(defaultParams);

      expect(result.text).toBe('Hello world');
    });
  });

  describe('Asset Normalization', () => {
    it('should normalize asset tags in both text and segments', async () => {
      const jsonResponse = JSON.stringify({
        text: 'Text with [Asset:123]',
        narration_segments: [
          { type: 'narration', text: 'Segment with [Asset:456]' }
        ]
      });

      const params = {
        ...defaultParams,
        rawResponse: jsonResponse,
        voiceContext: { voiceId: 'v1' } as any,
      };

      await processDMResponse(params);

      expect(normalizeAssetTagsInContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('Asset Post-processing with Assets', () => {
    it('should insert asset tags when assets are available', async () => {
      const voiceContext = { voiceId: 'v1' } as any;
      const jsonResponse = JSON.stringify({
        text: 'A dragon appeared',
        narration_segments: [
          { type: 'narration', text: 'A dragon appeared' }
        ]
      });

      (getCachedAssets as any).mockReturnValue([{ id: '1', name: 'dragon' }]);

      const params = {
        ...defaultParams,
        rawResponse: jsonResponse,
        voiceContext,
      };

      await processDMResponse(params);

      expect(insertAssetTags).toHaveBeenCalled();
    });
  });

  describe('Combat Detection', () => {
    it('uses structured transitions and actions instead of prose inference', async () => {
      const rawResponse = JSON.stringify({
        text: 'The goblin reaches for its blade.', narration_segments: [], roll_requests: [],
        combat_transition: 'start', combatants: [],
        combat_actions: [{ actor_id: 'goblin-1', action_type: 'dodge', target_ids: [], weapon_id: null, spell_id: null, movement_feet: 0 }],
      });
      const result = await processDMResponse({ ...defaultParams, rawResponse });
      expect(result.combatDetection?.shouldStartCombat).toBe(true);
      expect(result.combat_actions).toHaveLength(1);
      expect(result.text).toBe('The goblin reaches for its blade.');
    });
    it('should include combat detection results in the final response', async () => {
      const combatDetection = {
        isCombat: true,
        confidence: 0.9,
        combatType: 'encounter',
        enemies: ['Orc'],
        combatActions: []
      } as any;

      const params = {
        ...defaultParams,
        combatDetection
      };

      const result = await processDMResponse(params);

      expect(result.combatDetection).toEqual(expect.objectContaining({
        isCombat: true,
        confidence: 0.9,
        enemies: ['Orc']
      }));
    });
  });
});
