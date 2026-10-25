/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1085 (reopened, Hark U-007): the in-session panel stayed stale after late story
 * damage and the completion XP on a build that already had #1094.
 *
 * Root cause, pinned here: #1094 added the story-effect fields to the AIResponse
 * type and added a client gate in use-ai-response that dispatches
 * `character-state-updated` when they are populated — but processDMResponse
 * rebuilds the reply from a whitelist that drops xp_award / damage / items /
 * conditions / rest before use-ai-response ever sees it. The #1094 hook test
 * mocks AIService.chatWithDM with full shapes, so it never saw the drop.
 *
 * These tests drive the REAL processDMResponse with a server-envelope JSON
 * (the shape llmApiClient.generateText returns: model reply + server-attached
 * fields) and assert the five fields survive to the returned AIResponse.
 * On unmodified main every story-effect assertion below fails (undefined);
 * with the whitelist carry-through they pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { processDMResponse } from '../dm-response-processor';

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

describe('processDMResponse story effects (#1085)', () => {
  const mockContext = {
    sessionId: 'session-1085',
    campaignId: 'campaign-1085',
    characterId: 'character-1085',
    userId: 'user-1085',
  };

  const baseParams = {
    context: mockContext,
    message: 'We press on through the garden.',
    conversationHistory: [],
    isFirstMessage: false,
    combatDetection: { isCombat: false, confidence: 0 } as any,
    voiceContext: null,
    // Skip voice/world side effects: the whitelist is built before this return.
    deferSideEffects: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Hark U-007 shape: an XP award plus damage survives to the returned reply', async () => {
    const result = await processDMResponse({
      ...baseParams,
      rawResponse: JSON.stringify({
        text: 'The thorns tear at you, but the garden yields its secret.',
        combat_transition: 'none',
        xp_award: { amount: 450, reason: 'survived the garden' },
        damage: { amount: 2, source: 'thorns' },
      }),
    });

    expect(result.xp_award).toEqual({ amount: 450, reason: 'survived the garden' });
    expect(result.damage).toEqual({ amount: 2, source: 'thorns' });
  });

  it('carries items, conditions and rest through unchanged', async () => {
    const result = await processDMResponse({
      ...baseParams,
      rawResponse: JSON.stringify({
        text: 'You rest by the spring and pocket a silver key.',
        combat_transition: 'none',
        items: [{ name: 'silver key', quantity: 1, change: 'gain' }],
        conditions: [{ name: 'poisoned', change: 'remove' }],
        rest: { type: 'short' },
      }),
    });

    expect(result.items).toEqual([{ name: 'silver key', quantity: 1, change: 'gain' }]);
    expect(result.conditions).toEqual([{ name: 'poisoned', change: 'remove' }]);
    expect(result.rest).toEqual({ type: 'short' });
  });

  it('keeps a server-nulled damage field nulled (not applied is not a refresh)', async () => {
    const result = await processDMResponse({
      ...baseParams,
      rawResponse: JSON.stringify({
        text: 'The blow glances off your guard.',
        combat_transition: 'none',
        damage: null,
        xp_award: { amount: 50, reason: 'held the line' },
      }),
    });

    expect(result.damage).toBeNull();
    expect(result.xp_award).toEqual({ amount: 50, reason: 'held the line' });
  });

  it('invents no story effects on a narration-only reply', async () => {
    const result = await processDMResponse({
      ...baseParams,
      rawResponse: JSON.stringify({
        text: 'The path winds on through quiet trees.',
        combat_transition: 'none',
      }),
    });

    expect(result.xp_award).toBeUndefined();
    expect(result.damage).toBeUndefined();
    expect(result.items).toBeUndefined();
    expect(result.conditions).toBeUndefined();
    expect(result.rest).toBeUndefined();
  });
});
