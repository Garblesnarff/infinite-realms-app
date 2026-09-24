/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  fitTranscriptToBudget,
  processWorldAndMemories,
  SUMMARY_TRANSCRIPT_MAX_CHARS,
} from '../world-update-processor';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { parseXMLTagsFromResponse } from '@/services/ai/xml-parser';
import { MemoryManager } from '@/services/memory-manager';
import { WorldBuilderRepository, WorldBuilderService } from '@/services/world-builders';

// Mock dependencies using aliases to ensure they match the imports in the source
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: {
    saveMemories: vi.fn(),
    extractMemories: vi.fn(),
  },
}));

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    submitMemoryExtraction: vi.fn(),
  },
}));

vi.mock('@/services/world-builders', () => ({
  WorldBuilderService: {
    respondToPlayerAction: vi.fn(),
  },
  WorldBuilderRepository: {
    saveNPCFromXML: vi.fn(),
    saveLocationFromXML: vi.fn(),
    saveQuestFromXML: vi.fn(),
  },
}));

vi.mock('@/services/ai/xml-parser', () => ({
  parseXMLTagsFromResponse: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/memory/segmentation', () => ({
  sanitizeForMemoryExtraction: vi.fn((text) => `sanitized-${text}`),
}));

describe('processWorldAndMemories', () => {
  const mockContext = {
    sessionId: 'session-123',
    campaignId: 'campaign-456',
    characterId: 'character-789',
    userId: 'user-123',
  } as any;

  const defaultParams = {
    text: 'DM Response',
    context: mockContext,
    message: 'Player message',
    conversationHistory: [] as any[],
    userPlan: 'pro',
    turnCount: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (parseXMLTagsFromResponse as any).mockReturnValue({
      hadTags: false,
      narrative: 'DM Response',
      memories: [],
      worldUpdates: { npcs: [], locations: [], quests: [] },
    });
    // Extraction is fire-and-forget since #2148: it returns nothing to wait on.
    (MemoryManager.extractMemories as any).mockReturnValue(undefined);
    (llmApiClient.submitMemoryExtraction as any).mockResolvedValue(undefined);
    // Ensure WorldBuilderService.respondToPlayerAction returns a valid object by default
    (WorldBuilderService.respondToPlayerAction as any).mockResolvedValue({
      npcs: [],
      locations: [],
      quests: [],
    });
    // Ensure XML saves return true by default
    (WorldBuilderRepository.saveNPCFromXML as any).mockResolvedValue(true);
    (WorldBuilderRepository.saveLocationFromXML as any).mockResolvedValue(true);
    (WorldBuilderRepository.saveQuestFromXML as any).mockResolvedValue(true);
  });

  it('should return text immediately if sessionId is missing', async () => {
    const params = { ...defaultParams, context: { ...mockContext, sessionId: undefined } };
    const result = await processWorldAndMemories(params);
    expect(result).toBe('DM Response');
    expect(parseXMLTagsFromResponse).not.toHaveBeenCalled();
  });

  describe('XML Tag Extraction', () => {
    it('should process memories and world updates from XML tags', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean Narrative',
        memories: ['Memory 1'],
        worldUpdates: {
          npcs: [{ name: 'NPC 1' }],
          locations: [{ name: 'Location 1' }],
          quests: [{ title: 'Quest 1' }],
        },
      });

      const result = await processWorldAndMemories(defaultParams);

      expect(result).toBe('Clean Narrative');
      expect(MemoryManager.saveMemories).toHaveBeenCalledWith([
        expect.objectContaining({ content: 'Memory 1', session_id: 'session-123' }),
      ]);
      expect(WorldBuilderRepository.saveNPCFromXML).toHaveBeenCalled();
      expect(WorldBuilderRepository.saveLocationFromXML).toHaveBeenCalled();
      expect(WorldBuilderRepository.saveQuestFromXML).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('World expanded from XML'));
    });

    it('should handle partial failures in XML world update saving (NPCs)', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean Narrative',
        memories: [],
        worldUpdates: {
          npcs: [{ name: 'Good NPC' }, { name: 'Bad NPC' }],
          locations: [],
          quests: [],
        },
      });

      (WorldBuilderRepository.saveNPCFromXML as any)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await processWorldAndMemories(defaultParams);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('1/2 XML world updates failed to save'),
      );
    });

    it('should handle partial failures in XML world update saving (Locations)', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean Narrative',
        memories: [],
        worldUpdates: {
          npcs: [],
          locations: [{ name: 'Bad Location' }],
          quests: [],
        },
      });

      (WorldBuilderRepository.saveLocationFromXML as any).mockResolvedValue(false);

      await processWorldAndMemories(defaultParams);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('1/1 XML world updates failed to save'),
      );
    });

    it('should handle partial failures in XML world update saving (Quests)', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean Narrative',
        memories: [],
        worldUpdates: {
          npcs: [],
          locations: [],
          quests: [{ title: 'Bad Quest' }],
        },
      });

      (WorldBuilderRepository.saveQuestFromXML as any).mockResolvedValue(false);

      await processWorldAndMemories(defaultParams);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('1/1 XML world updates failed to save'),
      );
    });

    it('should handle errors during XML saving gracefully', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean Narrative',
        memories: ['Broken Memory'],
        worldUpdates: { npcs: [], locations: [], quests: [] },
      });

      (MemoryManager.saveMemories as any).mockRejectedValue(new Error('Save Failed'));

      const result = await processWorldAndMemories(defaultParams);

      expect(result).toBe('Clean Narrative');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save XML-extracted memories'),
        expect.any(Error),
      );
    });

    it('should handle world update errors gracefully', async () => {
      (parseXMLTagsFromResponse as any).mockReturnValue({
        hadTags: true,
        narrative: 'Clean Narrative',
        memories: [],
        worldUpdates: {
          npcs: [{ name: 'Error NPC' }],
          locations: [],
          quests: [],
        },
      });

      (WorldBuilderRepository.saveNPCFromXML as any).mockRejectedValue(new Error('DB Error'));

      const result = await processWorldAndMemories(defaultParams);

      expect(result).toBe('Clean Narrative');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save XML-extracted world updates'),
        expect.any(Error),
      );
    });
  });

  describe('Fallback Extraction', () => {
    it('does not wait on the extraction submit (#2148)', async () => {
      // A submit that never settles must not hold the deferred path open.
      (llmApiClient.submitMemoryExtraction as any).mockReturnValue(new Promise(() => {}));
      (MemoryManager.extractMemories as any).mockImplementation(() => {
        void llmApiClient.submitMemoryExtraction({} as any);
      });

      await expect(processWorldAndMemories({ ...defaultParams, turnCount: 20 })).resolves.toBe(
        'DM Response',
      );

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
      expect(llmApiClient.submitMemoryExtraction).toHaveBeenCalledWith({
        sessionId: 'session-123',
        characterId: 'character-789',
        kind: 'summary',
        prompt: expect.stringContaining('Summarize this D&D campaign'),
        maxTokens: 1200,
        turn: 20,
      });
      expect(MemoryManager.saveMemories).not.toHaveBeenCalled();
    });

    it('trims a long summary transcript to its budget, keeping the newest messages (#2186)', async () => {
      const longHistory = Array.from({ length: 40 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `turn-${i} ${'x'.repeat(5_000)}`,
      }));

      await processWorldAndMemories({
        ...defaultParams,
        conversationHistory: longHistory as any,
        turnCount: 20,
      });

      const summaryCall = (llmApiClient.submitMemoryExtraction as any).mock.calls.find(
        ([job]: [{ kind: string }]) => job.kind === 'summary',
      );
      const prompt: string = summaryCall[0].prompt;
      // 40 × 5k chars would be ~200k; the prompt stays under the server's 80k cap.
      expect(prompt.length).toBeLessThanOrEqual(SUMMARY_TRANSCRIPT_MAX_CHARS + 500);
      expect(prompt).toContain('turn-39');
      expect(prompt).toContain('sanitized-DM Response');
      expect(prompt).not.toContain('turn-0 ');
    });

    it('fitTranscriptToBudget keeps whole newest lines, and the tail of an oversize newest line', () => {
      expect(fitTranscriptToBudget(['aaaa', 'bbbb', 'cccc'], 9)).toBe('bbbb\ncccc');
      expect(fitTranscriptToBudget(['aaaa', 'bbbb'], 100)).toBe('aaaa\nbbbb');
      expect(fitTranscriptToBudget(['old', 'abcdefgh'], 3)).toBe('fgh');
    });

    it('should use fallback extraction when XML tags are absent', async () => {
      (WorldBuilderService.respondToPlayerAction as any).mockResolvedValue({
        npcs: [{ name: 'New NPC' }],
        locations: [],
        quests: [],
      });

      const result = await processWorldAndMemories(defaultParams);

      expect(result).toBe('DM Response');
      expect(MemoryManager.extractMemories).toHaveBeenCalled();
      // The server saves what it extracts (#2148); the browser writes nothing for this path.
      expect(MemoryManager.saveMemories).not.toHaveBeenCalled();
      expect(WorldBuilderService.respondToPlayerAction).toHaveBeenCalled();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No XML tags in DM response'),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('World expanded (fallback): +0 locations, +1 NPCs, +0 quests'),
      );
    });

    it('should respect turn-based skipping for free tier', async () => {
      const params = { ...defaultParams, userPlan: 'free', turnCount: 1 };
      await processWorldAndMemories(params);

      expect(MemoryManager.extractMemories).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipping memory extraction for free tier (turn 1'),
      );
    });

    it('should handle undefined turnCount for free tier skipping', async () => {
      const params = { ...defaultParams, userPlan: 'free', turnCount: undefined };
      await processWorldAndMemories(params);

      expect(MemoryManager.extractMemories).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('next extraction on turn unknown'),
      );
    });

    it('should extract memories for free tier on turn 3', async () => {
      const params = { ...defaultParams, userPlan: 'free', turnCount: 3 };
      await processWorldAndMemories(params);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
    });

    it('should extract memories for pro tier on any turn', async () => {
      const params = { ...defaultParams, userPlan: 'pro', turnCount: 1 };
      await processWorldAndMemories(params);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
    });

    it('should extract memories when userPlan is undefined', async () => {
      const params = { ...defaultParams, userPlan: undefined, turnCount: 1 };
      await processWorldAndMemories(params);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
    });

    it('should handle fallback extraction returning no memories', async () => {
      (MemoryManager.extractMemories as any).mockResolvedValue({
        memories: [],
      });

      await processWorldAndMemories(defaultParams);

      expect(MemoryManager.extractMemories).toHaveBeenCalled();
      expect(MemoryManager.saveMemories).not.toHaveBeenCalled();
    });

    it('should handle fallback extraction errors gracefully', async () => {
      (MemoryManager.extractMemories as any).mockImplementation(() => {
        throw new Error('Extract Error');
      });
      (WorldBuilderService.respondToPlayerAction as any).mockRejectedValue(
        new Error('Expansion Error'),
      );

      const result = await processWorldAndMemories(defaultParams);

      expect(result).toBe('DM Response');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Memory extraction failed'),
        expect.any(Error),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('World building failed'),
        expect.any(Error),
      );
    });

    it('should include recent messages in memory context', async () => {
      const history = [
        { content: 'msg 1' },
        { content: 'msg 2' },
        { content: 'msg 3' },
        { content: 'msg 4' },
        { content: 'msg 5' },
        { content: 'msg 6' },
      ] as any[];
      const params = { ...defaultParams, conversationHistory: history };

      await processWorldAndMemories(params);

      expect(MemoryManager.extractMemories).toHaveBeenCalledWith(
        expect.objectContaining({
          recentMessages: ['msg 2', 'msg 3', 'msg 4', 'msg 5', 'msg 6'],
        }),
        'Player message',
        'sanitized-DM Response',
      );
    });
  });
});
