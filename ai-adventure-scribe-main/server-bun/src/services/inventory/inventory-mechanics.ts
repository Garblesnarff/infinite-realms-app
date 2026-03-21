/**
 * Inventory Mechanics Logic
 *
 * Extracted from InventoryService.
 * Handles pure D&D 5E inventory rules, including encumbrance
 * and carrying capacity calculations.
 *
 * @module server/services/inventory/inventory-mechanics
 */

import {
  ENCUMBRANCE_THRESHOLDS,
  SPEED_PENALTIES,
} from '../../types/inventory.js';

import type { EncumbranceLevel, EncumbranceStatus } from '../../types/inventory.js';

export class InventoryMechanics {
  /**
   * Calculate carrying capacity (STR * 15)
   * (PHB pg. 176)
   */
  static calculateCarryingCapacity(strength: number): number {
    return strength * 15;
  }

  /**
   * Determine encumbrance status based on strength and current weight
   * Uses variant rule (PHB pg. 176)
   */
  static calculateEncumbrance(strength: number, currentWeight: number): EncumbranceStatus {
    const carryingCapacity = this.calculateCarryingCapacity(strength);

    let encumbranceLevel: EncumbranceLevel = 'normal';
    let speedPenalty = SPEED_PENALTIES.NORMAL;

    // Heavily Encumbered: weight > STR × 10
    if (currentWeight > strength * ENCUMBRANCE_THRESHOLDS.HEAVILY_ENCUMBERED) {
      encumbranceLevel = 'heavily_encumbered';
      speedPenalty = SPEED_PENALTIES.HEAVILY_ENCUMBERED;
    }
    // Encumbered: weight > STR × 5
    else if (currentWeight > strength * ENCUMBRANCE_THRESHOLDS.ENCUMBERED) {
      encumbranceLevel = 'encumbered';
      speedPenalty = SPEED_PENALTIES.ENCUMBERED;
    }

    return {
      currentWeight: Math.round(currentWeight * 100) / 100,
      carryingCapacity,
      encumbranceLevel,
      isEncumbered: encumbranceLevel === 'encumbered' || encumbranceLevel === 'heavily_encumbered',
      isHeavilyEncumbered: encumbranceLevel === 'heavily_encumbered',
      speedPenalty,
      strengthScore: strength,
    };
  }
}
