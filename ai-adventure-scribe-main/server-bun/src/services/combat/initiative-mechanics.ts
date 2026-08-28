/**
 * Initiative Mechanics Logic
 *
 * Extracted from CombatInitiativeService.
 * Handles pure D&D 5E initiative rules, calculations, and turn order logic.
 */

import type { CombatParticipant } from '../../../../db/schema/index';

export { rollD20 } from '../../lib/dice.js';

export class InitiativeMechanics {
  /**
   * Calculate initiative total
   */
  static calculateInitiative(roll: number, modifier: number): number {
    return roll + modifier;
  }

  /**
   * Sort participants by initiative (descending), then by modifier (descending) for ties
   */
  static sortParticipants<T extends { initiative: number; initiativeModifier: number }>(
    participants: T[],
  ): T[] {
    return [...participants].sort((a, b) => {
      if (b.initiative !== a.initiative) {
        return b.initiative - a.initiative;
      }
      return b.initiativeModifier - a.initiativeModifier;
    });
  }

  /**
   * Calculate next turn order and round
   */
  static calculateNextTurn(
    currentTurnOrder: number,
    totalParticipants: number,
    currentRound: number,
  ): {
    nextTurnOrder: number;
    newRound: boolean;
    newRoundNumber: number;
  } {
    if (totalParticipants === 0) {
      return {
        nextTurnOrder: 0,
        newRound: false,
        newRoundNumber: currentRound,
      };
    }

    // Preserve original logic from service exactly to ensure no functional change
    const nextTurnOrder = (currentTurnOrder + 1) % totalParticipants;
    const newRound = nextTurnOrder === 0 && currentTurnOrder !== 0;
    const newRoundNumber = newRound ? currentRound + 1 : currentRound;

    return {
      nextTurnOrder,
      newRound,
      newRoundNumber,
    };
  }

  /**
   * Map participant to turn order entry in combat state
   */
  static getTurnOrderEntries(
    activeParticipants: CombatParticipant[],
    currentTurnOrder: number,
    currentParticipantId: string | null,
  ) {
    return activeParticipants.map((participant, index) => ({
      participant,
      isCurrent: currentParticipantId === participant.id,
      hasGone: index < currentTurnOrder,
    }));
  }
}
