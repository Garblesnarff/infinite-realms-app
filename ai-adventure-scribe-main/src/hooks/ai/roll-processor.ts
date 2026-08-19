/**
 * Roll Processor
 *
 * Handles roll request parsing, deduplication, NPC auto-execution,
 * and attack/damage state tracking. Extracted from use-ai-response.ts.
 */

import type { ProcessedRolls } from './types';
import type { RollRequest } from '@/types/roll-request';

import logger from '@/lib/logger';
import {
  continueNarrativeWithNPCRolls,
  formatNPCRollsSystemMessage,
} from '@/services/ai/npc-roll-handler';
import { executeAllNPCRolls } from '@/services/combat/npc-auto-roller';
import { encounterParticipantsFromContext } from '@/services/combat/roll-routing';
import { rollStateManager } from '@/services/combat/rollStateManager';
import { DiceEngine } from '@/services/dice/DiceEngine';
import {
  parseRollRequests,
  detectsSuccessfulAttack,
  detectsCriticalHit,
} from '@/utils/rollRequestParser';

/** Maximum size of the processed-roll deduplication set before pruning. */
const MAX_PROCESSED_ROLLS = 100;
/** Number of entries to retain after pruning. */
const PRUNE_KEEP = 50;

/**
 * Prune the deduplication set when it exceeds MAX_PROCESSED_ROLLS.
 * Keeps the most recently added entries (rough LRU via insertion order).
 */
export function pruneProcessedSet(processedSet: Set<string>): void {
  if (processedSet.size > MAX_PROCESSED_ROLLS) {
    const entries = Array.from(processedSet);
    const toRemove = entries.slice(0, entries.length - PRUNE_KEEP);
    toRemove.forEach((key) => processedSet.delete(key));
    logger.debug(
      `[RollProcessor] Pruned processed roll set: removed ${toRemove.length}, kept ${processedSet.size}`,
    );
  }
}

/**
 * Parse roll requests from an AI response.
 * If the AI result already contains structured roll_requests, use those;
 * otherwise fall back to text parsing. Also detects successful attacks
 * and adds automatic damage roll requests when appropriate.
 *
 * @param responseText - The AI response text
 * @param existingRequests - Roll requests already provided by the AI result
 * @returns Parsed and augmented roll requests
 */
export function parseAndAugmentRollRequests(
  responseText: string,
  existingRequests: RollRequest[],
): RollRequest[] {
  let rollRequests = existingRequests.map((request) => ({
    ...request,
    // Keep target AC from the structured response just as the legacy parser
    // mapping below does. Attack resolution reads this value downstream.
    ac: request.ac,
  }));

  if (rollRequests.length === 0) {
    const parsedRequests = parseRollRequests(responseText);
    logger.info(`Parsed roll requests from DM text: ${parsedRequests.length}`);
    rollRequests = parsedRequests.map((req) => ({
      type: req.type,
      formula: req.formula,
      purpose: req.purpose,
      dc: req.dc,
      ac: req.ac,
      advantage: req.advantage,
      disadvantage: req.disadvantage,
    }));

    // Check for context-dependent damage rolls after successful attacks
    if (detectsSuccessfulAttack(responseText)) {
      logger.info('Detected successful attack, checking for damage roll requirement');
      const isCritical = detectsCriticalHit(responseText);

      if (rollStateManager.isAwaitingDamage()) {
        const awaitingRoll = rollStateManager.getAwaitingDamageRoll();
        if (awaitingRoll) {
          const weaponMatch = responseText.match(/(?:your|the)\s+(\w+)/i);
          const weaponName = weaponMatch ? weaponMatch[1] : 'weapon';
          const damageRequest = DiceEngine.createDamageRollRequest(weaponName, isCritical);

          rollRequests.push({
            type: 'damage',
            formula: damageRequest.formula,
            purpose: damageRequest.purpose,
          });

          logger.info('Added automatic damage roll request:', damageRequest);
        }
      }
    }
  }

  return rollRequests;
}

/**
 * Deduplicate roll requests against a set of previously processed signatures.
 * Mutates the processedSet by adding new signatures and pruning if needed.
 *
 * @param rollRequests - Roll requests to filter
 * @param processedSet - Set of already-processed request signatures
 * @returns Filtered roll requests (only new ones)
 */
export function deduplicateRollRequests(
  rollRequests: RollRequest[],
  processedSet: Set<string>,
): RollRequest[] {
  const originalCount = rollRequests.length;

  const filtered = rollRequests.filter((request) => {
    const signature = `${request.purpose}|${request.formula}|${request.dc ?? ''}|${request.ac ?? ''}`;
    if (processedSet.has(signature)) {
      logger.info('Skipping already-processed roll request:', signature);
      return false;
    }
    processedSet.add(signature);
    return true;
  });

  if (originalCount > 0 && filtered.length < originalCount) {
    logger.info(`Filtered ${originalCount - filtered.length} duplicate roll requests`);
  }

  // Prune the set if it's grown too large (memory leak fix)
  pruneProcessedSet(processedSet);

  return filtered;
}

/**
 * Process roll requests end-to-end:
 * 1. Parse/augment from AI text
 * 2. Deduplicate against previously seen requests
 * 3. Suppress if this is a dice-roll response (prevent infinite loop)
 * 4. Separate NPC rolls and auto-execute them
 * 5. Track attack rolls in rollStateManager
 *
 * @returns Processed rolls including player requests and NPC results
 */
export async function processRollRequests(params: {
  responseText: string;
  existingRequests: RollRequest[];
  isDiceRollMessage: boolean;
  processedSet: Set<string>;
  aiContext: Record<string, unknown>;
  sessionId: string;
  characterId: string;
}): Promise<ProcessedRolls> {
  const {
    responseText,
    existingRequests,
    isDiceRollMessage,
    processedSet,
    aiContext,
    sessionId,
    characterId,
  } = params;

  // Step 1: Parse and augment
  let rollRequests = parseAndAugmentRollRequests(responseText, existingRequests);

  // Step 2: Deduplicate
  rollRequests = deduplicateRollRequests(rollRequests, processedSet);

  // Step 3: Suppress all roll requests when responding to a dice result
  if (isDiceRollMessage && rollRequests.length > 0) {
    logger.info('Suppressing roll requests after dice result - waiting for player action');
    rollRequests = [];
  }

  // Step 4: Separate NPC rolls and auto-execute
  let npcRollResults: ProcessedRolls['npcRollResults'] = [];
  let npcRollContinuationText = '';

  if (rollRequests.length > 0) {
    const { npcRolls, playerRolls } = await executeAllNPCRolls(
      rollRequests,
      encounterParticipantsFromContext(aiContext),
    );
    npcRollResults = npcRolls;
    rollRequests = playerRolls;

    if (npcRolls.length > 0) {
      logger.info(`Auto-executed ${npcRolls.length} NPC rolls behind the screen`);
      const npcRollsMessage = formatNPCRollsSystemMessage(npcRolls);
      logger.info(`NPC Rolls Summary:\n${npcRollsMessage}`);

      try {
        const continuation = await continueNarrativeWithNPCRolls(npcRolls, aiContext, sessionId);
        if (continuation.success && continuation.narrative) {
          npcRollContinuationText = continuation.narrative;
          logger.info(
            `Received AI continuation narrative (${continuation.narrative.length} chars)`,
          );
        } else {
          logger.warn('AI continuation failed, using fallback');
        }
      } catch (error) {
        logger.error('Failed to get NPC roll continuation from AI:', error);
      }
    }
  }

  // Step 5: Track attack rolls in rollStateManager
  rollRequests.forEach((request) => {
    if (request.type === 'attack') {
      const rollId = rollStateManager.addPendingRoll({
        type: 'attack',
        targetAC: request.ac,
        context: request.purpose || 'Attack roll',
        actorId: characterId,
      });
      logger.info('Tracking attack roll:', rollId);
    }
  });

  return {
    playerRollRequests: rollRequests,
    npcRollResults,
    npcRollContinuationText,
  };
}
