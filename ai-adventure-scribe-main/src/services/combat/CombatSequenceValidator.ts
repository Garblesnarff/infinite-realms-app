/**
 * Combat Sequence Validator
 * Enforces proper D&D 5e combat mechanics and sequencing
 * Now integrated with CombatAuditSystem for rule compliance tracking
 */

import { combatAuditSystem } from '../combat-audit';
import {
  CombatTurnManager,
  type InitiativeEntry,
  type TurnOrder,
} from './CombatTurnManager';
import {
  detectsDirectDamage,
  detectsCombatStart,
  detectsAttackRequest,
  detectsSkillCheck,
  detectsDamageRequest,
  containsAC,
  containsDC,
  containsModifier,
} from './dm-response-patterns';

import logger from '@/lib/logger';

export type { InitiativeEntry, TurnOrder };

export interface CombatPhase {
  phase: 'pre-combat' | 'initiative' | 'attack' | 'damage' | 'resolution';
  timestamp: number;
  actorId: string;
  context: string;
}

export interface CombatValidationError {
  type:
    | 'missing_initiative'
    | 'missing_attack_roll'
    | 'missing_damage_roll'
    | 'missing_ac'
    | 'missing_dc'
    | 'missing_modifier'
    | 'wrong_sequence';
  message: string;
  suggestion: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface CombatValidationResult {
  isValid: boolean;
  errors: CombatValidationError[];
  warnings: CombatValidationError[];
  requiredNextAction?: string;
  suggestedResponse?: string;
}

// TTL for combat state cleanup (4 hours)
const COMBAT_STATE_TTL_MS = 4 * 60 * 60 * 1000;
// Minimum interval between cleanup sweeps (5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class CombatSequenceValidator {
  private static instance: CombatSequenceValidator;
  private turnManager: CombatTurnManager = new CombatTurnManager();
  private combatPhases: Map<string, CombatPhase[]> = new Map();
  private activeCombats: Set<string> = new Set();
  private pendingAttacks: Map<
    string,
    { weaponName: string; targetAC?: number; timestamp: number }
  > = new Map();
  private awaitingDamage: Map<
    string,
    { attackRollId: string; isCritical: boolean; weaponName: string }
  > = new Map();
  private lastActivityTimestamp: Map<string, number> = new Map();
  private lastCleanupAt = 0;

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
    const attackId = `${combatId}_${actorId}_${Date.now()}`;
    this.pendingAttacks.set(attackId, { weaponName, targetAC, timestamp: Date.now() });
    this.addPhase(combatId, 'attack', actorId, `Attack with ${weaponName}`);
    logger.info(`⚔️ Attack request recorded: ${attackId}`);
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
    const attack = this.pendingAttacks.get(attackId);
    if (!attack) return false;

    const actualAC = targetAC || attack.targetAC;
    if (!actualAC) return false;

    const isHit = result >= actualAC;
    const isCritical = result === 20;

    if (isHit) {
      this.awaitingDamage.set(attackId, {
        attackRollId: attackId,
        isCritical,
        weaponName: attack.weaponName,
      });
    }

    // Record attack action for audit if we have actor info
    if (actorId && actorName) {
      const combatId = attackId.split('_')[0]; // Extract combat ID from attack ID
      combatAuditSystem.recordAction({
        combatId,
        actorId,
        actorName,
        actionType: 'attack_roll',
        phase: 'turn',
        data: {
          formula: '1d20+modifier', // Generic - would need character data for specifics
          result,
          targetAC: actualAC,
          success: isHit,
          critical: isCritical,
          description: `Attack with ${attack.weaponName}: ${result} vs AC ${actualAC} = ${isHit ? 'HIT' : 'MISS'}${isCritical ? ' (CRITICAL!)' : ''}`,
        },
      });
    }

    this.pendingAttacks.delete(attackId);
    logger.info(`🎯 Attack result: ${result} vs AC ${actualAC} = ${isHit ? 'HIT' : 'MISS'}`);
    return isHit;
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
    const damageInfo = this.awaitingDamage.get(attackId);

    // Record damage action for audit if we have actor info
    if (actorId && actorName && damageInfo) {
      const combatId = attackId.split('_')[0]; // Extract combat ID from attack ID
      combatAuditSystem.recordAction({
        combatId,
        actorId,
        actorName,
        actionType: 'damage_roll',
        phase: 'turn',
        data: {
          formula: formula || 'dice+modifier',
          result: damage,
          critical: damageInfo.isCritical,
          description: `${damageInfo.isCritical ? 'Critical d' : 'D'}amage with ${damageInfo.weaponName}: ${damage}${formula ? ` (${formula})` : ''}`,
        },
      });
    }

    this.awaitingDamage.delete(attackId);
    logger.info(`💥 Damage recorded: ${damage} for attack ${attackId}`);
  }

  /**
   * Validate a DM response for combat rule compliance
   */
  validateDMResponse(response: string, combatId?: string): CombatValidationResult {
    this.cleanupStaleState();

    if (combatId) {
      this.lastActivityTimestamp.set(combatId, Date.now());
    }

    const errors: CombatValidationError[] = [];
    const warnings: CombatValidationError[] = [];

    // Check for direct damage without attack roll
    if (detectsDirectDamage(response) && !this.hasPendingAttack(combatId)) {
      errors.push({
        type: 'missing_attack_roll',
        message: 'Damage roll requested without preceding attack roll',
        suggestion:
          'Request attack roll first: "Make an attack roll with your [weapon] (1d20+bonus) against AC [number]"',
        severity: 'critical',
      });
    }

    // Check for combat start without initiative
    if (detectsCombatStart(response) && combatId && !this.turnManager.hasInitiativeBeenRolled(combatId)) {
      errors.push({
        type: 'missing_initiative',
        message: 'Combat started without initiative roll',
        suggestion:
          'Request initiative first: "Combat begins! Roll initiative (1d20+dex modifier)"',
        severity: 'critical',
      });
    }

    // Check for actions attempted before turn order is established
    if (combatId && this.activeCombats.has(combatId)) {
      const turnOrder = this.turnManager.getTurnOrder(combatId);
      if (
        !turnOrder?.isInitiativeComplete &&
        (detectsAttackRequest(response) || detectsSkillCheck(response))
      ) {
        errors.push({
          type: 'wrong_sequence',
          message: 'Action attempted before initiative order is established',
          suggestion:
            'Complete initiative phase first: "Roll initiative (1d20+dex modifier) to determine turn order"',
          severity: 'critical',
        });
      }
    }

    // Check for attack without AC
    if (detectsAttackRequest(response) && !containsAC(response)) {
      errors.push({
        type: 'missing_ac',
        message: 'Attack roll requested without target AC',
        suggestion: 'Include target AC: "Make an attack roll against AC [number]"',
        severity: 'high',
      });
    }

    // Check for skill check without DC
    if (detectsSkillCheck(response) && !containsDC(response)) {
      errors.push({
        type: 'missing_dc',
        message: 'Skill check requested without DC',
        suggestion: 'Include DC: "Make a [skill] check (DC [number])"',
        severity: 'high',
      });
    }

    // Check for damage roll without modifier
    if (detectsDamageRequest(response) && !containsModifier(response)) {
      warnings.push({
        type: 'missing_modifier',
        message: 'Damage roll missing ability modifier',
        suggestion: 'Include modifier: "Roll 1d8+STR modifier" or "Roll 1d6+3"',
        severity: 'medium',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      requiredNextAction: this.determineNextAction(combatId),
      suggestedResponse: this.generateSuggestedResponse(errors),
    };
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
    if (!combatId) return this.awaitingDamage.size > 0;

    for (const [attackId] of this.awaitingDamage) {
      if (attackId.startsWith(combatId)) return true;
    }
    return false;
  }

  /**
   * Get awaiting damage info
   */
  getAwaitingDamage(combatId?: string): { weaponName: string; isCritical: boolean } | null {
    for (const [attackId, damage] of this.awaitingDamage) {
      if (!combatId || attackId.startsWith(combatId)) {
        return { weaponName: damage.weaponName, isCritical: damage.isCritical };
      }
    }
    return null;
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

  private hasPendingAttack(combatId?: string): boolean {
    if (!combatId) return this.pendingAttacks.size > 0;

    for (const [attackId] of this.pendingAttacks) {
      if (attackId.startsWith(combatId)) return true;
    }
    return false;
  }

  private determineNextAction(combatId?: string): string | undefined {
    if (combatId && this.activeCombats.has(combatId)) {
      if (!this.turnManager.hasInitiativeBeenRolled(combatId)) {
        return 'request_initiative';
      }
      if (this.isAwaitingDamage(combatId)) {
        return 'request_damage';
      }
    }
    return undefined;
  }

  private generateSuggestedResponse(errors: CombatValidationError[]): string | undefined {
    if (errors.length === 0) return undefined;

    const primaryError = errors[0];
    switch (primaryError.type) {
      case 'missing_attack_roll':
        return 'Make an attack roll with your weapon (1d20+attack bonus) against AC [number]';
      case 'missing_initiative':
        return 'Combat begins! Roll initiative (1d20+dex modifier)';
      case 'missing_ac':
        return 'Make an attack roll with your weapon (1d20+bonus) against AC [target number]';
      case 'missing_dc':
        return 'Make a [skill] check (1d20+modifier, DC [number])';
      default:
        return primaryError.suggestion;
    }
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

        // Clean up pending attacks for this combat
        for (const [attackId] of this.pendingAttacks) {
          if (attackId.startsWith(combatId)) {
            this.pendingAttacks.delete(attackId);
          }
        }

        // Clean up awaiting damage for this combat
        for (const [attackId] of this.awaitingDamage) {
          if (attackId.startsWith(combatId)) {
            this.awaitingDamage.delete(attackId);
          }
        }

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
    this.pendingAttacks.clear();
    this.awaitingDamage.clear();
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
    this.combatPhases.delete(combatId);
    this.lastActivityTimestamp.delete(combatId);

    // Clean up any pending attacks for this combat
    for (const [attackId] of this.pendingAttacks) {
      if (attackId.startsWith(combatId)) {
        this.pendingAttacks.delete(attackId);
      }
    }

    // Clean up any awaiting damage for this combat
    for (const [attackId] of this.awaitingDamage) {
      if (attackId.startsWith(combatId)) {
        this.awaitingDamage.delete(attackId);
      }
    }

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
