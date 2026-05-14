/**
 * Combat Sequence Validator
 * Enforces proper D&D 5e combat mechanics and sequencing
 * Now integrated with CombatAuditSystem for rule compliance tracking
 */

import { combatAuditSystem } from '../combat-audit';
import {
  CombatResponseValidator,
  type CombatValidationError,
  type CombatValidationResult,
  type CombatStateProvider,
} from './CombatResponseValidator';
import { CombatActionTracker } from './CombatActionTracker';
import { CombatTurnManager, type InitiativeEntry, type TurnOrder } from './CombatTurnManager';

import logger from '@/lib/logger';

export type { InitiativeEntry, TurnOrder, CombatValidationError, CombatValidationResult };

export interface CombatPhase {
  phase: 'pre-combat' | 'initiative' | 'attack' | 'damage' | 'resolution';
  timestamp: number;
  actorId: string;
  context: string;
}

// TTL for combat state cleanup (4 hours)
const COMBAT_STATE_TTL_MS = 4 * 60 * 60 * 1000;
// Minimum interval between cleanup sweeps (5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class CombatSequenceValidator implements CombatStateProvider {
  private static instance: CombatSequenceValidator;
  private turnManager: CombatTurnManager = new CombatTurnManager();
  private actionTracker: CombatActionTracker = new CombatActionTracker();
  private responseValidator: CombatResponseValidator;
  private combatPhases: Map<string, CombatPhase[]> = new Map();
  private activeCombats: Set<string> = new Set();
  private lastActivityTimestamp: Map<string, number> = new Map();
  private lastCleanupAt = 0;

  private constructor() {
    this.responseValidator = new CombatResponseValidator(this);
  }

  static getInstance(): CombatSequenceValidator {
    if (!CombatSequenceValidator.instance) {
      CombatSequenceValidator.instance = new CombatSequenceValidator();
    }
    return CombatSequenceValidator.instance;
  }

  /**
   * Mark the start of a new combat encounter
   */
  startCombat(combatId: string): void {
    this.activeCombats.add(combatId);
    this.combatPhases.set(combatId, []);
    this.turnManager.clearEncounterState(combatId);
    this.lastActivityTimestamp.set(combatId, Date.now());
    logger.info(`🗡️ Combat ${combatId} started - initiative required`);
  }

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
    // Mark combat as active when first initiative entry is added
    this.activeCombats.add(combatId);
    this.lastActivityTimestamp.set(combatId, Date.now());

    this.turnManager.addInitiativeEntry(
      combatId,
      actorId,
      actorName,
      initiative,
      dexModifier,
      isPlayer,
    );
    this.addPhase(combatId, 'initiative', actorId, `Initiative: ${initiative}`);
  }

  /**
   * Mark initiative as rolled and complete the initiative phase
   */
  completeInitiativePhase(combatId: string): TurnOrder | null {
    return this.turnManager.completeInitiativePhase(combatId);
  }

  /**
   * Get current turn order for a combat
   */
  getTurnOrder(combatId: string): TurnOrder | null {
    return this.turnManager.getTurnOrder(combatId);
  }

  /**
   * Get whose turn it is currently
   */
  getCurrentActor(combatId: string): InitiativeEntry | null {
    return this.turnManager.getCurrentActor(combatId);
  }

  /**
   * Advance to the next turn
   */
  nextTurn(combatId: string): InitiativeEntry | null {
    return this.turnManager.nextTurn(combatId);
  }

  /**
   * Check if all required initiative rolls are complete
   */
  isInitiativeComplete(combatId: string, expectedActors: string[]): boolean {
    return this.turnManager.isInitiativeComplete(combatId, expectedActors);
  }

  /**
   * Record an attack roll request
   */
  recordAttackRequest(
    combatId: string,
    actorId: string,
    weaponName: string,
    targetAC?: number,
  ): string {
    const attackId = this.actionTracker.recordAttackRequest(
      combatId,
      actorId,
      weaponName,
      targetAC,
    );
    this.addPhase(combatId, 'attack', actorId, `Attack with ${weaponName}`);
    return attackId;
  }

  /**
   * Record an attack roll result
   */
  recordAttackResult(
    attackId: string,
    result: number,
    targetAC?: number,
    actorId?: string,
    actorName?: string,
  ): boolean {
    return this.actionTracker.recordAttackResult(attackId, result, targetAC, actorId, actorName);
  }

  /**
   * Record damage roll
   */
  recordDamageRoll(
    attackId: string,
    damage: number,
    formula?: string,
    actorId?: string,
    actorName?: string,
  ): void {
    this.actionTracker.recordDamageRoll(attackId, damage, formula, actorId, actorName);
  }

  /**
   * Validate a DM response for combat rule compliance
   */
  validateDMResponse(response: string, combatId?: string): CombatValidationResult {
    this.cleanupStaleState();

    if (combatId) {
      this.lastActivityTimestamp.set(combatId, Date.now());
    }

    return this.responseValidator.validate(response, combatId);
  }

  /**
   * Get suggested correction for common errors
   */
  getSuggestion(response: string, combatId?: string): string | null {
    const validation = this.validateDMResponse(response, combatId);

    if (validation.errors.length > 0) {
      const primaryError = validation.errors[0];
      return primaryError.suggestion;
    }

    return null;
  }

  /**
   * Check if combat is awaiting damage roll
   */
  isAwaitingDamage(combatId?: string): boolean {
    return this.actionTracker.isAwaitingDamage(combatId);
  }

  /**
   * Get awaiting damage info
   */
  getAwaitingDamage(combatId?: string): { weaponName: string; isCritical: boolean } | null {
    return this.actionTracker.getAwaitingDamage(combatId);
  }

  // CombatStateProvider implementation
  hasPendingAttack(combatId?: string): boolean {
    return this.actionTracker.hasPendingAttack(combatId);
  }

  hasInitiativeBeenRolled(combatId: string): boolean {
    return this.turnManager.hasInitiativeBeenRolled(combatId);
  }

  isInitiativePhaseComplete(combatId: string): boolean {
    const turnOrder = this.turnManager.getTurnOrder(combatId);
    return !!turnOrder?.isInitiativeComplete;
  }

  // Private helper methods
  private addPhase(
    combatId: string,
    phase: CombatPhase['phase'],
    actorId: string,
    context: string,
  ): void {
    const phases = this.combatPhases.get(combatId) || [];
    phases.push({
      phase,
      timestamp: Date.now(),
      actorId,
      context,
    });
    this.combatPhases.set(combatId, phases);
  }

  /**
   * Remove state for combats that have been inactive longer than COMBAT_STATE_TTL_MS.
   * Called periodically from validateDMResponse to prevent unbounded memory growth.
   */
  private cleanupStaleState(): void {
    const now = Date.now();

    // Throttle cleanup to avoid running on every call
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastCleanupAt = now;

    let cleanedCount = 0;

    for (const [combatId, lastActivity] of this.lastActivityTimestamp) {
      if (now - lastActivity > COMBAT_STATE_TTL_MS) {
        this.activeCombats.delete(combatId);
        this.turnManager.clearEncounterState(combatId);
        this.combatPhases.delete(combatId);
        this.lastActivityTimestamp.delete(combatId);

        // Clean up action state for this combat
        this.actionTracker.clearActionState(combatId);

        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`🧹 Cleaned up ${cleanedCount} stale combat state(s)`);
    }
  }

  /**
   * Clear all state for testing
   */
  clearAllState(): void {
    this.combatPhases.clear();
    this.activeCombats.clear();
    this.turnManager.clearAllState();
    this.actionTracker.clearAllState();
    this.lastActivityTimestamp.clear();
    combatAuditSystem.clearAuditData();
  }

  /**
   * End combat and clean up state for a specific combat
   */
  endCombat(combatId: string): void {
    // Generate final audit report before cleanup
    const auditReport = combatAuditSystem.endCombatAudit(combatId);

    this.activeCombats.delete(combatId);
    this.turnManager.clearEncounterState(combatId);
    this.actionTracker.clearActionState(combatId);
    this.combatPhases.delete(combatId);
    this.lastActivityTimestamp.delete(combatId);

    logger.info(`⚔️ Combat ${combatId} ended`);
    logger.info(`📊 Final compliance score: ${auditReport.complianceScore}%`);

    if (auditReport.violations.length > 0) {
      logger.warn(`⚠️ Rule violations detected: ${auditReport.violations.length}`);
      const criticalViolations = auditReport.violations.filter((v) => v.severity === 'critical');
      if (criticalViolations.length > 0) {
        logger.error(`🚨 Critical violations: ${criticalViolations.length}`);
      }
    }
  }

  /**
   * Check if combat is currently active
   */
  isCombatActive(combatId: string): boolean {
    return this.activeCombats.has(combatId);
  }

  /**
   * Validate combat state for a specific action
   */
  validateCombatState(
    combatId: string,
    _action: 'attack' | 'damage' | 'save',
  ): { valid: boolean; reason?: string } {
    if (!this.activeCombats.has(combatId)) {
      return { valid: false, reason: 'Combat not active' };
    }

    if (!this.turnManager.hasInitiativeBeenRolled(combatId)) {
      return { valid: false, reason: 'Initiative phase not complete' };
    }

    const turnOrder = this.turnManager.getTurnOrder(combatId);
    if (!turnOrder || !turnOrder.isInitiativeComplete) {
      return { valid: false, reason: 'Initiative phase not complete' };
    }

    return { valid: true };
  }
}

// Export singleton instance
export const combatSequenceValidator = CombatSequenceValidator.getInstance();
