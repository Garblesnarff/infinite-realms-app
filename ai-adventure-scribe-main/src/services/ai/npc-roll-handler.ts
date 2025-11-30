/**
 * NPC Roll Handler
 * Handles continuation of AI narrative after NPC rolls are auto-executed
 */

import type { AutoRollResult } from '@/services/combat/npc-auto-roller';
import { AIService } from '@/services/ai-service';
import logger from '@/lib/logger';

export interface NPCRollContinuationResult {
  narrative: string;
  success: boolean;
  error?: string;
}

/**
 * Send auto-executed NPC roll results back to AI DM for narrative continuation
 * The AI will receive the roll outcomes and narrate what happens next
 *
 * @param rolls - Array of auto-executed NPC roll results
 * @param aiContext - AI context from the current session
 * @param sessionId - Current game session ID
 * @returns AI DM's narrative response based on roll outcomes
 */
export async function continueNarrativeWithNPCRolls(
  rolls: AutoRollResult[],
  aiContext: any,
  sessionId: string
): Promise<NPCRollContinuationResult> {
  if (rolls.length === 0) {
    return {
      narrative: '',
      success: true,
    };
  }

  logger.info('[NPCRollHandler] Sending NPC roll results to AI for narrative continuation:', {
    rollCount: rolls.length,
    sessionId,
  });

  try {
    // Format roll results for AI comprehension
    const rollSummary = rolls.map((r) => {
      const { request, result } = r;

      return {
        actor: request.actorName || 'NPC',
        action: request.purpose,
        rollType: request.type,
        formula: request.formula,
        result: result.total,
        naturalRoll: result.naturalRoll,
        breakdown: result.rolls.map((die) => `d${die.dice}:${die.value}`).join(', '),
        critical: result.critical,
        // Hit/miss info for attacks
        ...(request.type === 'attack' && request.ac
          ? {
              targetAC: request.ac,
              hitOrMiss: result.total >= request.ac ? 'HIT' : 'MISS',
            }
          : {}),
        // Success/fail info for saves/checks
        ...(request.dc
          ? {
              targetDC: request.dc,
              successOrFail: result.total >= request.dc ? 'SUCCESS' : 'FAIL',
            }
          : {}),
      };
    });

    // Create continuation prompt for AI
    const continuationMessage = `
**NPC ROLL RESULTS (Auto-Executed Behind the Screen)**

The following NPC actions have been rolled:

${rollSummary
  .map((r, i) => {
    let line = `${i + 1}. **${r.actor}** ${r.action}:`;
    line += `\n   - Rolled: ${r.result}`;
    if (r.naturalRoll) line += ` (natural ${r.naturalRoll})`;
    if (r.critical) line += ' **CRITICAL!**';
    if (r.hitOrMiss) line += `\n   - vs AC ${r.targetAC}: **${r.hitOrMiss}**`;
    if (r.successOrFail) line += `\n   - vs DC ${r.targetDC}: **${r.successOrFail}**`;
    line += `\n   - Breakdown: ${r.breakdown}`;
    return line;
  })
  .join('\n\n')}

**INSTRUCTIONS:**
1. Narrate the outcome of these NPC actions based on the roll results
2. Describe what happens to the player/party as a result
3. DO NOT request any more rolls for these actions - they are complete
4. After narrating the results, determine what happens next in initiative order
5. If it's now a player's turn, prompt them for their action

Narrate the scene:`.trim();

    logger.info('[NPCRollHandler] Continuation prompt:', continuationMessage);

    // Call AI with continuation prompt
    const result = await AIService.chatWithDM({
      message: continuationMessage,
      context: {
        ...aiContext,
        systemInstruction: 'NPC_ROLL_CONTINUATION',
        npcRollResults: rollSummary,
      },
      sessionId,
      options: {
        includeMemory: false, // Don't pull memories for roll continuation
        includeVoiceContext: false, // Voice not needed for continuation
      },
    });

    const narrative = result.text || result.response || '';

    logger.info('[NPCRollHandler] AI narrative continuation received:', {
      narrativeLength: narrative.length,
      rollsProcessed: rolls.length,
    });

    return {
      narrative,
      success: true,
    };
  } catch (error) {
    logger.error('[NPCRollHandler] Failed to get AI narrative continuation:', error);

    // Return a fallback narrative
    const fallbackNarrative = rolls
      .map((r) => {
        const { request, result } = r;
        const actor = request.actorName || 'The enemy';

        if (request.type === 'attack' && request.ac) {
          const hitOrMiss = result.total >= request.ac ? 'hits' : 'misses';
          return `${actor} attacks (rolled ${result.total}) and ${hitOrMiss}!`;
        } else if (request.type === 'damage') {
          return `${actor} deals ${result.total} damage!`;
        } else {
          return `${actor} rolls ${result.total} for ${request.purpose}.`;
        }
      })
      .join(' ');

    return {
      narrative: fallbackNarrative,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Format NPC roll results as a system message for chat display
 * This creates a summary message showing all auto-executed rolls
 *
 * @param rolls - Array of auto-executed NPC roll results
 * @returns Formatted message string for display
 */
export function formatNPCRollsSystemMessage(rolls: AutoRollResult[]): string {
  if (rolls.length === 0) return '';

  const header = `🎲 **Behind the Screen** (${rolls.length} NPC ${rolls.length === 1 ? 'roll' : 'rolls'})`;

  const rollLines = rolls.map((r) => {
    const { request, result } = r;
    const actor = request.actorName || 'NPC';

    let line = `• **${actor}** ${request.purpose}: ${result.total}`;

    if (result.critical) {
      line += ' **CRITICAL!**';
    } else if (result.naturalRoll === 1) {
      line += ' **Fumble!**';
    }

    if (request.type === 'attack' && request.ac) {
      const hitOrMiss = result.total >= request.ac ? '**hits**' : 'misses';
      line += ` (${hitOrMiss} AC ${request.ac})`;
    } else if (request.dc) {
      const successFail = result.total >= request.dc ? '**succeeds**' : 'fails';
      line += ` (${successFail} DC ${request.dc})`;
    }

    return line;
  });

  return `${header}\n${rollLines.join('\n')}`;
}
