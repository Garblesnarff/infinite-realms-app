/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ContextBuilder } from '../ai/context-builder';
import { processDMResponse } from '../ai/dm-response-processor';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';

import { llmApiClient } from '@/infrastructure/api';

/**
 * The board reaches the model, and the metric says so.
 *
 * A 2026-08-10 investigation concluded from production `[PromptMetrics]` lines that the
 * tactical digest "never reached the model", because no `tactical` key had ever appeared in
 * one. The digest was in fact being assembled and sent on every combat turn — its ~450 tokens
 * were simply summed into `scene_state` alongside the ledger block, so the section had no name
 * of its own and its presence was unfalsifiable from the outside.
 *
 * These tests pin both halves so that conclusion can never be drawn from absence again: the
 * block is in the prompt when combat is active, it is measured under its own key, and both
 * disappear together when it is not.
 */

vi.mock('@/infrastructure/api', () => ({ llmApiClient: { generateText: vi.fn() } }));
vi.mock('../memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn(),
    saveMemories: vi.fn(),
    extractMemories: vi.fn(),
  },
}));
vi.mock('../ai/context-builder', () => ({ ContextBuilder: { build: vi.fn() } }));
vi.mock('../ai/dm-response-processor', () => ({ processDMResponse: vi.fn() }));
vi.mock('@/utils/combatDetection', () => ({ detectCombatFromText: vi.fn() }));
vi.mock('../ai/campaign-generator', () => ({
  generateCampaignDescription: vi.fn(),
  generateCampaignName: vi.fn(),
}));
vi.mock('../narrative/scene-state-client', () => ({ fetchSceneState: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/** A digest shaped like the real one: ACTIVE line, turn order, action economy, HP. */
const TACTICAL_DIGEST = [
  'TACTICAL DIGEST',
  'ACTIVE sentient-glaze',
  'the-seeker|The Seeker@2,4 mv30/30 vs[sentient-glaze:25ft/LoS/c0/range]',
  'sentient-glaze|Sentient Glaze@8,5 mv30/30 vs[the-seeker:25ft/LoS/c0/range]',
  '<turn_order round="1">',
  '  1. the-seeker | The Seeker | 11/11 HP | action:SPENT',
  '→ 2. sentient-glaze | Sentient Glaze | 11/11 HP | action:available | CURRENT TURN',
  '</turn_order>',
].join('\n');

const lastPrompt = (): string =>
  (vi.mocked(llmApiClient.generateText).mock.calls.at(-1)![0] as { prompt: string }).prompt;
const lastMetrics = (): Record<string, number> =>
  (
    vi.mocked(llmApiClient.generateText).mock.calls.at(-1)![0] as {
      metrics: Record<string, number>;
    }
  ).metrics;

// `chatWithDM` de-duplicates in-flight calls by session+message, so every case needs a message
// of its own -- otherwise the second call resolves from the first's promise and never reaches
// `llmApiClient.generateText` at all, leaving `mock.calls` empty.
let turn = 0;
const chat = async (gameState: Record<string, unknown>) =>
  AIService.chatWithDM({
    message: `The glaze surges forward. (turn ${(turn += 1)})`,
    context: { sessionId: 'session-123', campaignId: 'campaign-456', gameState },
    conversationHistory: [],
  } as any);

describe('tactical context in the DM prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([] as any);
    vi.mocked(ContextBuilder.build).mockResolvedValue('CAMPAIGN AND CANON');
    vi.mocked(fetchSceneState).mockResolvedValue(null as any);
    vi.mocked(llmApiClient.generateText).mockResolvedValue('RAW');
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'narration' } as any);
  });

  describe('while combat is active', () => {
    it('wraps the digest in <tactical_context> and sends it to the model', async () => {
      await chat({ isInCombat: true, tacticalContext: TACTICAL_DIGEST });

      const prompt = lastPrompt();
      expect(prompt).toContain('<tactical_context>');
      expect(prompt).toContain('</tactical_context>');
      // Everything the DM needs to sequence a turn, not merely to place a token.
      expect(prompt).toContain('ACTIVE sentient-glaze');
      expect(prompt).toContain('<turn_order round="1">');
      expect(prompt).toContain('CURRENT TURN');
      expect(prompt).toContain('action:SPENT');
      expect(prompt).toContain('11/11 HP');
      expect(prompt).toContain('the-seeker');
    });

    it('measures it under its own `tactical` key, not folded into scene_state', async () => {
      await chat({ isInCombat: true, tacticalContext: TACTICAL_DIGEST });

      const metrics = lastMetrics();
      expect(metrics).toHaveProperty('tactical');
      expect(metrics.tactical).toBeGreaterThan(0);
      // The exact fold that made a present digest look absent for the whole of 2026-08-10.
      expect(metrics.scene_state).toBe(0);
      expect(metrics.total).toBeGreaterThanOrEqual(metrics.tactical);
    });

    it('keeps the ledger block measurable separately when both are present', async () => {
      vi.mocked(fetchSceneState).mockResolvedValue(
        '<scene_state>the hall is flooded</scene_state>',
      );
      await chat({ isInCombat: true, tacticalContext: TACTICAL_DIGEST });

      const metrics = lastMetrics();
      expect(metrics.tactical).toBeGreaterThan(0);
      expect(metrics.scene_state).toBeGreaterThan(0);
      expect(lastPrompt()).toContain('the hall is flooded');
    });
  });

  describe('outside combat', () => {
    it('emits no <tactical_context> block and a zero `tactical` measurement', async () => {
      await chat({ isInCombat: false });

      expect(lastPrompt()).not.toContain('<tactical_context>');
      // The key is always present so its value is a measurement rather than a silence; a
      // missing key and a zero key are different claims, and only one of them is falsifiable.
      expect(lastMetrics()).toHaveProperty('tactical');
      expect(lastMetrics().tactical).toBe(0);
    });
  });
});
