/**
 * Combat Attack Service (Orchestrator)
 *
 * Coordinates D&D 5E attack resolution by delegating to specialized modules:
 * - hit-check: Hit/miss determination and auto-crit detection
 * - damage-calculator: Damage calculation with criticals and dice rolling
 * - resistance-resolver: Resistance/vulnerability/immunity aggregation
 * - data-access: All database queries and ownership verification
 *
 * Public API is unchanged from the original monolithic service.
 *
 * @module server/services/combat/combat-attack-service
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { calculateDamage, resolveCriticalHit } from './damage-calculator.js';
import {
  verifyEncounterAccess,
  getParticipantWithStats,
  getParticipantsWithStatsBatch,
  getWeaponAttack,
  getCharacterWeapons,
  getCreatureStats,
  getCreatureStatsBatch,
  createWeaponAttack,
  getParticipantInEncounter,
} from './data-access.js';
import { checkHit, checkAutoCrit } from './hit-check.js';
import { aggregateResistances } from './resistance-resolver.js';
import { NotFoundError, InternalServerError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { CombatHPService } from '../combat-hp-service.js';

import type { WeaponAttack, CreatureStats } from '../../../../db/schema/index.js';
import type {
  AttackRollInput,
  AttackResult,
  HitCheckInput,
  HitCheckResult,
  DamageCalculationInput,
  DamageCalculationResult,
  SpellAttackInput,
  SpellAttackResult,
  CreateWeaponAttackInput,
  DamageType,
} from '../../types/combat.js';

export class CombatAttackService {
  constructor() {
    // No database client needed - using global db instance
  }

  /**
   * Check if an attack hits the target
   * Delegates to hit-check module.
   */
  checkHit(input: HitCheckInput): HitCheckResult {
    return checkHit(input);
  }

  /**
   * Calculate damage with resistance/vulnerability/immunity
   * Delegates to damage-calculator module.
   */
  calculateDamage(input: DamageCalculationInput): DamageCalculationResult {
    return calculateDamage(input);
  }

  /**
   * Resolve a critical hit
   * Delegates to damage-calculator module.
   */
  resolveCriticalHit(damageDice: string, damageBonus: number, damageRoll?: number): number {
    return resolveCriticalHit(damageDice, damageBonus, damageRoll);
  }

  /**
   * Resolve a complete attack
   */
  async resolveAttack(
    encounterId: string,
    input: AttackRollInput,
    userId: string,
  ): Promise<AttackResult> {
    const {
      attackerId,
      targetId,
      attackRoll,
      attackBonus = 0,
      weaponId,
      attackType: _attackType,
      isCritical: forceCritical = false,
      advantage = false,
      disadvantage = false,
      damageRoll,
      targetConditions,
      distanceInFeet,
    } = input;

    // ⚡ Bolt: Removed redundant verifyEncounterAccess call as authorization is handled
    // within getParticipantWithStats and getWeaponAttack. Parallelizing these fetches
    // reduces database round-trips from 4 down to 2.
    const [targetData, weapon] = await Promise.all([
      getParticipantWithStats(targetId, encounterId, userId),
      weaponId ? getWeaponAttack(weaponId, userId) : Promise.resolve(null),
    ]);

    if (!targetData) {
      throw new NotFoundError('Target participant', targetId);
    }

    const { participant: targetParticipant, stats: targetStats } = targetData;

    if (weaponId && !weapon) {
      throw new NotFoundError('Weapon', weaponId);
    }

    // Determine target AC: Use combat participant AC (allows for temporary modifications)
    // with fallback to base creature stats if participant AC is the default 10.
    const targetAC =
      targetParticipant.armorClass !== 10
        ? targetParticipant.armorClass
        : targetStats?.armorClass || 10;

    // Check if attack hits
    const hitCheck = checkHit({
      attackRoll,
      attackBonus: weapon?.attackBonus || attackBonus,
      targetAC,
      advantage,
      disadvantage,
    });

    if (!hitCheck.hit) {
      // Miss - no damage
      return {
        hit: false,
        targetAC,
        totalAttackRoll: hitCheck.totalAttackRoll,
        effectiveResistance: false,
        effectiveVulnerability: false,
        effectiveImmunity: false,
        finalDamage: 0,
        isCritical: false,
        isNaturalOne: hitCheck.isNaturalOne,
        isNaturalTwenty: hitCheck.isNaturalTwenty,
      };
    }

    // Hit - calculate damage
    // D&D 5E: Paralyzed/unconscious targets within 5ft = auto-crit
    const autoCrit = checkAutoCrit(targetConditions, distanceInFeet);
    const isCrit = forceCritical || hitCheck.isCritical || autoCrit;

    if (!weapon) {
      // No weapon - return hit with no damage calculated
      return {
        hit: true,
        targetAC,
        totalAttackRoll: hitCheck.totalAttackRoll,
        effectiveResistance: false,
        effectiveVulnerability: false,
        effectiveImmunity: false,
        finalDamage: 0,
        isCritical: isCrit,
        isNaturalOne: hitCheck.isNaturalOne,
        isNaturalTwenty: hitCheck.isNaturalTwenty,
      };
    }

    // Aggregate resistances using the extracted module
    const defenses = aggregateResistances(targetParticipant, targetStats);

    const damageCalc = calculateDamage({
      damageDice: weapon.damageDice,
      damageBonus: weapon.damageBonus,
      damageType: weapon.damageType as DamageType,
      isCritical: isCrit,
      resistances: defenses.resistances,
      vulnerabilities: defenses.vulnerabilities,
      immunities: defenses.immunities,
      damageRoll,
    });

    // Apply damage to target HP
    try {
      // ⚡ Bolt: Skips redundant authorization in applyDamage as targetData already verified access.
      const hpResult = await CombatHPService.applyDamage(
        targetId,
        encounterId,
        {
          damageAmount: damageCalc.finalDamage,
          damageType: weapon.damageType as DamageType,
          sourceParticipantId: attackerId,
          sourceDescription: weapon.name || 'attack',
          ignoreResistances: true, // Already applied in damage calculation
          ignoreImmunities: true, // Already applied in damage calculation
        },
        undefined, // skip redundant auth
        targetParticipant,
      );

      return {
        hit: true,
        targetAC: targetParticipant.armorClass,
        totalAttackRoll: hitCheck.totalAttackRoll,
        damage: damageCalc.baseDamage,
        damageType: weapon.damageType as DamageType,
        damageBeforeResistances: damageCalc.damageBeforeResistances,
        effectiveResistance: damageCalc.effectiveResistance,
        effectiveVulnerability: damageCalc.effectiveVulnerability,
        effectiveImmunity: damageCalc.effectiveImmunity,
        finalDamage: damageCalc.finalDamage,
        targetNewHp: hpResult.newCurrentHp,
        targetIsConscious: hpResult.isConscious,
        targetIsDead: hpResult.isDead,
        isCritical: isCrit,
        isNaturalOne: hitCheck.isNaturalOne,
        isNaturalTwenty: hitCheck.isNaturalTwenty,
      };
    } catch (error) {
      logger.error({ msg: 'Failed to apply damage to HP', error });
      throw new InternalServerError('Attack succeeded but damage application failed', { error });
    }
  }

  /**
   * Resolve a spell attack against multiple targets
   */
  async resolveSpellAttack(
    encounterId: string,
    input: SpellAttackInput,
    userId: string,
  ): Promise<SpellAttackResult> {
    const {
      casterId,
      targetIds,
      spellName,
      attackRoll,
      saveDC,
      saveRolls,
      damageRoll,
      damageDice,
      damageType,
      isCritical = false,
      targetConditionsByTargetId,
      distanceByTargetId,
    } = input;

    // ⚡ Bolt: Parallelize caster validation and batch target fetching to reduce sequential round-trips.
    // Removed initial verifyEncounterAccess as getParticipantsWithStatsBatch handles authorization.
    const [_, allTargetData] = await Promise.all([
      getParticipantInEncounter(casterId, encounterId),
      getParticipantsWithStatsBatch(targetIds, encounterId, userId),
    ]);

    const results: AttackResult[] = [];

    // Parallelize spell resolution for all targets using the pre-fetched data map.
    const resolutionPromises = targetIds.map(async (targetId) => {
      const targetData = allTargetData.get(targetId);
      if (!targetData) {
        return null;
      }

      const { participant: targetParticipant, stats: targetStats } = targetData;

      // Determine target AC: Use combat participant AC (allows for temporary modifications)
      // with fallback to base creature stats if participant AC is the default 10.
      const targetAC =
        targetParticipant.armorClass !== 10
          ? targetParticipant.armorClass
          : targetStats?.armorClass || 10;

      // Aggregate resistances using the extracted module
      const defenses = aggregateResistances(targetParticipant, targetStats);

      if (attackRoll !== undefined) {
        // Spell attack roll
        const hitCheckResult = checkHit({
          attackRoll,
          attackBonus: 0, // Spell attack bonus should be included in attackRoll
          targetAC,
        });

        if (!hitCheckResult.hit) {
          return {
            hit: false,
            targetAC,
            totalAttackRoll: hitCheckResult.totalAttackRoll,
            effectiveResistance: false,
            effectiveVulnerability: false,
            effectiveImmunity: false,
            finalDamage: 0,
            isCritical: false,
            isNaturalOne: hitCheckResult.isNaturalOne,
            isNaturalTwenty: hitCheckResult.isNaturalTwenty,
          };
        }

        // Hit - calculate damage
        if (damageDice && damageType) {
          // D&D 5E: Paralyzed/unconscious targets within 5ft = auto-crit
          const targetConditionsForTarget = targetConditionsByTargetId?.[targetId];
          const distanceInFeet = distanceByTargetId?.[targetId];
          const autoCrit = checkAutoCrit(targetConditionsForTarget, distanceInFeet);
          const spellIsCrit = hitCheckResult.isCritical || isCritical || autoCrit;

          const damageCalc = calculateDamage({
            damageDice,
            damageBonus: 0,
            damageType,
            isCritical: spellIsCrit,
            resistances: defenses.resistances,
            vulnerabilities: defenses.vulnerabilities,
            immunities: defenses.immunities,
            damageRoll,
          });

          // Apply damage to target HP
          try {
            // ⚡ Bolt: Skips N+1 redundant auth queries by passing undefined for userId.
            const hpResult = await CombatHPService.applyDamage(
              targetId,
              encounterId,
              {
                damageAmount: damageCalc.finalDamage,
                damageType,
                sourceParticipantId: casterId,
                sourceDescription: spellName,
                ignoreResistances: true, // Already applied in damage calculation
                ignoreImmunities: true, // Already applied in damage calculation
              },
              undefined, // skip redundant auth
              targetParticipant,
            );

            return {
              hit: true,
              targetAC,
              totalAttackRoll: hitCheckResult.totalAttackRoll,
              damage: damageCalc.baseDamage,
              damageType,
              damageBeforeResistances: damageCalc.damageBeforeResistances,
              effectiveResistance: damageCalc.effectiveResistance,
              effectiveVulnerability: damageCalc.effectiveVulnerability,
              effectiveImmunity: damageCalc.effectiveImmunity,
              finalDamage: damageCalc.finalDamage,
              targetNewHp: hpResult.newCurrentHp,
              targetIsConscious: hpResult.isConscious,
              targetIsDead: hpResult.isDead,
              isCritical: spellIsCrit,
              isNaturalOne: hitCheckResult.isNaturalOne,
              isNaturalTwenty: hitCheckResult.isNaturalTwenty,
            };
          } catch (error) {
            logger.error({ msg: 'Failed to apply spell attack damage to HP', error });
            throw new InternalServerError('Spell attack succeeded but damage application failed', {
              error,
            });
          }
        }
      } else if (saveDC !== undefined && saveRolls) {
        // Saving throw spell
        const saveRoll = saveRolls[targetId];
        if (saveRoll === undefined) {
          return null;
        }
        const savedSuccessfully = saveRoll >= saveDC;

        if (damageDice && damageType) {
          const damageCalc = calculateDamage({
            damageDice,
            damageBonus: 0,
            damageType,
            isCritical: false, // Spells with saves don't crit
            resistances: defenses.resistances,
            vulnerabilities: defenses.vulnerabilities,
            immunities: defenses.immunities,
            damageRoll,
          });

          // Half damage on successful save
          const finalDamage = savedSuccessfully
            ? Math.floor(damageCalc.finalDamage / 2)
            : damageCalc.finalDamage;

          // Apply damage to target HP
          try {
            // ⚡ Bolt: Skips N+1 redundant auth queries by passing undefined for userId.
            const hpResult = await CombatHPService.applyDamage(
              targetId,
              encounterId,
              {
                damageAmount: finalDamage,
                damageType,
                sourceParticipantId: casterId,
                sourceDescription: spellName,
                ignoreResistances: true, // Already applied in damage calculation
                ignoreImmunities: true, // Already applied in damage calculation
              },
              undefined, // skip redundant auth
              targetParticipant,
            );

            return {
              hit: !savedSuccessfully,
              targetAC: 0, // Not applicable for saves
              totalAttackRoll: saveRoll ?? 0,
              damage: damageCalc.baseDamage,
              damageType,
              damageBeforeResistances: damageCalc.damageBeforeResistances,
              effectiveResistance: damageCalc.effectiveResistance,
              effectiveVulnerability: damageCalc.effectiveVulnerability,
              effectiveImmunity: damageCalc.effectiveImmunity,
              finalDamage,
              targetNewHp: hpResult.newCurrentHp,
              targetIsConscious: hpResult.isConscious,
              targetIsDead: hpResult.isDead,
              isCritical: false,
              isNaturalOne: false,
              isNaturalTwenty: false,
            };
          } catch (error) {
            logger.error({ msg: 'Failed to apply spell save damage to HP', error });
            throw new InternalServerError('Spell save resolved but damage application failed', {
              error,
            });
          }
        }
      }
      return null;
    });

    const resolutionResults = await Promise.all(resolutionPromises);
    resolutionResults.forEach((res) => {
      if (res) results.push(res);
    });

    return { results };
  }

  /**
   * Create a weapon attack for a character
   * Delegates to data-access module.
   */
  async createWeaponAttack(input: CreateWeaponAttackInput, userId: string): Promise<WeaponAttack> {
    return createWeaponAttack(input, userId);
  }

  /**
   * Get all weapon attacks for a character
   * Delegates to data-access module.
   */
  async getCharacterWeapons(characterId: string, userId: string): Promise<WeaponAttack[]> {
    return getCharacterWeapons(characterId, userId);
  }

  /**
   * Get a specific weapon attack
   * Delegates to data-access module.
   */
  async getWeaponAttack(weaponId: string, userId: string): Promise<WeaponAttack | null> {
    return getWeaponAttack(weaponId, userId);
  }

  /**
   * Fetch multiple creature statistics in a single batch query.
   * Delegates to data-access module.
   */
  async getCreatureStatsBatch(
    creatureIds: string[],
    userId: string,
  ): Promise<Map<string, CreatureStats>> {
    return getCreatureStatsBatch(creatureIds, userId);
  }

  /**
   * Get creature stats (AC, resistances, etc.)
   * Delegates to data-access module.
   */
  async getCreatureStats(creatureId: string, userId: string): Promise<CreatureStats | null> {
    return getCreatureStats(creatureId, userId);
  }

  /**
   * Fetch participant with their base creature stats.
   * Delegates to data-access module.
   */
  async getParticipantWithStats(
    participantId: string,
    encounterId: string,
    userId: string,
  ): Promise<{ participant: any; stats: CreatureStats | null } | null> {
    return getParticipantWithStats(participantId, encounterId, userId);
  }

  /**
   * Batch fetch multiple participants with their base creature stats.
   * Delegates to data-access module.
   */
  async getParticipantsWithStatsBatch(
    participantIds: string[],
    encounterId: string,
    userId: string,
  ): Promise<Map<string, { participant: any; stats: CreatureStats | null }>> {
    return getParticipantsWithStatsBatch(participantIds, encounterId, userId);
  }

  /**
   * D&D 5E Auto-Crit Detection
   * Delegates to hit-check module.
   */
  checkAutoCrit(targetConditions?: string[], distanceInFeet?: number): boolean {
    return checkAutoCrit(targetConditions, distanceInFeet);
  }
}

// Export singleton instance
export const combatAttackService = new CombatAttackService();
