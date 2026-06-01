/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MemoryManager } from '../../memory-manager';
import { voiceConsistencyService } from '../../voice-consistency-service';
import { WorldBuilderService } from '../../world-builders';
import { generateGeminiResponse } from '../narration-service-impl';
import * as prompts from '../shared/prompts';
import { addEquipmentContext } from '../shared/utils';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';

// Mock dependencies
vi.mock('../../memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn(),
    extractMemories: vi.fn(),
    saveMemories: vi.fn(),
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
}));

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
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

vi.mock('../shared/prompts', () => ({
  buildDMPersonaPrompt: vi.fn(() => 'DM Persona Prompt\n'),
  buildGameContextPrompt: vi.fn(() => 'Game Context Prompt\n'),
  buildResponseStructurePrompt: vi.fn(() => 'Response Structure Prompt\n'),
  buildCombatContextPrompt: vi.fn(() => 'Combat Context Prompt\n'),
  buildOpeningScenePrompt: vi.fn(() => 'Opening Scene Prompt\n'),
}));

vi.mock('../shared/utils', () => ({
  addEquipmentContext: vi.fn(() => 'Equipment Context\n'),
  keyFor: vi.fn(),
  getOrCreateDeduped: vi.fn(),
}));

describe('narration-service-impl', () => {
  const mockContext: any = {
    sessionId: 'test-session',
    campaignId: 'test-campaign',
    characterId: 'test-character',
  };

  const mockCombatDetection: any = {
    isCombat: false,
    confidence: 0,
    combatType: 'none',
    shouldStartCombat: false,
    shouldEndCombat: false,
    enemies: [],
    combatActions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (llmApiClient.generateText as any).mockResolvedValue('Mock AI Response');
    (MemoryManager.extractMemories as any).mockResolvedValue({ memories: [] });
    (WorldBuilderService.respondToPlayerAction as any).mockResolvedValue({
      locations: [],
      npcs: [],
      quests: [],
    });
  });

  it('should generate a normal narrative response', async () => {
    const params = {
      message: 'I walk to the tavern.',
      context: { ...mockContext, characterDetails: { items: [] } },
      conversationHistory: [{ role: 'user', content: 'Hello' } as any],
    };

    const result = await generateGeminiResponse(params, [], null, mockCombatDetection);

    expect(result.text).toBe('Mock AI Response');
    expect(llmApiClient.generateText).toHaveBeenCalled();
    expect(prompts.buildDMPersonaPrompt).toHaveBeenCalled();
    expect(prompts.buildGameContextPrompt).toHaveBeenCalledWith(params.context, []);
    expect(addEquipmentContext).toHaveBeenCalledWith(params.context.characterDetails);
    expect(prompts.buildOpeningScenePrompt).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Successfully generated DM response using llmApiClient');
  });

  it('should generate an opening scene for the first message', async () => {
    const params = {
      message: '',
      context: mockContext,
      conversationHistory: [],
    };

    const result = await generateGeminiResponse(params, [], null, mockCombatDetection);

    expect(result.text).toBe('Mock AI Response');
    expect(prompts.buildOpeningScenePrompt).toHaveBeenCalled();
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Opening Scene Prompt'),
      })
    );
  });

  it('should include combat context when combat is detected', async () => {
    const combatDetection = { ...mockCombatDetection, isCombat: true };
    const params = {
      message: 'I attack the goblin!',
      context: mockContext,
      conversationHistory: [],
    };

    await generateGeminiResponse(params, [], null, combatDetection);

    expect(prompts.buildCombatContextPrompt).toHaveBeenCalledWith(combatDetection);
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('IMMEDIATE DICE ROLL REQUIREMENTS'),
      })
    );
  });

  it('should parse structured JSON responses when voice context is provided', async () => {
    const voiceContext: any = { sessionId: 'test-session' };
    const structuredResponse = {
      text: 'The dragon roars!',
      narration_segments: [
        { type: 'dm', text: 'The dragon roars!', character: null, voice_category: null }
      ],
    };
    (llmApiClient.generateText as any).mockResolvedValue(JSON.stringify(structuredResponse));

    const params = {
      message: 'What do I see?',
      context: mockContext,
      conversationHistory: [{ role: 'user', content: 'Hi' } as any],
    };

    const result = await generateGeminiResponse(params, [], voiceContext, mockCombatDetection);

    expect(result.text).toBe(structuredResponse.text);
    expect(result.narrationSegments).toEqual(structuredResponse.narration_segments);
    expect(voiceConsistencyService.processVoiceAssignments).toHaveBeenCalledWith(
      'test-session',
      expect.arrayContaining([
        expect.objectContaining({ type: 'narration' })
      ])
    );
  });

  it('should handle character voice mapping in segments', async () => {
    const voiceContext: any = { sessionId: 'test-session' };
    const structuredResponse = {
      text: 'Hello!',
      narration_segments: [
        { type: 'character', text: 'Hello!', character: 'Guard', voice_category: 'guard' }
      ],
    };
    (llmApiClient.generateText as any).mockResolvedValue(JSON.stringify(structuredResponse));

    const params = {
      message: 'Greeting',
      context: mockContext,
      conversationHistory: [{ role: 'user', content: 'Hi' } as any],
    };

    await generateGeminiResponse(params, [], voiceContext, mockCombatDetection);

    expect(voiceConsistencyService.processVoiceAssignments).toHaveBeenCalledWith(
      'test-session',
      expect.arrayContaining([
        expect.objectContaining({ type: 'dialogue' })
      ])
    );
  });

  it('should handle fallback voice type mapping', async () => {
    const voiceContext: any = { sessionId: 'test-session' };
    const structuredResponse = {
      text: 'Transition...',
      narration_segments: [
        { type: 'transition', text: 'Transition...', character: null, voice_category: null }
      ],
    };
    (llmApiClient.generateText as any).mockResolvedValue(JSON.stringify(structuredResponse));

    const params = {
      message: 'Go',
      context: mockContext,
      conversationHistory: [{ role: 'user', content: 'Hi' } as any],
    };

    await generateGeminiResponse(params, [], voiceContext, mockCombatDetection);

    expect(voiceConsistencyService.processVoiceAssignments).toHaveBeenCalledWith(
      'test-session',
      expect.arrayContaining([
        expect.objectContaining({ type: 'transition' })
      ])
    );
  });

  it('should handle voice assignment errors gracefully', async () => {
    (voiceConsistencyService.processVoiceAssignments as any).mockRejectedValue(new Error('Voice Error'));
    const voiceContext: any = { sessionId: 'test-session' };
    const structuredResponse = {
      text: 'Hello!',
      narration_segments: [
        { type: 'dm', text: 'Hello!', character: null, voice_category: null }
      ],
    };
    (llmApiClient.generateText as any).mockResolvedValue(JSON.stringify(structuredResponse));

    const params = {
      message: 'Greeting',
      context: mockContext,
      conversationHistory: [{ role: 'user', content: 'Hi' } as any],
    };

    await generateGeminiResponse(params, [], voiceContext, mockCombatDetection);

    expect(logger.warn).toHaveBeenCalledWith('Voice assignment processing failed (non-fatal):', expect.any(Error));
  });

  it('should fallback to raw text if JSON parsing fails', async () => {
    const voiceContext: any = { sessionId: 'test-session' };
    const invalidJson = 'This is not JSON { "broken": ';
    (llmApiClient.generateText as any).mockResolvedValue(invalidJson);

    const params = {
      message: 'Help!',
      context: mockContext,
      conversationHistory: [{ role: 'user', content: 'Hi' } as any],
    };

    const result = await generateGeminiResponse(params, [], voiceContext, mockCombatDetection);

    expect(result.text).toBe(invalidJson);
    expect(logger.warn).toHaveBeenCalledWith('Failed to parse structured response:', expect.any(Error));
  });

  it('should trigger memory extraction and world building after response', async () => {
    (MemoryManager.extractMemories as any).mockResolvedValue({
      memories: [{ id: 'm1' }]
    });
    (WorldBuilderService.respondToPlayerAction as any).mockResolvedValue({
      locations: [{ id: 'l1' }],
      npcs: [],
      quests: []
    });

    const params = {
      message: 'I find a mysterious gem.',
      context: mockContext,
      conversationHistory: [],
    };

    await generateGeminiResponse(params, [], null, mockCombatDetection);

    expect(MemoryManager.extractMemories).toHaveBeenCalled();
    expect(MemoryManager.saveMemories).toHaveBeenCalled();
    expect(WorldBuilderService.respondToPlayerAction).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('World expanded'));
  });

  it('should handle non-fatal post-processing errors gracefully', async () => {
    (MemoryManager.extractMemories as any).mockRejectedValue(new Error('Memory Error'));
    (WorldBuilderService.respondToPlayerAction as any).mockRejectedValue(new Error('World Error'));

    const params = {
      message: 'I go north.',
      context: mockContext,
      conversationHistory: [],
    };

    const result = await generateGeminiResponse(params, [], null, mockCombatDetection);

    expect(result.text).toBe('Mock AI Response'); // Main response still returns
    expect(logger.warn).toHaveBeenCalledWith('Memory extraction failed (non-fatal):', expect.any(Error));
    expect(logger.warn).toHaveBeenCalledWith('World building failed (non-fatal):', expect.any(Error));
  });
});
