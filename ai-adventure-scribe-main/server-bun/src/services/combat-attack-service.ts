/**
 * Combat Attack Service
 *
 * Handles D&D 5E attack resolution including:
 * - Hit/miss determination
 * - Damage calculation with resistance/vulnerability/immunity
 * - Critical hits
 * - Advantage/disadvantage mechanics
 * - Spell attacks and saves
 *
 * @module server/services/combat-attack-service
 */

/* eslint-disable max-lines, @typescript-eslint/no-explicit-any */
import { and, desc, eq, exists, inArray, or, isNotNull } from 'drizzle-orm';

import { CombatHPService } from './combat-hp-service.js';
import { db } from '../../../db/client.js';
import {
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
  campaigns,
  weaponAttacks,
  creatureStats,
  characters,
  npcs,
} from '../../../db/schema/index.js';
import { NotFoundError, ValidationError, InternalServerError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

import type {
  WeaponAttack,
  CreatureStats,
} from '../../../db/schema/index.js';
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
} from '../types/combat.js';

export class CombatAttackService {
  constructor() {
    // No database client needed - using global db instance
  }

  /**
   * Verify a user owns the character (via user_id or owner_id).
   * Throws NOT_FOUND to mask unauthorized access.
   */
  private async verifyCharacterOwnership(characterId: string, userId: string): Promise<void> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
      columns: { id: true },
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }
  }

  /**
   * Verify encounter ownership through session campaign/character links.
   * Throws NOT_FOUND for both missing and unauthorized access.
   */
  private async verifyEncounterAccess(encounterId: string, userId: string): Promise<void> {
    const [result] = await db
      .select({ id: combatEncounters.id })
      .from(combatEncounters)
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(and(
        eq(combatEncounters.id, encounterId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId)
        )
      ))
      .limit(1);

    if (!result) {
      throw new NotFoundError('Combat encounter', encounterId);
    }
  }

  /**
   * Check if an attack hits the target
   *
   * Rules:
   * - Natural 1 always misses (even if total would hit)
   * - Natural 20 always hits and is a critical
   * - Advantage = roll 2d20, take higher
   * - Disadvantage = roll 2d20, take lower
   * - Advantage + Disadvantage = cancel out (straight roll)
   */
  checkHit(input: HitCheckInput): HitCheckResult {
    const { attackRoll, attackBonus, targetAC, advantage: _advantage, disadvantage: _disadvantage } = input;

    // Determine if this is a natural 1 or natural 20
    const isNaturalOne = attackRoll === 1;
    const isNaturalTwenty = attackRoll === 20;

    // Calculate total attack roll
    const totalAttackRoll = attackRoll + attackBonus;

    // Natural 1 always misses
    if (isNaturalOne) {
      return {
        hit: false,
        totalAttackRoll,
        targetAC,
        isNaturalOne: true,
        isNaturalTwenty: false,
        isCritical: false,
      };
    }

    // Natural 20 always hits and is a critical
    if (isNaturalTwenty) {
      return {
        hit: true,
        totalAttackRoll,
        targetAC,
        isNaturalOne: false,
        isNaturalTwenty: true,
        isCritical: true,
      };
    }

    // Normal hit check
    const hit = totalAttackRoll >= targetAC;

    return {
      hit,
      totalAttackRoll,
      targetAC,
      isNaturalOne: false,
      isNaturalTwenty: false,
      isCritical: false,
    };
  }

  /**
   * Calculate damage with resistance/vulnerability/immunity
   *
   * Rules:
   * - Critical hit = roll damage dice twice, add modifiers once
   * - Resistance = half damage (round down)
   * - Vulnerability = double damage
   * - Immunity = no damage
   * - Resistance and vulnerability cancel out
   */
  calculateDamage(input: DamageCalculationInput): DamageCalculationResult {
    const {
      damageDice,
      damageBonus,
      damageType,
      isCritical = false,
      resistances = [],
      vulnerabilities = [],
      immunities = [],
      damageRoll,
    } = input;

    // Check for immunity first
    const effectiveImmunity = immunities.includes(damageType);
    if (effectiveImmunity) {
      return {
        baseDamage: 0,
        damageBeforeResistances: 0,
        effectiveResistance: false,
        effectiveVulnerability: false,
        effectiveImmunity: true,
        finalDamage: 0,
        damageType,
      };
    }

    // Calculate base damage from dice
    let baseDamage: number;
    if (damageRoll !== undefined) {
      // Use provided damage roll
      baseDamage = damageRoll;
      if (isCritical) {
        // Critical: double the dice damage, then add modifier once
        baseDamage = (damageRoll - damageBonus) * 2 + damageBonus;
      }
    } else {
      // Parse dice notation and roll
      baseDamage = this.rollDamageDice(damageDice, isCritical) + damageBonus;
    }

    const damageBeforeResistances = baseDamage;

    // Check for resistance and vulnerability
    const hasResistance = resistances.includes(damageType);
    const hasVulnerability = vulnerabilities.includes(damageType);

    // Resistance and vulnerability cancel out
    const effectiveResistance = hasResistance && !hasVulnerability;
    const effectiveVulnerability = hasVulnerability && !hasResistance;

    let finalDamage = damageBeforeResistances;

    // Apply resistance (half damage, round down)
    if (effectiveResistance) {
      finalDamage = Math.floor(finalDamage / 2);
    }

    // Apply vulnerability (double damage)
    if (effectiveVulnerability) {
      finalDamage = finalDamage * 2;
    }

    return {
      baseDamage,
      damageBeforeResistances,
      effectiveResistance,
      effectiveVulnerability,
      effectiveImmunity: false,
      finalDamage,
      damageType,
    };
  }

  /**
   * Resolve a critical hit
   * Critical hits double the damage dice (not the modifiers)
   */
  resolveCriticalHit(damageDice: string, damageBonus: number, damageRoll?: number): number {
    if (damageRoll !== undefined) {
      // Double the dice portion, add modifier once
      return (damageRoll - damageBonus) * 2 + damageBonus;
    }

    // Roll damage dice twice
    const normalDamage = this.rollDamageDice(damageDice, false);
    const criticalDamage = normalDamage * 2 + damageBonus;
    return criticalDamage;
  }

  /**
   * Resolve a complete attack
   */
  async resolveAttack(
    encounterId: string,
    input: AttackRollInput,
    userId: string
  ): Promise<AttackResult> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

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

    // ⚡ Bolt: Parallelize target participant/stats and weapon fetch to reduce database round-trips.
    // 🛡️ Sentinel: Pass userId for ownership verification.
    const [targetData, weapon] = await Promise.all([
      this.getParticipantWithStats(targetId, encounterId, userId),
      weaponId ? this.getWeaponAttack(weaponId, userId) : Promise.resolve(null),
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
    const targetAC = (targetParticipant.armorClass !== 10)
      ? targetParticipant.armorClass
      : (targetStats?.armorClass || 10);

    // Check if attack hits
    const hitCheck = this.checkHit({
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
    const autoCrit = this.checkAutoCrit(targetConditions, distanceInFeet);
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

    // Aggregate resistances: prioritize participant-level modifications but fall back to creature stats
    const resistances = (targetParticipant.damageResistances?.length ? targetParticipant.damageResistances : targetStats?.resistances || []) as DamageType[];
    const vulnerabilities = (targetParticipant.damageVulnerabilities?.length ? targetParticipant.damageVulnerabilities : targetStats?.vulnerabilities || []) as DamageType[];
    const immunities = (targetParticipant.damageImmunities?.length ? targetParticipant.damageImmunities : targetStats?.immunities || []) as DamageType[];

    const damageCalc = this.calculateDamage({
      damageDice: weapon.damageDice,
      damageBonus: weapon.damageBonus,
      damageType: weapon.damageType as DamageType,
      isCritical: isCrit,
      resistances,
      vulnerabilities,
      immunities,
      damageRoll,
    });

    // Apply damage to target HP
    try {
      // ⚡ Bolt: Pass pre-fetched target data (including status and encounter) to applyDamage
      // to eliminate redundant database round-trips.
      const hpResult = await CombatHPService.applyDamage(targetId, encounterId, {
        damageAmount: damageCalc.finalDamage,
        damageType: weapon.damageType as DamageType,
        sourceParticipantId: attackerId,
        sourceDescription: weapon.name || 'attack',
        ignoreResistances: true, // Already applied in damage calculation
        ignoreImmunities: true,  // Already applied in damage calculation
      }, userId, targetParticipant);

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
    userId: string
  ): Promise<SpellAttackResult> {
    if (userId) {
      await this.verifyEncounterAccess(encounterId, userId);
    }

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

    // Validate caster belongs to this encounter to prevent cross-encounter ID references.
    await this.getParticipantInEncounter(casterId, encounterId);

    const results: AttackResult[] = [];

    // ⚡ Bolt: Fetch all target participants and their base stats in a single batch query to avoid N+1 database round-trips.
    // 🛡️ Sentinel: Use getParticipantsWithStatsBatch with userId for ownership verification.
    const allTargetData = await this.getParticipantsWithStatsBatch(targetIds, encounterId, userId);

    // ⚡ Bolt: Parallelize spell resolution for all targets using the pre-fetched data map.
    const resolutionPromises = targetIds.map(async (targetId) => {
      const targetData = allTargetData.get(targetId);
      if (!targetData) {
        return null;
      }

      const { participant: targetParticipant, stats: targetStats } = targetData;

      // Determine target AC: Use combat participant AC (allows for temporary modifications)
      // with fallback to base creature stats if participant AC is the default 10.
      const targetAC = (targetParticipant.armorClass !== 10)
        ? targetParticipant.armorClass
        : (targetStats?.armorClass || 10);

      // Aggregate resistances: prioritize participant-level modifications but fall back to creature stats
      const resistances = (targetParticipant.damageResistances?.length ? targetParticipant.damageResistances : targetStats?.resistances || []) as DamageType[];
      const vulnerabilities = (targetParticipant.damageVulnerabilities?.length ? targetParticipant.damageVulnerabilities : targetStats?.vulnerabilities || []) as DamageType[];
      const immunities = (targetParticipant.damageImmunities?.length ? targetParticipant.damageImmunities : targetStats?.immunities || []) as DamageType[];

      if (attackRoll !== undefined) {
        // Spell attack roll
        const hitCheck = this.checkHit({
          attackRoll,
          attackBonus: 0, // Spell attack bonus should be included in attackRoll
          targetAC,
        });

        if (!hitCheck.hit) {
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
        if (damageDice && damageType) {
          // D&D 5E: Paralyzed/unconscious targets within 5ft = auto-crit
          const targetConditions = targetConditionsByTargetId?.[targetId];
          const distanceInFeet = distanceByTargetId?.[targetId];
          const autoCrit = this.checkAutoCrit(targetConditions, distanceInFeet);
          const spellIsCrit = hitCheck.isCritical || isCritical || autoCrit;

          const damageCalc = this.calculateDamage({
            damageDice,
            damageBonus: 0,
            damageType,
            isCritical: spellIsCrit,
            resistances,
            vulnerabilities,
            immunities,
            damageRoll,
          });

          // Apply damage to target HP
          try {
            // ⚡ Bolt: Pass pre-fetched target data to applyDamage to avoid N+1 database queries.
            const hpResult = await CombatHPService.applyDamage(targetId, encounterId, {
              damageAmount: damageCalc.finalDamage,
              damageType,
              sourceParticipantId: casterId,
              sourceDescription: spellName,
              ignoreResistances: true, // Already applied in damage calculation
              ignoreImmunities: true,  // Already applied in damage calculation
            }, userId, targetParticipant);

            return {
              hit: true,
              targetAC,
              totalAttackRoll: hitCheck.totalAttackRoll,
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
              isNaturalOne: hitCheck.isNaturalOne,
              isNaturalTwenty: hitCheck.isNaturalTwenty,
            };
          } catch (error) {
            logger.error({ msg: 'Failed to apply spell attack damage to HP', error });
            throw new InternalServerError('Spell attack succeeded but damage application failed', { error });
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
          const damageCalc = this.calculateDamage({
            damageDice,
            damageBonus: 0,
            damageType,
            isCritical: false, // Spells with saves don't crit
            resistances,
            vulnerabilities,
            immunities,
            damageRoll,
          });

          // Half damage on successful save
          const finalDamage = savedSuccessfully
            ? Math.floor(damageCalc.finalDamage / 2)
            : damageCalc.finalDamage;

          // Apply damage to target HP
          try {
            // ⚡ Bolt: Pass pre-fetched target data to applyDamage to avoid N+1 database queries.
            const hpResult = await CombatHPService.applyDamage(targetId, encounterId, {
              damageAmount: finalDamage,
              damageType,
              sourceParticipantId: casterId,
              sourceDescription: spellName,
              ignoreResistances: true, // Already applied in damage calculation
              ignoreImmunities: true,  // Already applied in damage calculation
            }, userId, targetParticipant);

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
            throw new InternalServerError('Spell save resolved but damage application failed', { error });
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
   */
  async createWeaponAttack(input: CreateWeaponAttackInput, userId: string): Promise<WeaponAttack> {
    const {
      characterId,
      name,
      attackBonus,
      damageDice,
      damageBonus,
      damageType,
      properties = [],
      description,
    } = input;

    // 🛡️ Sentinel: Verify character ownership before creation
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    const [weapon] = await db
      .insert(weaponAttacks)
      .values({
        characterId,
        name,
        attackBonus,
        damageDice,
        damageBonus,
        damageType,
        properties,
        description: description || null,
      })
      .returning();

    if (!weapon) {
      throw new InternalServerError('Failed to create weapon attack');
    }

    return weapon;
  }

  /**
   * Get all weapon attacks for a character
   */
  async getCharacterWeapons(characterId: string, userId: string): Promise<WeaponAttack[]> {
    const weapons = await db.query.weaponAttacks.findMany({
      where: and(
        eq(weaponAttacks.characterId, characterId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, weaponAttacks.characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ),
      orderBy: [desc(weaponAttacks.createdAt)],
    });

    return weapons;
  }

  /**
   * Get a specific weapon attack
   */
  async getWeaponAttack(weaponId: string, userId: string): Promise<WeaponAttack | null> {
    const weapon = await db.query.weaponAttacks.findFirst({
      where: and(
        eq(weaponAttacks.id, weaponId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, weaponAttacks.characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ),
    });

    return weapon || null;
  }

  /**
   * Get creature stats (AC, resistances, etc.)
   */
  /**
   * ⚡ Bolt: Fetch multiple creature statistics in a single batch query to avoid N+1 problems.
   * Includes same ownership verification as getCreatureStats.
   */
  async getCreatureStatsBatch(creatureIds: string[], userId: string): Promise<Map<string, CreatureStats>> {
    if (creatureIds.length === 0) return new Map();

    const statsList = await db.query.creatureStats.findMany({
      where: and(
        or(
          inArray(creatureStats.characterId, creatureIds),
          inArray(creatureStats.npcId, creatureIds)
        ),
        or(
          // Access via owned character
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, creatureStats.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          ),
          // Access via owned campaign (NPCs)
          exists(
            db.select()
              .from(npcs)
              .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
              .where(and(
                eq(npcs.id, creatureStats.npcId),
                eq(campaigns.userId, userId)
              ))
          )
        )
      ),
    });

    const statsMap = new Map<string, CreatureStats>();
    statsList.forEach((stats) => {
      const id = stats.characterId || stats.npcId;
      if (id) statsMap.set(id, stats);
    });
    return statsMap;
  }

  async getCreatureStats(creatureId: string, userId: string): Promise<CreatureStats | null> {
    // 🛡️ Sentinel: Verify access to character OR NPC (via campaign)
    const stats = await db.query.creatureStats.findFirst({
      where: and(
        or(
          eq(creatureStats.characterId, creatureId),
          eq(creatureStats.npcId, creatureId)
        ),
        or(
          // Access via owned character
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, creatureStats.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          ),
          // Access via owned campaign (NPCs)
          exists(
            db.select()
              .from(npcs)
              .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
              .where(and(
                eq(npcs.id, creatureStats.npcId),
                eq(campaigns.userId, userId)
              ))
          )
        )
      ),
    });

    return stats || null;
  }

  /**
   * ⚡ Bolt: Fetch participant with their base creature stats in a single joined query.
   * This is more efficient than fetching the participant and then their stats separately.
   */
  /**
   * ⚡ Bolt: Fetch participant with their base creature stats, status, and encounter
   * in a single joined query. This eliminates redundant database round-trips when
   * resolving attacks and applying damage.
   */
  async getParticipantWithStats(
    participantId: string,
    encounterId: string,
    userId: string
  ): Promise<{ participant: any; stats: CreatureStats | null } | null> {
    const [result] = await db
      .select({
        participant: combatParticipants,
        stats: creatureStats,
        status: combatParticipantStatus,
        encounter: combatEncounters,
      })
      .from(combatParticipants)
      .leftJoin(
        creatureStats,
        or(
          and(
            isNotNull(combatParticipants.characterId),
            eq(combatParticipants.characterId, creatureStats.characterId)
          ),
          and(
            isNotNull(combatParticipants.npcId),
            eq(combatParticipants.npcId, creatureStats.npcId)
          )
        )
      )
      .leftJoin(combatParticipantStatus, eq(combatParticipants.id, combatParticipantStatus.participantId))
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(
        and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId),
          or(
            eq(campaigns.userId, userId),
            eq(characters.userId, userId),
            eq(characters.ownerId, userId)
          )
        )
      )
      .limit(1);

    if (!result) return null;

    return {
      participant: {
        ...result.participant,
        status: result.status,
        encounter: result.encounter,
      },
      stats: result.stats as CreatureStats | null,
    };
  }

  /**
   * ⚡ Bolt: Batch fetch multiple participants with their base creature stats, status, and encounter.
   * Eliminates N+1 database round-trips during multi-target resolution (e.g. AoE spells)
   * by combining participant data with their active combat status in a single query.
   */
  async getParticipantsWithStatsBatch(
    participantIds: string[],
    encounterId: string,
    userId: string
  ): Promise<Map<string, { participant: any; stats: CreatureStats | null }>> {
    if (participantIds.length === 0) return new Map();

    const results = await db
      .select({
        participant: combatParticipants,
        stats: creatureStats,
        status: combatParticipantStatus,
        encounter: combatEncounters,
      })
      .from(combatParticipants)
      .leftJoin(
        creatureStats,
        or(
          and(
            isNotNull(combatParticipants.characterId),
            eq(combatParticipants.characterId, creatureStats.characterId)
          ),
          and(
            isNotNull(combatParticipants.npcId),
            eq(combatParticipants.npcId, creatureStats.npcId)
          )
        )
      )
      .leftJoin(combatParticipantStatus, eq(combatParticipants.id, combatParticipantStatus.participantId))
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(
        and(
          inArray(combatParticipants.id, participantIds),
          eq(combatParticipants.encounterId, encounterId),
          or(
            eq(campaigns.userId, userId),
            eq(characters.userId, userId),
            eq(characters.ownerId, userId)
          )
        )
      );

    const resultMap = new Map<string, { participant: any; stats: CreatureStats | null }>();
    results.forEach((r) => {
      resultMap.set(r.participant.id, {
        participant: {
          ...r.participant,
          status: r.status,
          encounter: r.encounter,
        },
        stats: r.stats as CreatureStats | null,
      });
    });
    return resultMap;
  }

  /**
   * D&D 5E Auto-Crit Detection
   *
   * Per PHB: Attacks against paralyzed or unconscious creatures
   * are automatic critical hits if the attacker is within 5 feet.
   *
   * @param targetConditions - Array of condition names on the target
   * @param distanceInFeet - Distance to target (undefined = assume melee/within 5ft)
   * @returns true if the attack should be an automatic critical hit
   */
  checkAutoCrit(targetConditions?: string[], distanceInFeet?: number): boolean {
    if (!targetConditions || targetConditions.length === 0) {
      return false;
    }

    // D&D 5E conditions that grant auto-crit within 5ft
    const autoCritConditions = ['paralyzed', 'unconscious'];

    // Check if target has any auto-crit conditions
    const hasAutoCritCondition = targetConditions.some(condition =>
      autoCritConditions.includes(condition.toLowerCase())
    );

    if (!hasAutoCritCondition) {
      return false;
    }

    // Auto-crit only applies within 5ft
    // If distance not specified, assume melee range (within 5ft)
    const isWithin5Feet = distanceInFeet === undefined || distanceInFeet <= 5;

    return isWithin5Feet;
  }

  /**
   * Get a combat participant scoped to a specific encounter.
   * Used to prevent cross-encounter resource access.
   */
  private async getParticipantInEncounter(participantId: string, encounterId: string) {
    const participant = await db.query.combatParticipants.findFirst({
      where: and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId)
      ),
    });

    if (!participant) {
      throw new NotFoundError('Participant', participantId);
    }

    return participant;
  }

  /**
   * Helper: Roll damage dice
   * Parses dice notation like "1d8", "2d6", etc.
   */
  private rollDamageDice(damageDice: string, isCritical: boolean): number {
    const match = /^(\d+)d(\d+)$/i.exec(damageDice.trim());
    if (!match || !match[1] || !match[2]) {
      throw new ValidationError(`Invalid dice notation: ${damageDice}`, { damageDice });
    }

    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);

    // For critical, double the number of dice
    const diceToRoll = isCritical ? count * 2 : count;

    let total = 0;
    for (let i = 0; i < diceToRoll; i++) {
      total += Math.floor(Math.random() * sides) + 1;
    }

    return total;
  }

}

// Export singleton instance
export const combatAttackService = new CombatAttackService();
