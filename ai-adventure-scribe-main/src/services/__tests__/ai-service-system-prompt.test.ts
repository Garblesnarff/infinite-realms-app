/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';
import { SessionStateService } from '../session-state-service';

import type { ChatMessage } from '../ai/shared/types';

import { llmApiClient } from '@/infrastructure/api';
import { userDataApi } from '@/services/user-data-api';

// #352: the system-prompt prefix must be byte-identical across same-scene
// turns. The earlier prompt-assembly test called buildSystemPrompt twice with
// the same input, which cannot fail; these tests go through the real
// AIService.chatWithDM path with different player input, history and flags.
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: { generateText: vi.fn() },
}));
vi.mock('../memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn(), saveMemories: vi.fn(), extractMemories: vi.fn() },
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
vi.mock('../ai/narration-contract-check', () => ({ enforceNarrationContract: vi.fn() }));
vi.mock('../ai/prompts/campaign-context-prompts', () => ({
  CampaignContextPrompts: {
    fetchStarterCampaignLore: vi.fn(),
    extractSceneEntityNames: vi.fn(),
    renderStarterCampaignLore: vi.fn(),
  },
}));
vi.mock('../ai/prompts/game-context-prompts', () => ({
  resolveStarterCampaignId: vi.fn(),
  GameContextPrompts: {
    buildUserCharacterSection: vi.fn(async () => '<game_context/>'),
    buildUserMemoriesSection: vi.fn(() => ''),
  },
}));
vi.mock('../narrative/scene-state-client', () => ({ fetchSceneState: vi.fn() }));
vi.mock('../session-state-service', () => ({
  SessionStateService: { getLatestRollOutcome: vi.fn() },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacterLoadout: vi.fn(),
    reportClientFailure: vi.fn(),
  },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const message = (id: string, speakerType: 'player' | 'dm', content: string): ChatMessage => ({
  id,
  role: speakerType === 'player' ? 'user' : 'assistant',
  content,
  timestamp: new Date('2026-10-01T19:00:00Z'),
  speakerType,
});

const SCENE = 'A rain-slicked night on Lamplight Row; the lamps are failing in order.';
const CAMPAIGN_DETAILS = { name: 'The Hollow Lantern', description: 'A lamp-lit mystery.' };

function steadyContext(sessionId: string, gameState: Record<string, unknown> = {}): any {
  return {
    sessionId,
    campaignId: 'campaign-123',
    campaignDetails: CAMPAIGN_DETAILS,
    currentSceneDescription: SCENE,
    isStarterPlaythrough: true,
    gameState: { isInCombat: false, ...gameState },
  };
}

describe('AIService system prompt stability (#352)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchSceneState).mockResolvedValue(null);
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(null);
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([]);
    vi.mocked(llmApiClient.generateText).mockResolvedValue('AI RAW Response');
  });

  it('sends a byte-identical systemPrompt on two same-scene turns with different input, history and flags', async () => {
    const sessionId = 'sysprompt-turns-1';
    const { CampaignContextPrompts } = await import('../ai/prompts/campaign-context-prompts');
    const { resolveStarterCampaignId } = await import('../ai/prompts/game-context-prompts');
    const { processDMResponse } = await import('../ai/dm-response-processor');
    const { enforceNarrationContract } = await import('../ai/narration-contract-check');
    vi.mocked(CampaignContextPrompts.fetchStarterCampaignLore).mockResolvedValue(null);
    vi.mocked(CampaignContextPrompts.extractSceneEntityNames).mockReturnValue([]);
    vi.mocked(resolveStarterCampaignId).mockReturnValue(null as any);
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'Processed Text' } as any);
    vi.mocked(enforceNarrationContract).mockImplementation(async (raw: string) => raw);

    const opening = message('dm-0', 'dm', 'Rain falls on Lamplight Row.');

    // Turn 1: resolutionOnly flag set -> non-empty <turn_flags> tail line.
    await AIService.chatWithDM({
      message: 'I scan the room for exits.',
      context: steadyContext(sessionId, { resolutionOnly: true }),
      conversationHistory: [opening],
    });

    // Turn 2: longer, different history; a narrationViolation flag instead.
    await AIService.chatWithDM({
      message: 'I ask the innkeeper about the cellar.',
      context: steadyContext(sessionId),
      conversationHistory: [
        opening,
        message('p-1', 'player', 'I scan the room for exits.'),
        message('dm-1', 'dm', 'The room is empty.'),
      ],
      narrationViolation: 'The DM mentioned a dragon; there is no dragon.',
    });

    const calls = vi.mocked(llmApiClient.generateText).mock.calls;
    expect(calls).toHaveLength(2);
    const systemPrompt1 = (calls[0][0] as any).systemPrompt as string | undefined;
    const systemPrompt2 = (calls[1][0] as any).systemPrompt as string | undefined;
    expect(systemPrompt1).toBeDefined();
    expect(systemPrompt2).toBeDefined();
    // The whole point of the stable-first layout: same scene -> identical prefix.
    expect(systemPrompt2).toBe(systemPrompt1);
  });

  it('reports missing_starter_campaign_id once on a steady-state starter turn without an id', async () => {
    const sessionId = 'missing-starter-id-1';
    const { resolveStarterCampaignId } = await import('../ai/prompts/game-context-prompts');
    const { processDMResponse } = await import('../ai/dm-response-processor');
    const { enforceNarrationContract } = await import('../ai/narration-contract-check');
    vi.mocked(resolveStarterCampaignId).mockReturnValue(null as any);
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'Processed Text' } as any);
    vi.mocked(enforceNarrationContract).mockImplementation(async (raw: string) => raw);

    await AIService.chatWithDM({
      message: 'I continue down the row.',
      context: {
        sessionId,
        campaignId: 'campaign-123',
        campaignDetails: CAMPAIGN_DETAILS,
        isStarterPlaythrough: true,
        // No starterCampaignId and no campaignDetails.starter_campaign_id.
        gameState: { isInCombat: false },
      } as any,
      // Non-empty history -> steady-state turn (isFirstMessage === false).
      conversationHistory: [message('dm-0', 'dm', 'Rain falls on Lamplight Row.')],
    });

    expect(vi.mocked(userDataApi.reportClientFailure)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(userDataApi.reportClientFailure)).toHaveBeenCalledWith(
      'missing_starter_campaign_id',
      sessionId,
      'Missing required starter_campaign_id for AI game context',
    );
  });
});
