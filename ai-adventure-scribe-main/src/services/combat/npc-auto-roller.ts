/**
 * NPC Auto-Roller Service
 * Automatically executes dice rolls for NPCs/enemies "behind the screen"
 * without requiring player input
 */

import type { RollRequest } from '@/components/game/DiceRollRequest';
import { DiceEngine, type DiceRollResult } from '@/services/dice/DiceEngine';
import logger from '@/lib/logger';

export interface AutoRollResult {
  request: RollRequest;
  result: DiceRollResult;
  timestamp: Date;
}

/**
 * Auto-execute a dice roll for an NPC/enemy
 * Simulates "DM rolling behind the screen"
 *
 * @param request - Roll request with autoExecute flag set to true
 * @returns Auto-executed roll result with details
 * @throws Error if request doesn't have autoExecute flag
 */
export async function executeNPCRoll(request: RollRequest): Promise<AutoRollResult> {
  if (!request.autoExecute) {
    throw new Error('executeNPCRoll called on non-auto-execute roll request');
  }

  logger.info('[NPCAutoRoller] Auto-executing roll for NPC:', {
    actor: request.actorName,
    type: request.type,
    formula: request.formula,
    purpose: request.purpose,
  });

  try {
    // Execute the roll using DiceEngine
    const result = DiceEngine.roll(request.formula, {
      advantage: request.advantage,
      disadvantage: request.disadvantage,
      purpose: request.purpose,
      actorId: request.actorName,
      secret: true, // Mark as secret/DM roll
    });

    logger.info('[NPCAutoRoller] Roll executed:', {
      actor: request.actorName,
      result: result.total,
      naturalRoll: result.naturalRoll,
      critical: result.critical,
    });

    return {
      request,
      result,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error('[NPCAutoRoller] Failed to execute NPC roll:', error);
    throw error;
  }
}

/**
 * Execute all NPC rolls from a batch of roll requests
 * Separates player rolls from NPC rolls and auto-executes NPC rolls
 *
 * @param requests - Array of roll requests (mixed player and NPC)
 * @returns Object containing auto-executed NPC rolls and remaining player rolls
 */
export async function executeAllNPCRolls(
  requests: RollRequest[]
): Promise<{ npcRolls: AutoRollResult[]; playerRolls: RollRequest[] }> {
  const npcRolls: AutoRollResult[] = [];
  const playerRolls: RollRequest[] = [];

  logger.info('[NPCAutoRoller] Processing batch of roll requests:', {
    totalRequests: requests.length,
  });

  for (const request of requests) {
    if (request.autoExecute) {
      try {
        const result = await executeNPCRoll(request);
        npcRolls.push(result);
      } catch (error) {
        logger.error('[NPCAutoRoller] Failed to auto-execute NPC roll, skipping:', error);
        // Continue processing other rolls even if one fails
      }
    } else {
      playerRolls.push(request);
    }
  }

  logger.info('[NPCAutoRoller] Batch processing complete:', {
    npcRolls: npcRolls.length,
    playerRolls: playerRolls.length,
  });

  return { npcRolls, playerRolls };
}

/**
 * Format NPC roll result for display in chat
 * Creates a narrative description of the roll outcome
 *
 * @param autoRoll - Auto-executed roll result
 * @returns Formatted string for chat display
 */
export function formatNPCRollResult(autoRoll: AutoRollResult): string {
  const { request, result } = autoRoll;
  const actorName = request.actorName || 'Enemy';

  // Format based on roll type
  switch (request.type) {
    case 'attack': {
      const hitOrMiss = request.ac
        ? result.total >= request.ac
          ? `**hits** (AC ${request.ac})`
          : `**misses** (AC ${request.ac})`
        : '';

      const criticalText = result.critical
        ? ' **CRITICAL HIT!**'
        : result.naturalRoll === 1
        ? ' **Critical Miss!**'
        : '';

      return `🎲 ${actorName} ${request.purpose}: **${result.total}** ${hitOrMiss}${criticalText}`;
    }

    case 'damage': {
      return `🎲 ${actorName} ${request.purpose}: **${result.total}** damage`;
    }

    case 'save': {
      const successOrFail = request.dc
        ? result.total >= request.dc
          ? '**succeeds**'
          : '**fails**'
        : '';

      return `🎲 ${actorName} ${request.purpose}: **${result.total}** ${successOrFail}${request.dc ? ` (DC ${request.dc})` : ''}`;
    }

    case 'initiative': {
      return `🎲 ${actorName} Initiative: **${result.total}**`;
    }

    default: {
      return `🎲 ${actorName} ${request.purpose}: **${result.total}**`;
    }
  }
}

/**
 * Check if a roll result hits the target AC
 *
 * @param result - Auto-executed attack roll result
 * @returns True if attack hits, false otherwise
 */
export function isAttackHit(result: AutoRollResult): boolean {
  if (result.request.type !== 'attack' || !result.request.ac) {
    return false;
  }

  return result.result.total >= result.request.ac;
}

/**
 * Check if a roll result passes the DC
 *
 * @param result - Auto-executed save/check roll result
 * @returns True if roll meets or exceeds DC, false otherwise
 */
export function isCheckSuccess(result: AutoRollResult): boolean {
  if (!result.request.dc) {
    return false;
  }

  return result.result.total >= result.request.dc;
}
