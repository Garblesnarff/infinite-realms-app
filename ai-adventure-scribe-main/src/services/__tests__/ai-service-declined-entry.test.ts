/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  DECLARED_ATTACK_PLAYER_INPUT,
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
  declinedTurnBody,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { ContextBuilder } from '../ai/context-builder';
import { processDMResponse } from '../ai/dm-response-processor';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';

import { llmApiClient } from '@/infrastructure/api';

/**
 * #2341: after "Do something else" the DM is called with a note that the attack did not happen,
 * and without `combatEntry`. With it the server would detect the same attack, ask the DM to
 * telegraph it, and hand the popup back to a player who just said no.
 */

vi.mock('@/infrastructure/api', () => ({ llmApiClient: { generateText: vi.fn() } }));
vi.mock('../memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn(), saveMemories: vi.fn(), extractMemories: vi.fn() },
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

const sentBody = () => vi.mocked(llmApiClient.generateText).mock.calls.at(-1)![0] as any;

// In-flight calls are de-duplicated by session, message and history length; each case gets a
// history of its own so the message can stay exactly what the player typed.
let turn = 0;
const chat = (gameState: Record<string, unknown>) =>
  AIService.chatWithDM({
    message: DECLARED_ATTACK_PLAYER_INPUT,
    context: {
      sessionId: DECLARED_ATTACK_SESSION_ID,
      campaignId: 'campaign-456',
      characterDetails: declaredAttackCharacter,
      gameState,
    },
    conversationHistory: Array.from({ length: (turn += 1) }, (_, index) => ({
      id: `history-${index}`,
      role: 'assistant' as const,
      content: 'The corridor twists.',
      timestamp: new Date(),
    })),
  } as any);

describe('the DM turn after a declined combat entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue([] as any);
    vi.mocked(ContextBuilder.build).mockResolvedValue('CAMPAIGN AND CANON');
    vi.mocked(fetchSceneState).mockResolvedValue(null as any);
    vi.mocked(llmApiClient.generateText).mockResolvedValue('RAW');
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'narration' } as any);
  });

  it('sends the session and the words, no combatEntry, and tells the DM nothing happened', async () => {
    await chat({
      isInCombat: false,
      combatEntryDeclined: 'the spell Chill Touch against Valerius',
    });

    const body = sentBody();
    expect(body).toEqual(expect.objectContaining({ sessionId: declinedTurnBody.sessionId }));
    expect(body.player_input).toBe(declinedTurnBody.player_input);
    expect(body.combatEntry).toBeUndefined();
    expect(body.prompt).toContain(
      "The player's message named the spell Chill Touch against Valerius, but the player chose not to strike.",
    );
    expect(body.prompt).toContain('No attack, spell, or roll happened this turn');
  });

  it('still sends combatEntry on an ordinary out-of-combat turn, with no note', async () => {
    await chat({ isInCombat: false });

    const body = sentBody();
    expect(body.combatEntry).toMatchObject({ sessionId: DECLARED_ATTACK_SESSION_ID });
    expect(body.prompt).not.toContain('chose not to strike');
  });
});
