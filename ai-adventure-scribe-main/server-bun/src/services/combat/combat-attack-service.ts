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
  monsterAttackSource,
} from './data-access.js';
import { healthConditionForCombat } from './health-condition.js';
import { checkHit, checkAutoCrit } from './hit-check.js';
import { resolveParticipantArmorClass } from './participant-armor-class.js';
import { aggregateResistances } from './resistance-resolver.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { getSpellById, getSpellByName, isPlayerCombatSpell } from '../../data/spellData.js';
import { rollD20 } from '../../lib/dice.js';
import { NotFoundError, InternalServerError, BusinessLogicError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { checkLineOfSight, getCover, getDistance } from '../../tactical/engine.js';
import { entitySlug } from '../../tactical/identity.js';
import { CombatHPService } from '../combat-hp-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
import { SpellSlotsService } from '../spell-slots-service.js';
import { markPlayerDamageProvocation } from './npc-provocation.js';

import type { WeaponAttack, CreatureStats } from '../../../../db/schema/index';
import type {
  AttackRollInput,
  AttackResult,
  HitCheckInput,
  HitCheckResult,
  DamageCalculationInput,
  DamageCalculationResult,
  AttackProposal,
  SpellAttackInput,
  SpellAttackResult,
  CreateWeaponAttackInput,
  DamageType,
} from '../../types/combat.js';

/**
 * Whether the caller supplied a real d20 face. Guards the whole player-rolled path against a
 * client that sends `0`, `NaN`, or a number off the die: those must fall back to the engine's
 * own roll, never be treated as "the player rolled a 0" and silently auto-miss the turn.
 */
function isProvidedD20(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20;
}

type SpellDamageProfile = { damageDice: string; damageBonus: number };

/** Parse the compact damage notation used by the server's spell table. */
function parseSpellDamageNotation(value: string): SpellDamageProfile | null {
  const match = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(value.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = Number(match[4] ?? 0) * (match[3] === '-' ? -1 : 1);
  return { damageDice: `${count}d${sides}`, damageBonus: modifier };
}

function spellDamageProfile(
  spellId: string,
  notation: string | undefined,
  slotLevel: number,
): SpellDamageProfile | null {
  if (!notation) return null;
  const parsed = parseSpellDamageNotation(notation);
  if (!parsed) return null;
  if (spellId !== 'magic-missile') return parsed;

  // Magic Missile is the one leveled spell in the bounded issue scope. All darts are directed
  // at the single target supplied by the current combat action, so resolve their total as one
  // damage roll while preserving the per-dart +1 modifier.
  const darts = 3 + Math.max(0, slotLevel - 1);
  const diceMatch = /^(\d+)d(\d+)$/i.exec(parsed.damageDice);
  if (!diceMatch) return null;
  return {
    damageDice: `${Number(diceMatch[1]) * darts}d${diceMatch[2]}`,
    damageBonus: parsed.damageBonus * darts,
  };
}

export class CombatAttackService {
  constructor() {
    // No database client needed - using global db instance
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
   * Everything an attack needs to know before anything is claimed, rolled, or written.
   *
   * Split out of `resolveAttack` so `proposeAttack` can answer "what would this attack be?"
   * from exactly the same reads and the same `resolveAttackRules` call that will later resolve
   * it. Two code paths computing the attack bonus independently is how a popup ends up
   * promising `1d20+7` against a resolution that applies `+5`, and the player is shown a number
   * the engine never used. There is one computation, and both phases call it.
   *
   * Everything here is a read. Nothing claims the turn action or touches hit points.
   */
  private async prepareAttack(encounterId: string, input: AttackRollInput, userId: string) {
    const { attackerId, targetId, weaponId, advantage = false, disadvantage = false } = input;

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
    const baseTargetAc = resolveParticipantArmorClass(targetParticipant.armorClass, {
      participantId: targetParticipant.id,
      encounterId,
    });
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

    return {
      attackerData,
      targetParticipant,
      targetStats,
      weapon,
      geometry,
      baseTargetAc,
      targetConditions,
      tacticalMap,
      rules,
    };
  }

  /**
   * What this attack would be, without being it.
   *
   * The player rolls their own attack die (owner decision, 2026-08-10), and a die is only
   * meaningful beside the numbers it will be judged against — the bonus added to it, the AC it
   * must beat, and whether the rules grant advantage. Those are all engine facts: cover, the
   * target's dodge, conditions on either side. So the popup cannot compute them, and asking the
   * player for a naked d20 while the server does the arithmetic out of sight would make the
   * engine less visible, not more.
   *
   * Strictly non-mutating: no turn claim, no roll, no damage. A proposal that is never
   * committed leaves the encounter exactly as it found it, which is what makes it safe to
   * discard when the player closes the popup.
   */
  async proposeAttack(
    encounterId: string,
    input: AttackRollInput,
    userId: string,
  ): Promise<AttackProposal> {
    const { weapon, rules, geometry, baseTargetAc } = await this.prepareAttack(
      encounterId,
      input,
      userId,
    );
    return {
      legal: rules.legal,
      refusal: rules.refusal ?? null,
      weaponName: weapon.name || 'attack',
      attackBonus: rules.attackBonus,
      targetAc: rules.targetAc,
      baseAc: baseTargetAc,
      coverBonus: rules.targetAc - baseTargetAc,
      cover: geometry?.cover ?? null,
      advantage: rules.advantage,
      disadvantage: rules.disadvantage,
    };
  }

  /**
   * Resolve a complete attack
   */
  async resolveAttack(
    encounterId: string,
    input: AttackRollInput,
    userId: string,
  ): Promise<AttackResult> {
    const { attackerId, expectedVersion, targetId, providedD20 } = input;

    const {
      attackerData,
      targetParticipant,
      targetStats,
      weapon,
      geometry,
      baseTargetAc,
      targetConditions,
      tacticalMap,
      rules,
    } = await this.prepareAttack(encounterId, input, userId);

    if (!rules.legal) {
      throw new BusinessLogicError(`Attack refused: ${rules.refusal}`, { refusal: rules.refusal });
    }

    // Version and action claims happen only after all legal-action checks pass.
    // Wrapped so that anything throwing below -- damage application above all --
    // releases the claim instead of stranding the actor mid-turn.
    return claimTurnActionAndResolve(attackerId, encounterId, expectedVersion, async () => {
      // The player's own die when they rolled one, and only then. `rollD20` already applied
      // advantage when it rolled; a provided die was rolled in the popup, which was told the
      // advantage state by `proposeAttack` and submits the die it kept. Rolling a second die
      // here would apply advantage twice.
      const autoRolled = !isProvidedD20(providedD20);
      const attackRoll = autoRolled
        ? rollD20(rules.advantage, rules.disadvantage)
        : (providedD20 as number);

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
        profileSource:
          attackerData.participant.characterId || attackerData.participant.npcId
            ? 'character-sheet'
            : monsterAttackSource(attackerData.participant),
        d20: attackRoll,
        autoRolled,
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
          d20: attackRoll,
          attackBonus: rules.attackBonus,
          targetAC,
          totalAttackRoll: hitCheck.totalAttackRoll,
          effectiveResistance: false,
          effectiveVulnerability: false,
          effectiveImmunity: false,
          finalDamage: 0,
          isCritical: false,
          isNaturalOne: hitCheck.isNaturalOne,
          isNaturalTwenty: hitCheck.isNaturalTwenty,
          autoRolled,
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
            // Previously never passed, so two 5E rules downstream of it were dead code: a
            // crit against a downed creature costs it two death-save failures rather than
            // one, and the per-hit safety cap treats a crit differently from an ordinary hit.
            isCriticalHit: isCrit,
          },
          userId,
          targetParticipant,
        );

        // The applied figure is what the HP layer actually took, which is not always what the
        // dice said: the per-hit cap can rewrite it. Reporting the rolled number here would
        // put a damage figure in the telemetry that the target's HP never reflects.
        const appliedDamage = hpResult.damageDealt ?? damageCalc.finalDamage;

        // Logged after the HP write, with the post-write HP included: damage that is
        // calculated but never persisted -- the exact failure mode this telemetry exists to
        // rule in or out -- shows up here as a nonzero damageApplied beside an unmoved HP.
        logAttackResolution({
          ...observed,
          outcome: 'hit',
          critical: isCrit,
          damageRolled: damageCalc.damageBeforeResistances,
          damageApplied: appliedDamage,
          targetHpAfter: hpResult.newCurrentHp,
        });

        const transcriptLines = await markPlayerDamageProvocation({
          encounterId,
          source: attackerData.participant,
          target: targetParticipant,
          damage: appliedDamage,
        });

        return {
          hit: true,
          d20: attackRoll,
          attackBonus: rules.attackBonus,
          targetAC,
          totalAttackRoll: hitCheck.totalAttackRoll,
          damage: damageCalc.baseDamage,
          damageType: weapon.damageType as DamageType,
          damageBeforeResistances: damageCalc.damageBeforeResistances,
          effectiveResistance: damageCalc.effectiveResistance,
          effectiveVulnerability: damageCalc.effectiveVulnerability,
          effectiveImmunity: damageCalc.effectiveImmunity,
          finalDamage: appliedDamage,
          targetNewHp: hpResult.newCurrentHp,
          targetIsConscious: hpResult.isConscious,
          targetIsDead: hpResult.isDead,
          targetCondition: healthConditionForCombat(
            hpResult.newCurrentHp,
            targetParticipant.maxHp,
            hpResult.isConscious,
            hpResult.isDead,
          ),
          isCritical: isCrit,
          isNaturalOne: hitCheck.isNaturalOne,
          isNaturalTwenty: hitCheck.isNaturalTwenty,
          autoRolled,
          ...(transcriptLines.length ? { transcriptLines } : {}),
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
    const { casterId, expectedVersion, targetIds, spellId, spellName, slotLevel, d20 } = input;

    await this.assertCurrentTurn(encounterId, casterId, userId);
    const spell = spellId ? getSpellById(spellId) : getSpellByName(spellName);

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
    if (!spell) {
      throw new BusinessLogicError(`Spell refused: unknown spell "${spellName}"`, {
        reason: 'unknown_spell',
        spell: spellName,
      });
    }
    if (!isPlayerCombatSpell(spell)) {
      throw new BusinessLogicError(
        `Spell refused: ${spell.name} is outside the player combat scope`,
        {
          reason: 'unsupported_spell',
          spell: spell.name,
        },
      );
    }
    if (spell.level >= 1 && (slotLevel === undefined || slotLevel === null)) {
      throw new BusinessLogicError(`Spell refused: ${spell.name} needs a spell slot level`, {
        reason: 'missing_spell_slot_level',
        spell: spell.name,
      });
    }
    if (
      !spell.damage ||
      (!spell.attackType && !spell.saveAbility && spell.id !== 'magic-missile')
    ) {
      throw new BusinessLogicError(
        `Spell refused: ${spell.name} has no supported combat resolution`,
        {
          reason: 'unsupported_spell_resolution',
          spell: spell.name,
        },
      );
    }
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
      const targetAc = resolveParticipantArmorClass(targetData.participant.armorClass, {
        participantId: targetData.participant.id,
        encounterId,
      });
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
      const rawDamageDice = this.damageDiceForLevel(
        spell.damageByLevel,
        spell.level,
        slotLevel ?? undefined,
        casterProfile.level,
      );
      const damageType = spell.damageType as DamageType | undefined;
      const effectiveSlotLevel = Math.max(spell.level, slotLevel || spell.level);
      const damageProfile = spellDamageProfile(spell.id, rawDamageDice, effectiveSlotLevel);
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

        // Stored participant AC, including a real 10. NULL is unset and falls back to
        // generic 12 — never an in-band sentinel (#1871).
        const targetAC =
          spellRules.get(targetId)?.targetAc ??
          resolveParticipantArmorClass(targetParticipant.armorClass, {
            participantId: targetParticipant.id,
            encounterId,
          });

        // Aggregate resistances using the extracted module
        const defenses = aggregateResistances(targetParticipant, targetStats);

        if (spell.id === 'magic-missile') {
          if (!damageProfile || !damageType) {
            throw new BusinessLogicError(`Spell refused: ${spell.name} has no damage profile`, {
              reason: 'unresolved_spell',
              spell: spell.name,
            });
          }
          const damageCalc = calculateDamage({
            ...damageProfile,
            damageType,
            isCritical: false,
            resistances: defenses.resistances,
            vulnerabilities: defenses.vulnerabilities,
            immunities: defenses.immunities,
          });
          try {
            const hpResult = await CombatHPService.applyDamage(
              targetId,
              encounterId,
              {
                damageAmount: damageCalc.finalDamage,
                damageType,
                sourceParticipantId: casterId,
                sourceDescription: spell.name,
                ignoreResistances: true,
                ignoreImmunities: true,
              },
              userId,
              targetParticipant,
            );
            const attackResult: AttackResult = {
              hit: true,
              targetAC,
              totalAttackRoll: 0,
              damage: damageCalc.baseDamage,
              damageType,
              damageBeforeResistances: damageCalc.damageBeforeResistances,
              effectiveResistance: damageCalc.effectiveResistance,
              effectiveVulnerability: damageCalc.effectiveVulnerability,
              effectiveImmunity: damageCalc.effectiveImmunity,
              finalDamage: hpResult.damageDealt ?? damageCalc.finalDamage,
              targetNewHp: hpResult.newCurrentHp,
              targetIsConscious: hpResult.isConscious,
              targetIsDead: hpResult.isDead,
              targetCondition: healthConditionForCombat(
                hpResult.newCurrentHp,
                targetParticipant.maxHp,
                hpResult.isConscious,
                hpResult.isDead,
              ),
              isCritical: false,
              isNaturalOne: false,
              isNaturalTwenty: false,
              autoHit: true,
              spellName: spell.name,
            };
            const transcriptLines = await markPlayerDamageProvocation({
              encounterId,
              source: casterData.participant,
              target: targetParticipant,
              damage: attackResult.finalDamage,
            });
            return {
              ...attackResult,
              ...(transcriptLines.length ? { transcriptLines } : {}),
            };
          } catch (error) {
            logger.error({ msg: 'Failed to apply Magic Missile damage to HP', error });
            throw new InternalServerError('Magic Missile resolved but damage application failed', {
              error,
            });
          }
        } else if (spell.attackType) {
          // Spell attack roll
          const attackRules = spellRules.get(targetId);
          const attackRoll = isProvidedD20(d20)
            ? d20
            : rollD20(attackRules?.advantage, attackRules?.disadvantage);
          const hitCheckResult = checkHit({
            attackRoll,
            attackBonus: spellAttackBonus,
            targetAC,
          });

          if (!hitCheckResult.hit) {
            return {
              hit: false,
              d20: attackRoll,
              attackBonus: spellAttackBonus,
              targetAC,
              totalAttackRoll: hitCheckResult.totalAttackRoll,
              effectiveResistance: false,
              effectiveVulnerability: false,
              effectiveImmunity: false,
              finalDamage: 0,
              isCritical: false,
              isNaturalOne: hitCheckResult.isNaturalOne,
              isNaturalTwenty: hitCheckResult.isNaturalTwenty,
              spellName: spell.name,
            };
          }

          // Hit - calculate damage
          if (damageProfile && damageType) {
            // D&D 5E: Paralyzed/unconscious targets within 5ft = auto-crit
            const targetConditionsForTarget = await getActiveConditionNames(targetId);
            const autoCrit = checkAutoCrit(
              targetConditionsForTarget,
              spell.attackType === 'melee' ? 5 : undefined,
            );
            const spellIsCrit = hitCheckResult.isCritical || autoCrit;

            const damageCalc = calculateDamage({
              ...damageProfile,
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
                  sourceDescription: spell.name,
                  ignoreResistances: true, // Already applied in damage calculation
                  ignoreImmunities: true, // Already applied in damage calculation
                  isCriticalHit: spellIsCrit,
                },
                userId,
                targetParticipant,
              );

              const attackResult: AttackResult = {
                hit: true,
                d20: attackRoll,
                attackBonus: spellAttackBonus,
                targetAC,
                totalAttackRoll: hitCheckResult.totalAttackRoll,
                damage: damageCalc.baseDamage,
                damageType,
                damageBeforeResistances: damageCalc.damageBeforeResistances,
                effectiveResistance: damageCalc.effectiveResistance,
                effectiveVulnerability: damageCalc.effectiveVulnerability,
                effectiveImmunity: damageCalc.effectiveImmunity,
                finalDamage: hpResult.damageDealt ?? damageCalc.finalDamage,
                targetNewHp: hpResult.newCurrentHp,
                targetIsConscious: hpResult.isConscious,
                targetIsDead: hpResult.isDead,
                targetCondition: healthConditionForCombat(
                  hpResult.newCurrentHp,
                  targetParticipant.maxHp,
                  hpResult.isConscious,
                  hpResult.isDead,
                ),
                isCritical: spellIsCrit,
                isNaturalOne: hitCheckResult.isNaturalOne,
                isNaturalTwenty: hitCheckResult.isNaturalTwenty,
                spellName: spell.name,
              };
              const transcriptLines = await markPlayerDamageProvocation({
                encounterId,
                source: casterData.participant,
                target: targetParticipant,
                damage: attackResult.finalDamage,
              });
              return {
                ...attackResult,
                ...(transcriptLines.length ? { transcriptLines } : {}),
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
          const saveRoll = rollD20() + saveBonus;
          const savedSuccessfully = saveRoll >= saveDC;

          if (damageProfile && damageType) {
            const damageCalc = calculateDamage({
              ...damageProfile,
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
                  sourceDescription: spell.name,
                  ignoreResistances: true, // Already applied in damage calculation
                  ignoreImmunities: true, // Already applied in damage calculation
                },
                userId,
                targetParticipant,
              );

              const saveResult: AttackResult = {
                hit: !savedSuccessfully,
                targetAC: 0, // Not applicable for saves
                totalAttackRoll: saveRoll ?? 0,
                damage: damageCalc.baseDamage,
                damageType,
                damageBeforeResistances: damageCalc.damageBeforeResistances,
                effectiveResistance: damageCalc.effectiveResistance,
                effectiveVulnerability: damageCalc.effectiveVulnerability,
                effectiveImmunity: damageCalc.effectiveImmunity,
                finalDamage: hpResult.damageDealt ?? finalDamage,
                targetNewHp: hpResult.newCurrentHp,
                targetIsConscious: hpResult.isConscious,
                targetIsDead: hpResult.isDead,
                targetCondition: healthConditionForCombat(
                  hpResult.newCurrentHp,
                  targetParticipant.maxHp,
                  hpResult.isConscious,
                  hpResult.isDead,
                ),
                isCritical: false,
                isNaturalOne: false,
                isNaturalTwenty: false,
                spellName: spell.name,
                saveAbility: namedAbility,
                saveRoll,
                saveDC,
                saved: savedSuccessfully,
              };
              const transcriptLines = await markPlayerDamageProvocation({
                encounterId,
                source: casterData.participant,
                target: targetParticipant,
                damage: saveResult.finalDamage,
              });
              return {
                ...saveResult,
                ...(transcriptLines.length ? { transcriptLines } : {}),
              };
            } catch (error) {
              logger.error({ msg: 'Failed to apply spell save damage to HP', error });
              throw new InternalServerError('Spell save resolved but damage application failed', {
                error,
              });
            }
          }
        }
        throw new BusinessLogicError(`Spell refused: ${spell.name} produced no combat result`, {
          reason: 'unresolved_spell',
          spell: spell.name,
        });
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
