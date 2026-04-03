import { combatAuditSystem } from '../combat-audit';

import logger from '@/lib/logger';

export interface InitiativeEntry {
  actorId: string;
  actorName: string;
  initiative: number;
  dexModifier: number;
  isPlayer: boolean;
  hasActed: boolean;
}

export interface TurnOrder {
  combatId: string;
  entries: InitiativeEntry[];
  currentTurnIndex: number;
  round: number;
  isInitiativeComplete: boolean;
}

export class CombatTurnManager {
  private initiativeEntries: Map<string, InitiativeEntry[]> = new Map();
  private turnOrders: Map<string, TurnOrder> = new Map();
  private initiativeRolled: Set<string> = new Set();

  /**
   * Add an initiative entry for an actor
   */
  addInitiativeEntry(
    combatId: string,
    actorId: string,
    actorName: string,
    initiative: number,
    dexModifier: number,
    isPlayer: boolean = true,
  ): void {
    // Start audit for this combat if not already started
    if (!this.initiativeEntries.has(combatId)) {
      combatAuditSystem.startCombatAudit(combatId);
      this.initiativeEntries.set(combatId, []);
    }

    const entries = this.initiativeEntries.get(combatId)!;

    // Remove existing entry for this actor (in case of re-roll)
    const filteredEntries = entries.filter((e) => e.actorId !== actorId);

    filteredEntries.push({
      actorId,
      actorName,
      initiative,
      dexModifier,
      isPlayer,
      hasActed: false,
    });

    this.initiativeEntries.set(combatId, filteredEntries);

    // Record initiative action for audit
    combatAuditSystem.recordAction({
      combatId,
      actorId,
      actorName,
      actionType: 'initiative',
      phase: 'initiative',
      data: {
        formula: `1d20+${dexModifier}`,
        result: initiative,
        description: `Initiative roll: ${initiative} (dex modifier: ${dexModifier > 0 ? '+' : ''}${dexModifier})`,
      },
    });

    logger.info(`🎲 Initiative recorded for ${actorName}: ${initiative}`);
  }

  /**
   * Mark initiative as rolled and complete the initiative phase
   */
  completeInitiativePhase(combatId: string): TurnOrder | null {
    const entries = this.initiativeEntries.get(combatId);
    if (!entries || entries.length === 0) {
      return null;
    }

    // Sort by initiative (highest first), use dex modifier as tiebreaker
    const sortedEntries = [...entries].sort((a, b) => {
      if (a.initiative !== b.initiative) {
        return b.initiative - a.initiative; // Higher initiative goes first
      }
      return b.dexModifier - a.dexModifier; // Higher dex modifier wins ties
    });

    const turnOrder: TurnOrder = {
      combatId,
      entries: sortedEntries,
      currentTurnIndex: 0,
      round: 1,
      isInitiativeComplete: true,
    };

    this.turnOrders.set(combatId, turnOrder);
    this.initiativeRolled.add(combatId);
    logger.info(`⚔️ Turn order established for combat ${combatId}`);

    return turnOrder;
  }

  /**
   * Get current turn order for a combat
   */
  getTurnOrder(combatId: string): TurnOrder | null {
    return this.turnOrders.get(combatId) || null;
  }

  /**
   * Get whose turn it is currently
   */
  getCurrentActor(combatId: string): InitiativeEntry | null {
    const turnOrder = this.turnOrders.get(combatId);
    if (!turnOrder || !turnOrder.isInitiativeComplete) {
      return null;
    }

    return turnOrder.entries[turnOrder.currentTurnIndex] || null;
  }

  /**
   * Advance to the next turn
   */
  nextTurn(combatId: string): InitiativeEntry | null {
    const turnOrder = this.turnOrders.get(combatId);
    if (!turnOrder) return null;

    // Mark current actor as having acted
    if (turnOrder.entries[turnOrder.currentTurnIndex]) {
      turnOrder.entries[turnOrder.currentTurnIndex].hasActed = true;
    }

    // Move to next actor
    turnOrder.currentTurnIndex++;

    // If we've gone through everyone, start new round
    if (turnOrder.currentTurnIndex >= turnOrder.entries.length) {
      turnOrder.currentTurnIndex = 0;
      turnOrder.round++;

      // Reset hasActed for new round
      turnOrder.entries.forEach((entry) => (entry.hasActed = false));

      logger.info(`🔄 Round ${turnOrder.round} begins`);
    }

    const currentActor = turnOrder.entries[turnOrder.currentTurnIndex];
    logger.info(`👤 ${currentActor.actorName}'s turn (Round ${turnOrder.round})`);

    return currentActor;
  }

  /**
   * Check if all required initiative rolls are complete
   */
  isInitiativeComplete(combatId: string, expectedActors: string[]): boolean {
    const entries = this.initiativeEntries.get(combatId);
    if (!entries) return false;

    const rolledActors = new Set(entries.map((e) => e.actorId));
    return expectedActors.every((actorId) => rolledActors.has(actorId));
  }

  /**
   * Check if initiative has been rolled for a combat
   */
  hasInitiativeBeenRolled(combatId: string): boolean {
    return this.initiativeRolled.has(combatId);
  }

  /**
   * Clear all turn-related state
   */
  clearAllState(): void {
    this.initiativeEntries.clear();
    this.turnOrders.clear();
    this.initiativeRolled.clear();
  }

  /**
   * Clear state for a specific encounter
   */
  clearEncounterState(combatId: string): void {
    this.initiativeEntries.delete(combatId);
    this.turnOrders.delete(combatId);
    this.initiativeRolled.delete(combatId);
  }
}
