/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ContextBuilder } from '../ai/context-builder';
import { processDMResponse } from '../ai/dm-response-processor';
import { approximateTokens, DM_PROMPT_TOKEN_BUDGET } from '../ai/shared/token-budget';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';
import { SessionStateService } from '../session-state-service';

import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { fetchCampaignAssetsForPrompt } from '@/services/ai/asset-processor';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: { generateText: vi.fn() },
}));

vi.mock('../memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn(),
    saveMemories: vi.fn(),
    extractMemories: vi.fn(),
  },
}));

vi.mock('../ai/context-builder', () => ({
  ContextBuilder: { build: vi.fn() },
}));

vi.mock('../ai/dm-response-processor', () => ({
  processDMResponse: vi.fn(),
  processDMResponseSideEffects: vi.fn(),
  runDeferredDMResponseWork: vi.fn(),
}));

vi.mock('../ai/campaign-generator', () => ({
  generateCampaignDescription: vi.fn(),
  generateCampaignName: vi.fn(),
}));

vi.mock('../ai/narration-contract-check', () => ({
  enforceNarrationContract: vi.fn(),
}));

vi.mock('../narrative/scene-state-client', () => ({
  fetchSceneState: vi.fn(),
}));

vi.mock('../session-state-service', () => ({
  SessionStateService: { getLatestRollOutcome: vi.fn() },
}));

vi.mock('@/agents/services/lore-keeper/LoreKeeperService', () => ({
  getLoreKeeperService: vi.fn(),
}));

vi.mock('@/services/ai/asset-processor', () => ({
  fetchCampaignAssetsForPrompt: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// A 27k-token canon: 60 NPCs at ~460 tokens each, mirroring the Academy of
// Arcane Gastronomy incident (#2450: ~27.3k canon tokens, 0 history tokens).
function buildBigLore(): {
  overview: Record<string, string>;
  rules: never[];
  entities: Record<string, Array<Record<string, unknown>>>;
} {
  const npcs = Array.from({ length: 60 }, (_, i) => ({
    id: `npc-${i}`,
    campaignId: 'campaign-1',
    chunkType: 'npc_tier1',
    entityName: `Kitchenhand ${i}`,
    content: `Description of Kitchenhand ${i}. ` + 'x'.repeat(1800),
    metadata: {},
  }));
  npcs[59] = {
    id: 'npc-active',
    campaignId: 'campaign-1',
    chunkType: 'npc_tier1',
    entityName: 'Active NPC',
    content: 'Currently standing in the scene. ' + 'x'.repeat(1800),
    metadata: {},
  };
  return {
    overview: {
      title: 'The Gilded Cauldron',
      premise: 'A culinary academy.',
      creativeBrief: 'Cozy.',
      overview: 'Founded by chefs.',
    },
    rules: [],
    entities: {
      npcs,
      locations: [],
      factions: [],
      items: [],
      monsters: [],
      handouts: [],
    },
  };
}

describe('AIService prompt budget guard (#2450)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([]);
    vi.mocked(fetchSceneState).mockResolvedValue(
      `<scene_state>\n<ledger_authority>Ledger facts are authoritative.</ledger_authority>\n<entity type="npc" name="Active NPC">\n</scene_state>`,
    );
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(null);
    vi.mocked(fetchCampaignAssetsForPrompt).mockResolvedValue('');

    const bigLore = buildBigLore();
    vi.mocked(getLoreKeeperService).mockReturnValue({
      getCampaignOverview: vi.fn().mockResolvedValue(bigLore.overview),
      getRules: vi.fn().mockResolvedValue(bigLore.rules),
      getEntities: vi.fn().mockResolvedValue(bigLore.entities),
    } as any);

    // ContextBuilder is pure string assembly here: without lore it returns a
    // small fixed base; with lore it returns base + the lore section. The mock
    // distinguishes the measurement build (loreSection === '') from the final
    // build by the param, exactly as the real call sites do.
    const basePrompt = 'BASE_PROMPT ' + 'y'.repeat(2000);
    vi.mocked(ContextBuilder.build).mockImplementation(async (params: any) => {
      if (params.loreSection === '') return basePrompt;
      return basePrompt + (params.loreSection ?? '');
    });

    vi.mocked(llmApiClient.generateText).mockResolvedValue('AI RAW Response');
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'Processed Text' } as any);
  });

  it('caps a 27k canon, preserves the history floor, stays in budget, and warns', async () => {
    const conversationHistory = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Turn ${i} content. ` + 'z'.repeat(800),
      timestamp: new Date(),
    }));

    await AIService.chatWithDM({
      message: 'I ask Active NPC about the souffle',
      context: {
        sessionId: 'budget-session',
        campaignId: 'campaign-1',
        characterId: 'char-1',
        starterCampaignId: 'starter-1',
        isStarterPlaythrough: true,
        currentSceneDescription: 'A moonlit courtyard behind the academy kitchens.',
      } as any,
      conversationHistory: conversationHistory as any,
    });

    expect(llmApiClient.generateText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(llmApiClient.generateText).mock.calls[0][0] as any;
    const prompt: string = call.prompt;
    const metrics: Record<string, number> = call.metrics;

    // The canon was cut...
    expect(metrics.canon_cut).toBe(1);
    // ...but the campaign overview and the active scene NPC survived the cut.
    expect(prompt).toContain('The Gilded Cauldron');
    expect(prompt).toContain('Active NPC');
    // The current scene description renders as its own block.
    expect(prompt).toContain('<current_scene>');
    expect(prompt).toContain('A moonlit courtyard behind the academy kitchens.');
    expect(metrics.scene).toBeGreaterThan(0);
    // History kept at least its floor instead of the incident's 0 tokens.
    expect(metrics.history).toBeGreaterThanOrEqual(4_000);
    expect(metrics.history_below_floor).toBe(0);
    expect(prompt).toContain('<conversation_history>');
    expect(prompt).toContain('Turn 0 content.');
    // The whole prompt stays within the 24k budget.
    expect(approximateTokens(prompt)).toBeLessThanOrEqual(DM_PROMPT_TOKEN_BUDGET);
    // The cut trips the loud client-side alarm (counts only, no prompt text).
    expect(logger.warn).toHaveBeenCalledWith(
      '[AIService] Prompt budget guard tripped',
      expect.objectContaining({ sessionId: 'budget-session' }),
    );
    const alarmCall = vi
      .mocked(logger.warn)
      .mock.calls.find((args) => args[0] === '[AIService] Prompt budget guard tripped');
    expect(JSON.stringify(alarmCall?.[1])).not.toContain('Kitchenhand');
  });

  it('does not warn and does not cut when the canon fits', async () => {
    vi.mocked(getLoreKeeperService).mockReturnValue({
      getCampaignOverview: vi.fn().mockResolvedValue({ title: 'Tiny', premise: 'p' }),
      getRules: vi.fn().mockResolvedValue([]),
      getEntities: vi.fn().mockResolvedValue({
        npcs: [
          {
            id: 'n1',
            campaignId: 'c',
            chunkType: 'npc_tier1',
            entityName: 'Pip',
            content: 'A gnome.',
            metadata: {},
          },
        ],
        locations: [],
        factions: [],
        items: [],
        monsters: [],
        handouts: [],
      }),
    } as any);

    await AIService.chatWithDM({
      message: 'Hello',
      context: {
        sessionId: 'small-session',
        campaignId: 'campaign-1',
        characterId: 'char-1',
        starterCampaignId: 'starter-1',
      } as any,
      conversationHistory: [],
    });

    const call = vi.mocked(llmApiClient.generateText).mock.calls[0][0] as any;
    const metrics: Record<string, number> = call.metrics;
    expect(metrics.canon_cut).toBe(0);
    expect(metrics.history_below_floor).toBe(0);
    expect(call.prompt).toContain('Pip');
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[AIService] Prompt budget guard tripped',
      expect.anything(),
    );
  });
});
