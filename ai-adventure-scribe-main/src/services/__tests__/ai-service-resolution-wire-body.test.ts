/* eslint-disable @typescript-eslint/no-explicit-any */
// #874, AGENTS.md §4: the body the client actually POSTs for a resolution-only
// narration turn must equal the shared fixture's body — not a hand-written
// parallel of it (#2280: mocked-API tests approved a body the real route
// 422'd). Unlike ai-service-resolution-player-input.test.ts, this file does
// NOT mock '@/infrastructure/api': ai-service runs the real llmApiClient and
// only the network edge (fetch) is stubbed, so the captured JSON is the
// literal wire body. The server half posts the same fixture body through the
// real route (server-bun llm-generate-resolution-narration.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  buildDeathSaveNarrationPayload,
  buildNarrationGenerateBody,
} from '../../../shared/test-fixtures/death-save-narration-payload';
import { ContextBuilder } from '../ai/context-builder';
import { processDMResponse } from '../ai/dm-response-processor';
import { enforceNarrationContract } from '../ai/narration-contract-check';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';
import { SessionStateService } from '../session-state-service';

vi.mock('@/lib/auth-gate', () => ({
  waitForAuth: vi.fn().mockResolvedValue(undefined),
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

const fetchMock = vi.fn();

describe('AIService resolution-only wire body (#874, §4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ text: 'AI RAW Response' }),
      text: async () => '{"text":"AI RAW Response"}',
    });
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([]);
    vi.mocked(fetchSceneState).mockResolvedValue(null);
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(null);
    vi.mocked(ContextBuilder.build).mockResolvedValue('BASE_PROMPT');
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'Processed Text' } as any);
    vi.mocked(enforceNarrationContract).mockImplementation(async (raw: string) => raw);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs exactly the fixture body for a resolution-only death-save narration', async () => {
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
      conversationHistory: [
        {
          id: 'setup-1',
          role: 'assistant' as const,
          content: 'The horrors close in on the fallen cleric.',
          timestamp: new Date(),
        },
      ] as any,
    });

    const generateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/v1/llm/generate'),
    );
    expect(generateCalls).toHaveLength(1);
    const body = JSON.parse(generateCalls[0][1].body as string);

    // The whole body equals the fixture's body. prompt/systemPrompt/metrics
    // are assembled from session state, so the fixture builder receives the
    // captured values for those three; every other field — the field set,
    // maxTokens, temperature, provider, requestType, sessionId, and the
    // ABSENCE of player_input — must match the fixture exactly, or this fails.
    expect(body).toEqual(
      buildNarrationGenerateBody(payload, {
        includePlayerInput: false,
        prompt: body.prompt,
        systemPrompt: body.systemPrompt,
        metrics: body.metrics,
      }),
    );
    expect(body).not.toHaveProperty('player_input');
    // The payload still reaches the model, as the prompt's trailing block —
    // the exact shape the route's extract-from-prompt fallback reads.
    expect(body.prompt.endsWith(`<player_input>\n${payload}\n</player_input>`)).toBe(true);
    expect(typeof body.systemPrompt).toBe('string');
    expect(body.systemPrompt.length).toBeGreaterThan(0);
    // metrics is measurePromptSections output: numbers only (the route
    // schema rejects anything else).
    expect(Object.values(body.metrics).every((v) => typeof v === 'number')).toBe(true);
  });
});
