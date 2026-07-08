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

/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { calculateDamage, resolveCriticalHit } from './damage-calculator.js';
import {
  getParticipantWithStats,
  getParticipantsWithStatsBatch,
  getWeaponAttack,
  getCharacterWeapons,
  getCreatureStats,
  getCreatureStatsBatch,
  createWeaponAttack,
  getParticipantAbilityProfile,
  claimEncounterVersion,
  getActiveConditionNames,
} from './data-access.js';
import { checkHit, checkAutoCrit } from './hit-check.js';
import { aggregateResistances } from './resistance-resolver.js';
import { NotFoundError, InternalServerError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { CombatHPService } from '../combat-hp-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
import { BusinessLogicError } from '../../lib/errors.js';
import { getSpellById, getSpellByName } from '../../data/spellData.js';
import { SpellSlotsService } from '../spell-slots-service.js';

import type { WeaponAttack, CreatureStats } from '../../../../db/schema/index';
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

  private rollD20(advantage = false, disadvantage = false): number {
    const first = Math.floor(Math.random() * 20) + 1;
    if (advantage === disadvantage) return first;
    const second = Math.floor(Math.random() * 20) + 1;
    return advantage ? Math.max(first, second) : Math.min(first, second);
  }

  private async assertCurrentTurn(encounterId: string, actorId: string, userId: string) {
    const current = await CombatInitiativeService.getCurrentTurn(encounterId, userId);
    if (!current || current.id !== actorId) {
      throw new BusinessLogicError('Actor is not the current-turn participant', { actorId });
    }
  }

  private abilityModifier(score = 10): number {
    return Math.floor((score - 10) / 2);
  }

  private proficiencyBonus(level = 1): number {
    return 2 + Math.floor((Math.max(1, level) - 1) / 4);
  }

  private spellcastingAbility(className?: string | null): string {
    const normalized = className?.toLowerCase() || '';
    if (['bard', 'paladin', 'sorcerer', 'warlock'].some((name) => normalized.includes(name))) return 'cha';
    if (['cleric', 'druid', 'ranger'].some((name) => normalized.includes(name))) return 'wis';
    return 'int';
  }

  private damageDiceForLevel(
    damageByLevel: Record<string, string> | undefined,
    spellLevel: number,
    requestedLevel: number | undefined,
    casterLevel: number,
  ): string | undefined {
    if (!damageByLevel) return undefined;
    const keys = Object.keys(damageByLevel).map(Number).sort((a, b) => a - b);
    const effectiveLevel = spellLevel === 0
      ? Math.max(...keys.filter((level) => level <= casterLevel), keys[0] || 1)
      : Math.max(spellLevel, requestedLevel || spellLevel);
    const selected = [...keys].reverse().find((level) => level <= effectiveLevel) ?? keys[0];
    return selected === undefined ? undefined : damageByLevel[String(selected)];
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
      expectedVersion,
      targetId,
      weaponId,
      attackType,
      advantage = false,
      disadvantage = false,
    } = input;

    await this.assertCurrentTurn(encounterId, attackerId, userId);
    await claimEncounterVersion(encounterId, expectedVersion);
    const attackRoll = this.rollD20(advantage, disadvantage);

    // ⚡ Bolt: Batch fetch both attacker and target with their stats in a single query.
    // This reduces database round-trips from 3 down to 2 (1 for participants, 1 for weapon).
    // Authorization is handled atomically within getParticipantsWithStatsBatch.
    const [participantDataMap, weapon] = await Promise.all([
      getParticipantsWithStatsBatch([attackerId, targetId], encounterId, userId),
      weaponId ? getWeaponAttack(weaponId, userId) : Promise.resolve(null),
    ]);

    const targetData = participantDataMap.get(targetId);
    const attackerData = participantDataMap.get(attackerId);

    if (!targetData) {
      throw new NotFoundError('Target participant', targetId);
    }

    if (!attackerData) {
      throw new NotFoundError('Attacker participant', attackerId);
    }

    const { participant: targetParticipant, stats: targetStats } = targetData;

    if (weaponId && !weapon) {
      throw new NotFoundError('Weapon', weaponId);
    }

    const attackerProfile = await getParticipantAbilityProfile(attackerData.participant);
    const attackAbility = attackType === 'ranged' ? 'dex' : 'str';
    const serverAttackBonus = weapon?.attackBonus ??
      this.abilityModifier(attackerProfile.scores[attackAbility]) + this.proficiencyBonus(attackerProfile.level);

    // Determine target AC: Use combat participant AC (allows for temporary modifications)
    // with fallback to base creature stats if participant AC is the default 10.
    const targetAC =
      targetParticipant.armorClass !== 10
        ? targetParticipant.armorClass
        : targetStats?.armorClass || 10;

    // Check if attack hits
    const hitCheck = checkHit({
      attackRoll,
      attackBonus: serverAttackBonus,
      targetAC,
      advantage: false,
      disadvantage: false,
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
    const targetConditions = await getActiveConditionNames(targetId);
    const autoCrit = checkAutoCrit(targetConditions, attackType === 'melee' ? 5 : undefined);
    const isCrit = hitCheck.isCritical || autoCrit;

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
    });

    // Apply damage to target HP
    try {
      // 🛡️ Sentinel: Pass userId to applyDamage to maintain atomic ownership verification chain.
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
        userId,
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
      expectedVersion,
      targetIds,
      spellId,
      spellName,
      slotLevel,
    } = input;

    await this.assertCurrentTurn(encounterId, casterId, userId);
    await claimEncounterVersion(encounterId, expectedVersion);
    const spell = spellId ? getSpellById(spellId) : getSpellByName(spellName);
    if (!spell) throw new NotFoundError('Spell', spellId || spellName);

    // ⚡ Bolt: Batch fetch both caster and all targets with their stats in a single query.
    // This reduces database round-trips from 2 to 1 for participant data.
    // Authorization is handled atomically within getParticipantsWithStatsBatch.
    const allParticipantIds = Array.from(new Set([casterId, ...targetIds]));
    const allParticipantDataMap = await getParticipantsWithStatsBatch(
      allParticipantIds,
      encounterId,
      userId,
    );

    // 🛡️ Sentinel: Verify caster existence and ownership
    if (!allParticipantDataMap.has(casterId)) {
      throw new NotFoundError('Caster participant', casterId);
    }
    const casterData = allParticipantDataMap.get(casterId)!;
    const casterProfile = await getParticipantAbilityProfile(casterData.participant);
    if (casterData.participant.characterId && !casterProfile.spellIds.includes(spell.id.toLowerCase()) &&
      !casterProfile.spellIds.includes(spell.name.toLowerCase())) {
      throw new BusinessLogicError('Caster does not know or have this spell prepared', { spellId: spell.id });
    }
    if (casterData.participant.characterId && spell.level > 0) {
      await SpellSlotsService.useSpellSlot({
        characterId: casterData.participant.characterId,
        spellName: spell.name,
        spellLevel: spell.level,
        slotLevelUsed: Math.max(spell.level, slotLevel || spell.level),
        sessionId: casterData.participant.encounter?.sessionId,
      }, userId);
    }
    const spellAbility = this.spellcastingAbility(casterProfile.className);
    const spellModifier = this.abilityModifier(casterProfile.scores[spellAbility]);
    const proficiencyBonus = this.proficiencyBonus(casterProfile.level);
    const spellAttackBonus = spellModifier + proficiencyBonus;
    const saveDC = 8 + spellAttackBonus;
    const damageDice = this.damageDiceForLevel(
      spell.damageByLevel, spell.level, slotLevel, casterProfile.level,
    );
    const damageType = spell.damageType as DamageType | undefined;

    const results: AttackResult[] = [];

    // Parallelize spell resolution for all targets using the pre-fetched data map.
    const resolutionPromises = targetIds.map(async (targetId) => {
      const targetData = allParticipantDataMap.get(targetId);
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

      if (spell.attackType) {
        // Spell attack roll
        const attackRoll = this.rollD20();
        const hitCheckResult = checkHit({
          attackRoll,
          attackBonus: spellAttackBonus,
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
          const targetConditionsForTarget = await getActiveConditionNames(targetId);
          const autoCrit = checkAutoCrit(targetConditionsForTarget, spell.attackType === 'melee' ? 5 : undefined);
          const spellIsCrit = hitCheckResult.isCritical || autoCrit;

          const damageCalc = calculateDamage({
            damageDice,
            damageBonus: 0,
            damageType,
            isCritical: spellIsCrit,
            resistances: defenses.resistances,
            vulnerabilities: defenses.vulnerabilities,
            immunities: defenses.immunities,
          });

          // Apply damage to target HP
          try {
            // 🛡️ Sentinel: Pass userId to applyDamage to maintain atomic ownership verification chain.
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
              userId,
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
      } else if (spell.saveAbility) {
        // Saving throw spell
        const targetProfile = await getParticipantAbilityProfile(targetParticipant);
        const ability = spell.saveAbility.toLowerCase();
        const namedAbility = ({ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' } as Record<string, string>)[ability];
        const explicitBonus = targetProfile.saveBonuses[ability] ?? targetProfile.saveBonuses[namedAbility];
        const proficient = targetProfile.savingThrowProficiencies.includes(ability) ||
          targetProfile.savingThrowProficiencies.includes(namedAbility);
        const saveBonus = explicitBonus ?? this.abilityModifier(targetProfile.scores[ability]) +
          (proficient ? this.proficiencyBonus(targetProfile.level) : 0);
        const saveRoll = this.rollD20() + saveBonus;
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
          });

          // Half damage on successful save
          const finalDamage = savedSuccessfully
            ? spell.saveSuccess === 'half' ? Math.floor(damageCalc.finalDamage / 2) : 0
            : damageCalc.finalDamage;

          // Apply damage to target HP
          try {
            // 🛡️ Sentinel: Pass userId to applyDamage to maintain atomic ownership verification chain.
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
              userId,
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
