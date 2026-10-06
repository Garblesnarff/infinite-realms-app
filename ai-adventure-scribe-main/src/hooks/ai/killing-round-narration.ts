import type { AdvanceNpcTurnsResponse } from '@/services/user-data-api';
import type { ChatMessage } from '@/types/game';

import { buildAIContext } from '@/hooks/ai/ai-utils';
import { conversationHistoryFrom } from '@/hooks/ai/conversation-history';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { engineRosterOf } from '@/services/combat/combat-outcome-transcript';
import { dmFacingResolvedAction, ENGINE_FACT_NOTE } from '@/services/combat/dm-resolved-action';

/**
 * The paragraph for the round that killed the character (#2518, #2516 D2).
 *
 * When the enemy's turns end the fight before the player has declared anything, the death state
 * is shown from the engine's lines at once and no DM turn follows it — which left the biggest
 * beat of a run, the death, with no narration at all. This asks the DM for exactly that beat,
 * from the engine's results alone: nothing the player typed is sent, and the DM is told the
 * fight is over. It never throws: the end state does not wait on, or depend on, the DM.
 */
export async function narrateKillingRound(params: {
  npcTurns: AdvanceNpcTurnsResponse;
  participants: Parameters<typeof engineRosterOf>[0];
  sessionId: string;
  gameContext: {
    starterCampaignId?: string;
    currentSceneDescription?: string;
    campaign: unknown;
    character: unknown;
  };
  messages: ChatMessage[];
  userId?: string;
  userPlan?: Parameters<typeof AIService.chatWithDM>[0]['userPlan'];
  turnCount?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { npcTurns, participants, sessionId, gameContext, messages, signal } = params;
  const roster = engineRosterOf(participants);
  try {
    const aiContext = buildAIContext({
      sessionId,
      userId: params.userId,
      starterCampaignId: gameContext.starterCampaignId,
      currentSceneDescription: gameContext.currentSceneDescription,
      campaign: gameContext.campaign as Record<string, unknown>,
      character: gameContext.character as Record<string, unknown>,
      currentPhase: 'exploration',
      isInCombat: false,
      pendingRollsCount: 0,
    });
    const narration = await AIService.chatWithDM({
      message: JSON.stringify({
        authoritativeCombatResults: npcTurns.results.map((entry) => {
          const { transcriptLines: _printed, ...result } = entry;
          return dmFacingResolvedAction({ ...result, actorIsPlayer: false }, roster);
        }),
        authoritativeCombatResultsNote: ENGINE_FACT_NOTE,
        encounterAlreadyConcluded: true,
      }),
      context: { ...aiContext, gameState: { ...aiContext.gameState, resolutionOnly: true } },
      conversationHistory: conversationHistoryFrom(messages.slice(0, -1)),
      turnCount: params.turnCount,
      userPlan: params.userPlan,
      ...(signal ? { signal } : {}),
    });
    return narration?.text ?? '';
  } catch (error) {
    logger.warn('KILLING_ROUND_NARRATION_FAILED', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
