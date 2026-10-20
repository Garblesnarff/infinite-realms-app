/* eslint-disable @typescript-eslint/no-explicit-any */
// #874: a resolution-only turn's `message` is the machine-built combat
// resolution payload (JSON of engine results), not player text. Sending it as
// the generate body's `player_input` 422'd every death-save narration (the
// route caps that field at 20000 chars because it is the player's raw input),
// and using it unbounded as the memory-recall query 422'd the recall route
// (8000-char cap). The payload itself is built by the shared fixture from the
// real producers; the wire-body test (ai-service-resolution-wire-body.test.ts)
// asserts the body the client actually POSTs equals the fixture's body, and
// the server half of this pair posts that body through the real route
// (server-bun llm-generate-resolution-narration.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildDeathSaveNarrationPayload } from '../../../shared/test-fixtures/death-save-narration-payload';
import { ContextBuilder } from '../ai/context-builder';
import { processDMResponse } from '../ai/dm-response-processor';
import { enforceNarrationContract } from '../ai/narration-contract-check';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';
import { SessionStateService } from '../session-state-service';

import { llmApiClient } from '@/infrastructure/api';

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

const SETUP_HISTORY = [
  {
    id: 'setup-1',
    role: 'assistant' as const,
    content: 'The horrors close in on the fallen cleric.',
    timestamp: new Date(),
  },
];

describe('AIService resolution-only player_input (#874)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([]);
    vi.mocked(fetchSceneState).mockResolvedValue(null);
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(null);
    vi.mocked(ContextBuilder.build).mockResolvedValue('BASE_PROMPT');
    vi.mocked(llmApiClient.generateText).mockResolvedValue('AI RAW Response');
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'Processed Text' } as any);
    vi.mocked(enforceNarrationContract).mockImplementation(async (raw: string) => raw);
  });

  it('omits player_input and bounds the recall query for a resolution-only death-save narration', async () => {
    // Four creatures standing: the real producers' payload is ~40k chars,
    // twice the route's player_input cap. If the fixture ever shrinks under
    // the cap, this test stops proving the bug — fail loudly instead.
    const payload = buildDeathSaveNarrationPayload(4);
    expect(payload.length).toBeGreaterThan(20_000);

    await AIService.chatWithDM({
      message: payload,
      context: {
        sessionId: 'session-death-save-narration',
        campaignId: 'campaign-1',
        characterId: 'char-1',
        gameState: { isInCombat: true, resolutionOnly: true },
      } as any,
      conversationHistory: SETUP_HISTORY as any,
    });

    expect(llmApiClient.generateText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(llmApiClient.generateText).mock.calls[0][0] as any;
    // The field is absent (not empty): the route's extract-from-prompt
    // fallback reads the same payload out of the prompt's <player_input>
    // block, so downstream consumers see identical input.
    expect(call).not.toHaveProperty('player_input');
    // The model still receives the payload, inside the prompt.
    expect(call.prompt).toContain(payload);
    // Recall still runs, but the query is bounded to the recall route's
    // 8000-char cap instead of 422ing on the full payload.
    expect(MemoryManager.getRelevantMemories).toHaveBeenCalledTimes(1);
    const query = vi.mocked(MemoryManager.getRelevantMemories).mock.calls[0][1] as string;
    expect(query).toBe(payload.slice(0, 8000));
    expect(query.length).toBeLessThanOrEqual(8000);
  });

  it('still sends player_input and recalls memories on an ordinary player turn', async () => {
    await AIService.chatWithDM({
      message: 'I raise my shield and advance.',
      context: {
        sessionId: 'session-ordinary-turn',
        campaignId: 'campaign-1',
        characterId: 'char-1',
        gameState: { isInCombat: true },
      } as any,
      conversationHistory: SETUP_HISTORY as any,
    });

    expect(llmApiClient.generateText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(llmApiClient.generateText).mock.calls[0][0] as any;
    expect(call.player_input).toBe('I raise my shield and advance.');
    expect(MemoryManager.getRelevantMemories).toHaveBeenCalledTimes(1);
    expect(vi.mocked(MemoryManager.getRelevantMemories).mock.calls[0][1]).toBe(
      'I raise my shield and advance.',
    );
  });
});
