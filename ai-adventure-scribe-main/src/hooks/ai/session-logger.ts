/**
 * Session Logger
 *
 * Handles logging dice roll results and roll requests to
 * SessionStateService and RollManager. Extracted from use-ai-response.ts.
 */

import type { DiceRollContext } from './types';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';

import logger from '@/lib/logger';
import { RollManager } from '@/services/roll-manager';
import { SessionStateService } from '@/services/session-state-service';

/**
 * Log a structured dice roll result to session state and roll history.
 *
 * @param sessionId - Current game session ID
 * @param diceRoll - Structured dice roll context from the message
 */
export async function logDiceRollResult(
  sessionId: string,
  diceRoll: DiceRollContext,
): Promise<void> {
  await SessionStateService.appendRollEvent(sessionId, {
    kind: 'roll_result',
    payload: diceRoll,
  });
  await RollManager.recordRollResult({
    sessionId,
    kind: 'check',
    resultTotal: Number(diceRoll.total) || 0,
    resultNatural: typeof diceRoll.naturalRoll === 'number' ? diceRoll.naturalRoll : undefined,
    dc: diceRoll.dc,
    ac: diceRoll.ac,
    success: diceRoll.success,
    meta: {
      formula: diceRoll.formula,
      requestType: diceRoll.requestType,
      description: diceRoll.description,
      advantage: !!diceRoll.advantage,
      disadvantage: !!diceRoll.disadvantage,
      kept: diceRoll.keptResults,
      results: diceRoll.results,
    },
  });
}

/**
 * Parse a player's text message for an embedded roll total and log it.
 *
 * @param sessionId - Current game session ID
 * @param text - Player message text to parse
 */
export async function logTextRollResult(sessionId: string, text: string): Promise<void> {
  const lower = text.toLowerCase();
  let total: number | null = null;
  const patterns = [
    /\bi\s*rolled\s*(\d+)\b/,
    /rolled[^\d]*(\d+)\b/,
    /\btotal\s*[:=]\s*(\d+)\b/,
    /=\s*(\d+)\b/,
  ];
  for (const p of patterns) {
    const match = lower.match(p);
    if (match && match[1]) {
      total = parseInt(match[1], 10);
      break;
    }
  }
  if (total !== null && !Number.isNaN(total)) {
    await SessionStateService.appendRollEvent(sessionId, {
      kind: 'roll_result',
      payload: { total, raw: text },
    });
    await RollManager.recordRollResult({
      sessionId,
      kind: 'check',
      resultTotal: total,
      meta: { raw: text },
    });
  }
}

/**
 * Log dice roll information from an incoming player message.
 * Handles both structured dice rolls (from the dice UI) and
 * text-based roll mentions.
 *
 * @param sessionId - Current game session ID
 * @param latestMessage - The latest player message
 */
export async function logIncomingRolls(
  sessionId: string,
  latestMessage: ChatMessage,
): Promise<void> {
  try {
    const context = latestMessage.context;
    const diceRoll = context?.diceRoll as DiceRollContext | undefined;

    if (context?.intent === 'dice_roll' && diceRoll) {
      await logDiceRollResult(sessionId, diceRoll);
    } else if (typeof latestMessage.text === 'string') {
      await logTextRollResult(sessionId, latestMessage.text);
    }
  } catch (e) {
    logger.warn('Non-fatal: failed to append roll result log', e);
  }
}

/**
 * Log outgoing roll requests (from AI response) to session state
 * and durable roll history.
 *
 * @param sessionId - Current game session ID
 * @param rollRequests - Roll requests from the AI response
 */
export async function logRollRequests(
  sessionId: string,
  rollRequests: RollRequest[],
  signal?: AbortSignal,
): Promise<void> {
  if (rollRequests.length === 0 || signal?.aborted) return;

  logger.info(
    'Found',
    rollRequests.length,
    'roll requests in AI response (will process after message display)',
  );

  try {
    await SessionStateService.appendRollEvent(sessionId, {
      kind: 'roll_requests',
      payload: rollRequests,
    });
    if (signal?.aborted) return;

    const kindMap: Record<string, 'check' | 'save' | 'attack' | 'initiative' | 'damage'> = {
      check: 'check',
      save: 'save',
      attack: 'attack',
      initiative: 'initiative',
      damage: 'damage',
    };

    for (const rr of rollRequests) {
      if (signal?.aborted) return;
      const kind = kindMap[rr.type] || 'check';
      await RollManager.recordRollRequest({
        sessionId,
        kind,
        purpose: rr.purpose,
        formula: rr.formula,
        dc: typeof rr.dc === 'number' ? rr.dc : undefined,
        ac: typeof rr.ac === 'number' ? rr.ac : undefined,
        advantage: !!rr.advantage,
        disadvantage: !!rr.disadvantage,
      });
    }
  } catch (e) {
    logger.warn('Non-fatal: failed to append roll request log', e);
  }
}
