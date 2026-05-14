import { combatAuditSystem } from '../combat-audit';
import logger from '@/lib/logger';

export interface PendingAttack {
  weaponName: string;
  targetAC?: number;
  timestamp: number;
}

export interface AwaitingDamage {
  attackRollId: string;
  isCritical: boolean;
  weaponName: string;
}

/**
 * Tracks pending attacks and damage rolls during combat
 */
export class CombatActionTracker {
  private pendingAttacks: Map<string, PendingAttack> = new Map();
  private awaitingDamage: Map<string, AwaitingDamage> = new Map();

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

  /**
   * Check if combat has pending attack
   */
  hasPendingAttack(combatId?: string): boolean {
    if (!combatId) return this.pendingAttacks.size > 0;

    for (const [attackId] of this.pendingAttacks) {
      if (attackId.startsWith(combatId)) return true;
    }
    return false;
  }

  /**
   * Clear action state for a specific combat
   */
  clearActionState(combatId: string): void {
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
  }

  /**
   * Clear all state
   */
  clearAllState(): void {
    this.pendingAttacks.clear();
    this.awaitingDamage.clear();
  }
}
