/**
 * Rest Mechanics Logic
 *
 * Extracted from RestService.
 * Handles the pure logic of D&D 5E rest mechanics,
 * including hit dice spending, restoration, and resource mapping.
 *
 * @module server-bun/services/rest/rest-mechanics
 */

import { HIT_DICE_BY_CLASS } from '../../types/rest.js';

import type { CharacterHitDice } from '../../../../db/schema/index';
import type { HitDieType, RestorableResource, RestType } from '../../types/rest.js';

export class RestMechanics {
  /**
   * Calculate Constitution modifier from ability score
   */
  static calculateConModifier(constitution: number): number {
    return Math.floor((constitution - 10) / 2);
  }

  /**
   * Get hit die type for a class
   */
  static getHitDieType(className: string): HitDieType {
    return HIT_DICE_BY_CLASS[className] || 'd8';
  }

  /**
   * Roll a hit die
   */
  static rollHitDie(dieType: HitDieType): number {
    const dieSize = parseInt(dieType.substring(1));
    return Math.floor(Math.random() * dieSize) + 1;
  }

  /**
   * Calculate hit dice for a class at a given level
   */
  static calculateHitDiceForClass(
    className: string,
    level: number,
  ): {
    dieType: HitDieType;
    count: number;
  } {
    const dieType = this.getHitDieType(className);
    return {
      dieType,
      count: level,
    };
  }

  /**
   * Logic for spending hit dice to recover HP
   * Pure function that calculates the result of spending hit dice.
   */
  static calculateSpentHitDice(
    count: number,
    conModifier: number,
    allHitDice: CharacterHitDice[],
    preRolledValues?: number[],
  ): {
    hpRestored: number;
    hitDiceSpent: number;
    rolls: number[];
    updates: Array<{ id: string; newUsedDice: number }>;
  } {
    // Spend hit dice (prefer largest dice first)
    const sortedHitDice = [...allHitDice].sort((a, b) => {
      const aSize = parseInt(a.dieType.substring(1));
      const bSize = parseInt(b.dieType.substring(1));
      return bSize - aSize;
    });

    let remaining = count;
    let totalHpRestored = 0;
    const rolls: number[] = [];
    const updates: Array<{ id: string; newUsedDice: number }> = [];

    for (const hitDie of sortedHitDice) {
      if (remaining === 0) break;

      const available = hitDie.totalDice - hitDie.usedDice;
      const toSpend = Math.min(remaining, available);

      if (toSpend > 0) {
        // Roll hit dice
        for (let i = 0; i < toSpend; i++) {
          const roll =
            preRolledValues?.[rolls.length] ?? this.rollHitDie(hitDie.dieType as HitDieType);
          rolls.push(roll);
          // Minimum 1 HP per die
          const hpGained = Math.max(1, roll + conModifier);
          totalHpRestored += hpGained;
        }

        updates.push({
          id: hitDie.id,
          newUsedDice: hitDie.usedDice + toSpend,
        });

        remaining -= toSpend;
      }
    }

    return {
      hpRestored: totalHpRestored,
      hitDiceSpent: count,
      rolls,
      updates,
    };
  }

  /**
   * Logic for restoring hit dice during a long rest
   * Pure function that calculates how many and which dice to restore.
   */
  static calculateRestoredHitDice(
    allHitDice: CharacterHitDice[],
    count?: number,
  ): {
    restoredCount: number;
    updates: Array<{ id: string; newUsedDice: number }>;
  } {
    // Calculate how many to restore
    const totalDice = allHitDice.reduce((sum, hd) => sum + hd.totalDice, 0);
    const usedDice = allHitDice.reduce((sum, hd) => sum + hd.usedDice, 0);
    const maxRestore = Math.max(1, Math.ceil(totalDice / 2));
    const toRestore =
      count !== undefined ? Math.min(count, usedDice, maxRestore) : Math.min(usedDice, maxRestore);

    if (toRestore === 0) {
      return { restoredCount: 0, updates: [] };
    }

    // Restore hit dice (prefer largest dice first)
    const sortedHitDice = [...allHitDice]
      .filter((hd) => hd.usedDice > 0)
      .sort((a, b) => {
        const aSize = parseInt(a.dieType.substring(1));
        const bSize = parseInt(b.dieType.substring(1));
        return bSize - aSize;
      });

    let remaining = toRestore;
    const updates: Array<{ id: string; newUsedDice: number }> = [];

    for (const hitDie of sortedHitDice) {
      if (remaining === 0) break;

      const canRestore = Math.min(remaining, hitDie.usedDice);

      if (canRestore > 0) {
        updates.push({
          id: hitDie.id,
          newUsedDice: hitDie.usedDice - canRestore,
        });

        remaining -= canRestore;
      }
    }

    return { restoredCount: toRestore, updates };
  }

  /**
   * Map rest types to restorable resources
   */
  static getRestorableResources(restType: RestType): RestorableResource[] {
    const resources: RestorableResource[] = [];

    if (restType === 'short') {
      resources.push({
        resourceType: 'class_feature',
        resourceName: 'Short Rest Features',
        amountRestored: 'Various (Fighter Second Wind, Warlock Spell Slots, Monk Ki, etc.)',
      });
    } else if (restType === 'long') {
      resources.push({
        resourceType: 'hp',
        resourceName: 'Hit Points',
        amountRestored: 'Full',
      });

      resources.push({
        resourceType: 'spell_slot',
        resourceName: 'All Spell Slots',
        amountRestored: 'All',
      });

      resources.push({
        resourceType: 'hit_dice',
        resourceName: 'Hit Dice',
        amountRestored: 'Half (minimum 1)',
      });

      resources.push({
        resourceType: 'class_feature',
        resourceName: 'All Class Features',
        amountRestored: 'All',
      });
    }

    return resources;
  }

  static restoreSpellSlots(
    spellSlots: Record<string, { max?: number; current?: number }> | null,
  ): Record<string, { max?: number; current?: number }> | null {
    if (!spellSlots) return spellSlots;
    return Object.fromEntries(
      Object.entries(spellSlots).map(([level, slot]) => [
        level,
        { ...slot, current: slot.max ?? slot.current },
      ]),
    );
  }

  static restoreClassFeatures(value: unknown, restType: RestType): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.restoreClassFeatures(entry, restType));
    }
    if (!value || typeof value !== 'object') return value;

    const feature = value as Record<string, unknown>;
    const restored = Object.fromEntries(
      Object.entries(feature).map(([key, entry]) => [
        key,
        this.restoreClassFeatures(entry, restType),
      ]),
    );
    const cadence = feature.usesPerRest ?? feature.uses_per_rest;
    if (
      cadence === restType ||
      (restType === 'long' && (cadence === 'short' || cadence === 'long'))
    ) {
      if (typeof feature.maxUses === 'number') restored.currentUses = feature.maxUses;
      if (typeof feature.max === 'number') restored.current = feature.max;
    }
    return restored;
  }
}
