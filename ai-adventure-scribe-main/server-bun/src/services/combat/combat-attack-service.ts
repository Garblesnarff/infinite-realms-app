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

import { logAttackResolution, participantSlug } from './attack-telemetry.js';
import { resolveAttackRules } from './combat-rules.js';
import {
  claimTurnActionAndResolve,
  claimTurnBonusActionAndResolve,
} from './combat-turn-resources.js';
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
  getActiveConditionNames,
  getEquippedWeaponProfile,
} from './data-access.js';
import { checkHit, checkAutoCrit } from './hit-check.js';
import { aggregateResistances } from './resistance-resolver.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { getSpellById, getSpellByName } from '../../data/spellData.js';
import { NotFoundError, InternalServerError, BusinessLogicError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { checkLineOfSight, getCover, getDistance } from '../../tactical/engine.js';
import { entitySlug } from '../../tactical/identity.js';
import { CombatHPService } from '../combat-hp-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
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

  /**
   * The defensive gate behind the intent gateway. It splits the same two failures the gateway
   * does: an actorId that names no participant in this encounter is an unknown reference (404),
   * not a caller acting early (422). Reporting both as a turn error is what sent three separate
   * investigations reading initiative code to diagnose a slug that was never resolved.
   */
  private async assertCurrentTurn(encounterId: string, actorId: string, userId: string) {
    const current = await CombatInitiativeService.getCurrentTurn(encounterId, userId);
    if (current && current.id === actorId) return;
    const actorData = await getParticipantWithStats(actorId, encounterId, userId);
    if (!actorData) throw new NotFoundError('Combat participant', actorId);
    // The current participant's slug is logged beside its id because the slug is the only form
    // the DM ever sees, so an id-only log cannot be matched against what the DM was told.
    const sessionId = actorData.participant.encounter?.sessionId as string | undefined;
    const map = sessionId ? await loadActiveTacticalMap(sessionId) : null;
    const currentEntity = map?.entities.find((entity) => entity.id === current?.id);
    const detail = {
      encounterId,
      actorId,
      currentParticipantId: current?.id ?? null,
      currentParticipantSlug: currentEntity ? entitySlug(currentEntity) : null,
    };
    logger.warn({ msg: 'COMBAT_ATTACK_OUT_OF_TURN', ...detail });
    throw new BusinessLogicError('Actor is not the current-turn participant', detail);
  }

  private abilityModifier(score = 10): number {
    return Math.floor((score - 10) / 2);
  }

  private proficiencyBonus(level = 1): number {
    return 2 + Math.floor((Math.max(1, level) - 1) / 4);
  }

  private spellcastingAbility(className?: string | null): string {
    const normalized = className?.toLowerCase() || '';
    if (['bard', 'paladin', 'sorcerer', 'warlock'].some((name) => normalized.includes(name)))
      return 'cha';
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
    const keys = Object.keys(damageByLevel)
      .map(Number)
      .sort((a, b) => a - b);
    const effectiveLevel =
      spellLevel === 0
        ? Math.max(...keys.filter((level) => level <= casterLevel), keys[0] || 1)
        : Math.max(spellLevel, requestedLevel || spellLevel);
    const selected = [...keys].reverse().find((level) => level <= effectiveLevel) ?? keys[0];
    return selected === undefined ? undefined : damageByLevel[String(selected)];
  }

  private healingDice(
    spellId: string,
    slotLevel: number,
  ): { die: number; count: number; fixed?: number } | null {
    if (spellId === 'healing-word') return { die: 4, count: slotLevel };
    if (spellId === 'cure-wounds') return { die: 8, count: slotLevel };
    if (spellId === 'mass-healing-word') return { die: 4, count: Math.max(1, slotLevel - 2) };
    if (spellId === 'mass-cure-wounds') return { die: 8, count: Math.max(3, slotLevel - 2) };
    if (spellId === 'heal')
      return { die: 1, count: 0, fixed: 70 + Math.max(0, slotLevel - 6) * 10 };
    return null;
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
      advantage = false,
      disadvantage = false,
    } = input;

    await this.assertCurrentTurn(encounterId, attackerId, userId);

    // ⚡ Bolt: Batch fetch both attacker and target with their stats in a single query.
    // This reduces database round-trips from 3 down to 2 (1 for participants, 1 for weapon).
    // Authorization is handled atomically within getParticipantsWithStatsBatch.
    const participantDataMap = await getParticipantsWithStatsBatch(
      [attackerId, targetId],
      encounterId,
      userId,
    );
    const targetData = participantDataMap.get(targetId);
    const attackerData = participantDataMap.get(attackerId);

    if (!targetData) throw new NotFoundError('Target participant', targetId);
    if (!attackerData) throw new NotFoundError('Attacker participant', attackerId);

    const [weapon, attackerProfile, attackerConditions, targetConditions, tacticalMap] =
      await Promise.all([
        getEquippedWeaponProfile(attackerData.participant, weaponId),
        getParticipantAbilityProfile(attackerData.participant),
        getActiveConditionNames(attackerId),
        getActiveConditionNames(targetId),
        loadActiveTacticalMap(attackerData.participant.encounter.sessionId),
      ]);
    const { participant: targetParticipant, stats: targetStats } = targetData;
    const baseTargetAc =
      targetParticipant.armorClass !== 10
        ? targetParticipant.armorClass
        : targetStats?.armorClass || 10;
    const from = tacticalMap?.entities.find((entity) => entity.id === attackerId);
    const to = tacticalMap?.entities.find((entity) => entity.id === targetId);
    const geometry =
      tacticalMap && from && to
        ? {
            distanceFeet: getDistance(from, to),
            hasLineOfSight: checkLineOfSight(tacticalMap, attackerId, targetId),
            cover: getCover(tacticalMap, attackerId, targetId),
          }
        : undefined;
    const rules = resolveAttackRules({
      strength: attackerProfile.scores.str ?? 10,
      dexterity: attackerProfile.scores.dex ?? 10,
      level: attackerProfile.level,
      baseTargetAc,
      weapon,
      geometry,
      requestedAdvantage: advantage,
      requestedDisadvantage: disadvantage || targetParticipant.isDodging,
      attackerConditions,
      targetConditions,
    });
    if (!rules.legal) {
      throw new BusinessLogicError(`Attack refused: ${rules.refusal}`, { refusal: rules.refusal });
    }

    // Version and action claims happen only after all legal-action checks pass.
    // Wrapped so that anything throwing below -- damage application above all --
    // releases the claim instead of stranding the actor mid-turn.
    return claimTurnActionAndResolve(attackerId, encounterId, expectedVersion, async () => {
      const attackRoll = this.rollD20(rules.advantage, rules.disadvantage);

      const targetAC = rules.targetAc;

      // Check if attack hits
      const hitCheck = checkHit({
        attackRoll,
        attackBonus: rules.attackBonus,
        targetAC,
        advantage: rules.advantage,
        disadvantage: rules.disadvantage,
      });

      // Everything the telemetry line knows before damage is rolled. Both branches below
      // finish it with their own outcome, so a miss is logged as fully as a hit -- see
      // attack-telemetry.ts for why the miss is the case that actually matters.
      const observed = {
        encounterId,
        attackerId,
        attackerSlug: participantSlug(
          tacticalMap,
          attackerId,
          attackerData.participant.name as string | null,
        ),
        targetId,
        targetSlug: participantSlug(tacticalMap, targetId, targetParticipant.name as string | null),
        weapon: weapon.name || 'attack',
        d20: attackRoll,
        attackBonus: rules.attackBonus,
        totalAttack: hitCheck.totalAttackRoll,
        baseAc: baseTargetAc,
        effectiveAc: targetAC,
        cover: geometry?.cover ?? null,
        coverBonus: targetAC - baseTargetAc,
        advantage: rules.advantage,
        disadvantage: rules.disadvantage,
        naturalOne: hitCheck.isNaturalOne,
        naturalTwenty: hitCheck.isNaturalTwenty,
      } as const;

      if (!hitCheck.hit) {
        logAttackResolution({
          ...observed,
          outcome: 'miss',
          critical: false,
          damageRolled: null,
          damageApplied: null,
          targetHpAfter: null,
        });
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
      const autoCrit = checkAutoCrit(
        targetConditions,
        !weapon.ranged && (geometry?.distanceFeet ?? 5) <= 5 ? 5 : undefined,
      );
      const isCrit = hitCheck.isCritical || autoCrit;

      // Aggregate resistances using the extracted module
      const defenses = aggregateResistances(targetParticipant, targetStats);

      const damageCalc = calculateDamage({
        damageDice: weapon.damageDice,
        damageBonus: rules.damageBonus,
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

        // Logged after the HP write, with the post-write HP included: damage that is
        // calculated but never persisted -- the exact failure mode this telemetry exists to
        // rule in or out -- shows up here as a nonzero damageApplied beside an unmoved HP.
        logAttackResolution({
          ...observed,
          outcome: 'hit',
          critical: isCrit,
          damageRolled: damageCalc.damageBeforeResistances,
          damageApplied: damageCalc.finalDamage,
          targetHpAfter: hpResult.newCurrentHp,
        });

        return {
          hit: true,
          targetAC,
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
    });
  }

  /**
   * Resolve a spell attack against multiple targets
   */
  async resolveSpellAttack(
    encounterId: string,
    input: SpellAttackInput,
    userId: string,
  ): Promise<SpellAttackResult> {
    const { casterId, expectedVersion, targetIds, spellId, spellName, slotLevel } = input;

    await this.assertCurrentTurn(encounterId, casterId, userId);
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
    if (
      casterData.participant.characterId &&
      !casterProfile.spellIds.includes(spell.id.toLowerCase()) &&
      !casterProfile.spellIds.includes(spell.name.toLowerCase())
    ) {
      throw new BusinessLogicError('Caster does not know or have this spell prepared', {
        spellId: spell.id,
      });
    }
    const tacticalMap = await loadActiveTacticalMap(casterData.participant.encounter.sessionId);
    const spellRange = Number(
      spell.range.match(/\d+/)?.[0] ?? (spell.attackType === 'melee' ? 5 : 0),
    );
    const casterConditions = await getActiveConditionNames(casterId);
    const spellRules = new Map<string, ReturnType<typeof resolveAttackRules>>();
    for (const targetId of targetIds) {
      const targetData = allParticipantDataMap.get(targetId);
      if (!targetData) throw new NotFoundError('Target participant', targetId);
      const targetConditions = await getActiveConditionNames(targetId);
      const targetAc =
        targetData.participant.armorClass !== 10
          ? targetData.participant.armorClass
          : targetData.stats?.armorClass || 10;
      const from = tacticalMap?.entities.find((entity) => entity.id === casterId);
      const to = tacticalMap?.entities.find((entity) => entity.id === targetId);
      const rules = resolveAttackRules({
        strength: casterProfile.scores.str ?? 10,
        dexterity: casterProfile.scores.dex ?? 10,
        level: casterProfile.level,
        baseTargetAc: targetAc,
        weapon: {
          id: spell.id,
          name: spell.name,
          damageDice: '1d1',
          damageType: spell.damageType ?? 'force',
          normalRange: spellRange,
          magicBonus: 0,
          finesse: false,
          ranged: spell.attackType !== 'melee',
          proficient: true,
        },
        geometry:
          tacticalMap && from && to
            ? {
                distanceFeet: getDistance(from, to),
                hasLineOfSight: checkLineOfSight(tacticalMap, casterId, targetId),
                cover: getCover(tacticalMap, casterId, targetId),
              }
            : undefined,
        attackerConditions: casterConditions,
        targetConditions,
      });
      if (!rules.legal)
        throw new BusinessLogicError(`Spell refused: ${rules.refusal}`, {
          targetId,
          refusal: rules.refusal,
        });
      spellRules.set(targetId, rules);
    }
    const usesBonusAction = spell.castingTime.toLowerCase().includes('bonus action');
    // Same release-on-throw wrapper as resolveAttack. It matters more here: the
    // claim is made once and then damage is applied to every target in turn, so
    // a throw on target three would otherwise strand the caster after two
    // targets had already taken damage.
    const claimAndResolve = usesBonusAction
      ? claimTurnBonusActionAndResolve
      : claimTurnActionAndResolve;
    return claimAndResolve(casterId, encounterId, expectedVersion, async () => {
      if (casterData.participant.characterId && spell.level > 0) {
        // Not a React hook: a static service method on a Bun server that happens to start with
        // "use". The rule matches on the name alone, and this file has no React in it at all.

        await SpellSlotsService.useSpellSlot(
          {
            characterId: casterData.participant.characterId,
            spellName: spell.name,
            spellLevel: spell.level,
            slotLevelUsed: Math.max(spell.level, slotLevel || spell.level),
            sessionId: casterData.participant.encounter?.sessionId,
          },
          userId,
        );
      }
      const spellAbility = this.spellcastingAbility(casterProfile.className);
      const spellModifier = this.abilityModifier(casterProfile.scores[spellAbility]);
      const proficiencyBonus = this.proficiencyBonus(casterProfile.level);
      const spellAttackBonus = spellModifier + proficiencyBonus;
      const saveDC = 8 + spellAttackBonus;
      const damageDice = this.damageDiceForLevel(
        spell.damageByLevel,
        spell.level,
        slotLevel,
        casterProfile.level,
      );
      const damageType = spell.damageType as DamageType | undefined;
      const effectiveSlotLevel = Math.max(spell.level, slotLevel || spell.level);
      const healing = this.healingDice(spell.id, effectiveSlotLevel);

      const results: AttackResult[] = [];

      // Parallelize spell resolution for all targets using the pre-fetched data map.
      const resolutionPromises = targetIds.map(async (targetId) => {
        const targetData = allParticipantDataMap.get(targetId);
        if (!targetData) {
          return null;
        }

        const { participant: targetParticipant, stats: targetStats } = targetData;

        if (healing) {
          const rolledHealing =
            healing.fixed ??
            Array.from(
              { length: healing.count },
              () => Math.floor(Math.random() * healing.die) + 1,
            ).reduce((total, roll) => total + roll, 0) + spellModifier;
          const hpResult = await CombatHPService.healDamage(
            targetId,
            encounterId,
            Math.max(1, rolledHealing),
            spell.name,
            userId,
          );
          return {
            hit: true,
            targetAC: 0,
            totalAttackRoll: 0,
            finalDamage: 0,
            targetNewHp: hpResult.newCurrentHp,
            targetIsConscious: true,
            targetIsDead: false,
            effectiveResistance: false,
            effectiveVulnerability: false,
            effectiveImmunity: false,
            isCritical: false,
            isNaturalOne: false,
            isNaturalTwenty: false,
          };
        }

        // Determine target AC: Use combat participant AC (allows for temporary modifications)
        // with fallback to base creature stats if participant AC is the default 10.
        const targetAC =
          spellRules.get(targetId)?.targetAc ??
          (targetParticipant.armorClass !== 10
            ? targetParticipant.armorClass
            : targetStats?.armorClass || 10);

        // Aggregate resistances using the extracted module
        const defenses = aggregateResistances(targetParticipant, targetStats);

        if (spell.attackType) {
          // Spell attack roll
          const attackRules = spellRules.get(targetId);
          const attackRoll = this.rollD20(attackRules?.advantage, attackRules?.disadvantage);
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
            const autoCrit = checkAutoCrit(
              targetConditionsForTarget,
              spell.attackType === 'melee' ? 5 : undefined,
            );
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
              throw new InternalServerError(
                'Spell attack succeeded but damage application failed',
                {
                  error,
                },
              );
            }
          }
        } else if (spell.saveAbility) {
          // Saving throw spell
          const targetProfile = await getParticipantAbilityProfile(targetParticipant);
          const ability = spell.saveAbility.toLowerCase();
          const namedAbility = (
            {
              str: 'strength',
              dex: 'dexterity',
              con: 'constitution',
              int: 'intelligence',
              wis: 'wisdom',
              cha: 'charisma',
            } as Record<string, string>
          )[ability];
          const explicitBonus =
            targetProfile.saveBonuses[ability] ?? targetProfile.saveBonuses[namedAbility];
          const proficient =
            targetProfile.savingThrowProficiencies.includes(ability) ||
            targetProfile.savingThrowProficiencies.includes(namedAbility);
          const saveBonus =
            explicitBonus ??
            this.abilityModifier(targetProfile.scores[ability]) +
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
              ? spell.saveSuccess === 'half'
                ? Math.floor(damageCalc.finalDamage / 2)
                : 0
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
    });
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
