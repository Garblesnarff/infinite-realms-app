/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { formatDiceRoll } from '../../features/game-session/components/chat/message-list/utils/dice-roll-formatter';
import { ContextBuilder } from '../ai/context-builder';
import { processDMResponse } from '../ai/dm-response-processor';
import { CampaignContextPrompts } from '../ai/prompts/campaign-context-prompts';
import { resolveStarterCampaignId } from '../ai/prompts/game-context-prompts';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';
import { SessionStateService } from '../session-state-service';

import { conversationHistoryFrom } from '@/hooks/ai/conversation-history';
import { llmApiClient } from '@/infrastructure/api';

// Mock dependencies (mirrors ai-service.test.ts so chatWithDM runs offline)
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
  },
}));

vi.mock('../memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn(),
    saveMemories: vi.fn(),
    extractMemories: vi.fn(),
  },
}));

vi.mock('../ai/context-builder', () => ({
  ContextBuilder: {
    build: vi.fn(),
  },
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

vi.mock('../ai/prompts/campaign-context-prompts', () => ({
  CampaignContextPrompts: {
    fetchStarterCampaignLore: vi.fn(),
    extractSceneEntityNames: vi.fn(),
    renderStarterCampaignLore: vi.fn(),
  },
}));

vi.mock('../ai/prompts/game-context-prompts', () => ({
  resolveStarterCampaignId: vi.fn(),
}));

vi.mock('../narrative/scene-state-client', () => ({
  fetchSceneState: vi.fn(),
}));

vi.mock('../session-state-service', () => ({
  SessionStateService: {
    getLatestRollOutcome: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * #2609: the roll-outcome gate opens from the roll itself (the dice-UI send
 * path's `isDiceRollMessage` flag), not from ✓/✗ glyphs in the message text,
 * and a stale outcome — older than the latest DM reply — never reaches the DM.
 */
describe('AIService chatWithDM roll-outcome gate (#2609)', () => {
  /** Real producer fixture: the dice UI formats the player message with formatDiceRoll. */
  const diceRollRequest: any = {
    id: 'roll-2609-1',
    requestType: 'skill_check',
    description: 'Athletics Check',
    rollConfig: { dieType: 20, count: 1, modifier: 3 },
    timestamp: new Date('2026-10-05T17:00:00.000Z'),
    status: 'completed',
    result: {
      dieType: 20,
      count: 1,
      modifier: 3,
      results: [10],
      keptResults: [10],
      total: 13,
      naturalRoll: 10,
    },
    dc: 15,
  };
  const diceRollMessage = formatDiceRoll(diceRollRequest);

  const dmReplyAt = '2026-10-05T17:00:00.000Z';
  const freshOutcomeAt = '2026-10-05T17:00:42.000Z';
  const staleOutcomeAt = '2026-10-05T16:30:00.000Z';

  const freshOutcome = {
    success: false,
    total: 13,
    dc: 15,
    requestType: 'skill_check',
    description: 'Athletics Check',
    timestamp: freshOutcomeAt,
  };
  const staleOutcome = { ...freshOutcome, timestamp: staleOutcomeAt };

  // Service ChatMessage shape (what chatWithDM actually receives): the DM's
  // reply carries speakerType 'dm' and a Date timestamp.
  const dmReplyHistory = [
    {
      id: 'd1',
      role: 'assistant',
      content: 'The ledge is slick. Make an Athletics check.',
      timestamp: new Date(dmReplyAt),
      speakerType: 'dm',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchSceneState).mockResolvedValue(null);
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(null);
    vi.mocked(CampaignContextPrompts.fetchStarterCampaignLore).mockResolvedValue(null);
    vi.mocked(CampaignContextPrompts.extractSceneEntityNames).mockReturnValue([]);
    vi.mocked(CampaignContextPrompts.renderStarterCampaignLore).mockReturnValue({
      section: '',
      sectionTokens: 0,
      canonCut: false,
      keptEntities: 0,
      droppedEntities: 0,
    });
    vi.mocked(resolveStarterCampaignId).mockReturnValue(undefined);
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([]);
    vi.mocked(ContextBuilder.build).mockResolvedValue('Build prompt');
    vi.mocked(llmApiClient.generateText).mockResolvedValue('AI RAW Response');
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'Processed Text' } as any);
  });

  it('the fixture is real formatDiceRoll output with words, not glyphs', () => {
    expect(diceRollMessage).toBe('Athletics Check: 13 (nat 10+3) fail');
    expect(diceRollMessage).not.toMatch(/[✓✗]/u);
  });

  it('a dice-UI roll opens the gate: getLatestRollOutcome is called and lastRollOutcome is sent', async () => {
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(freshOutcome as any);

    await AIService.chatWithDM({
      message: diceRollMessage,
      context: { sessionId: 'roll-gate-dice-ui', campaignId: 'campaign-456' } as any,
      conversationHistory: dmReplyHistory as any,
      isDiceRollMessage: true,
    } as any);

    expect(SessionStateService.getLatestRollOutcome).toHaveBeenCalledWith('roll-gate-dice-ui');
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"lastRollOutcome"'),
      }),
    );
  });

  it('a typed roll mention does not open the gate', async () => {
    await AIService.chatWithDM({
      message: 'I rolled 17',
      context: { sessionId: 'roll-gate-typed', campaignId: 'campaign-456' } as any,
      conversationHistory: [],
    } as any);

    expect(SessionStateService.getLatestRollOutcome).not.toHaveBeenCalled();
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining('lastRollOutcome'),
      }),
    );
  });

  it('an outcome older than the latest DM reply is dropped', async () => {
    // The gate opens on main via the retired headless writer's ✓ glyph and on
    // the fixed code via the flag; either way the bound must drop the stale
    // outcome. On main this test fails: the stale outcome is sent.
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(staleOutcome as any);

    await AIService.chatWithDM({
      message: `${diceRollMessage} ✓`,
      context: { sessionId: 'roll-gate-stale', campaignId: 'campaign-456' } as any,
      conversationHistory: dmReplyHistory as any,
      isDiceRollMessage: true,
    } as any);

    expect(SessionStateService.getLatestRollOutcome).toHaveBeenCalledWith('roll-gate-stale');
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining('lastRollOutcome'),
      }),
    );
  });

  it('an outcome with no DM reply in history is kept: the flag gate stands alone', async () => {
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(freshOutcome as any);

    await AIService.chatWithDM({
      message: diceRollMessage,
      context: { sessionId: 'roll-gate-no-history', campaignId: 'campaign-456' } as any,
      conversationHistory: [],
      isDiceRollMessage: true,
    } as any);

    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"lastRollOutcome"'),
      }),
    );
  });

  it('the bound reads the real producer history: conversationHistoryFrom keeps source timestamps', async () => {
    // End-to-end through the real history producer: game messages in,
    // service messages out. A fresh outcome (newer than the DM reply) is
    // kept; a stale one (older) is dropped.
    const history = conversationHistoryFrom([
      {
        id: 'd1',
        sender: 'dm',
        text: 'The ledge is slick. Make an Athletics check.',
        timestamp: dmReplyAt,
      },
    ] as any);
    expect(history[0].speakerType).toBe('dm');
    expect(history[0].timestamp).toEqual(new Date(dmReplyAt));

    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(freshOutcome as any);
    await AIService.chatWithDM({
      message: diceRollMessage,
      context: { sessionId: 'roll-gate-producer-fresh', campaignId: 'campaign-456' } as any,
      conversationHistory: history as any,
      isDiceRollMessage: true,
    } as any);
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"lastRollOutcome"'),
      }),
    );

    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(staleOutcome as any);
    await AIService.chatWithDM({
      message: diceRollMessage,
      context: { sessionId: 'roll-gate-producer-stale', campaignId: 'campaign-456' } as any,
      conversationHistory: history as any,
      isDiceRollMessage: true,
    } as any);
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining('lastRollOutcome'),
      }),
    );
  });
});
