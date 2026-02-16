/**
 * Game Phase Updater
 *
 * Handles combat detection and game phase transitions.
 * Extracted from use-ai-response.ts.
 */

import type { CombatDetectionResult } from '@/utils/combatDetection';

import logger from '@/lib/logger';

/**
 * Evaluate whether the game phase should change based on combat detection.
 * Transitions exploration -> combat when combat is detected, and
 * combat -> exploration when combat ends.
 *
 * @param params.combatDetection - Combat detection result from AI
 * @param params.currentPhase - Current game phase
 * @param params.isInCombat - Whether combat context is active
 * @param params.setGamePhase - Function to update the game phase
 */
export function updateGamePhase(params: {
  combatDetection: CombatDetectionResult | undefined;
  currentPhase: string;
  isInCombat: boolean;
  setGamePhase: (phase: string) => void;
}): void {
  const { combatDetection, currentPhase, isInCombat, setGamePhase } = params;

  if (!combatDetection) return;

  if (combatDetection.isCombat && currentPhase !== 'combat') {
    logger.info('Combat detected, updating game phase');
    setGamePhase('combat');
  } else if (!combatDetection.isCombat && currentPhase === 'combat' && !isInCombat) {
    logger.info('Combat ended, returning to exploration');
    setGamePhase('exploration');
  }
}

/**
 * Clamp combat intent flags to be mutually exclusive.
 * When both start and end are true, keep the one that makes
 * sense given the current combat state.
 *
 * @param shouldStart - Raw start-combat flag
 * @param shouldEnd - Raw end-combat flag
 * @param isInCombat - Whether combat context is currently active
 * @returns Clamped { shouldStartCombat, shouldEndCombat }
 */
export function clampCombatIntentFlags(
  shouldStart: boolean,
  shouldEnd: boolean,
  isInCombat: boolean,
): { shouldStartCombat: boolean; shouldEndCombat: boolean } {
  let startHint = shouldStart;
  let endHint = shouldEnd;

  if (startHint && endHint) {
    if (isInCombat) {
      startHint = false;
    } else {
      endHint = false;
    }
  }

  return { shouldStartCombat: startHint, shouldEndCombat: endHint };
}
