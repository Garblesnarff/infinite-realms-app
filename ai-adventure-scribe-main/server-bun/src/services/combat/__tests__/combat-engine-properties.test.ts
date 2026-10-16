/**
 * Property checks for the combat engine (#662 item 2).
 *
 * Each case seats 1–4 player characters and 1–6 monsters, then runs one NPC
 * turn sequence through `advanceNpcTurns` with the same in-memory dependencies
 * `npc-turn-runner.test.ts` uses. No database and no model call.
 *
 * The producers are the engine functions themselves:
 * `HPMechanics.calculateDamageResult`, `deriveAttackFromHitPoints`,
 * `resolveMonsterAttackProfile`, `scaleMonsterForParty`,
 * `InitiativeMechanics.sortParticipants`, `evaluateSceneEnd`,
 * `partyHasLeftTheFight`, and `advanceNpcTurns`. Attack rolls and damage
 * dice come from `server-bun/src/lib/rng.ts`. Each case sets `DICE_SEED`
 * and checks that reseeding repeats the first roll.
 */
import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';

import { combatLogger } from '../../../lib/logger.js';
import { resetRngFromEnv, rollDie } from '../../../lib/rng.js';
import {
  evaluateSceneEnd,
  partyHasLeftTheFight,
  type SceneEndParticipant,
} from '../combat-end-guard.js';
import { resolveAttackRules, type WeaponRuleProfile } from '../combat-rules.js';
import { HPMechanics, type ParticipantResistances } from '../hp-mechanics.js';
import { InitiativeMechanics } from '../initiative-mechanics.js';
import {
  crBandForHitPoints,
  deriveAttackFromHitPoints,
  resolveMonsterAttackProfile,
  type MonsterAttackProfile,
} from '../monster-attack-profile.js';
import { advanceNpcTurns, type NpcTurnRunnerDependencies } from '../npc-turn-runner.js';
import { averageDamage, scaleMonsterForParty } from '../party-scaling.js';

combatLogger.level = 'silent';

const RUNS = 500;
const TIME_BUDGET_MS = 30_000;

type Side = 'player' | 'monster';

type Seated = {
  id: string;
  name: string;
  participantType: Side;
  isActive: boolean;
  maxHp: number;
  actionUsed: boolean;
  armorClass: number;
  initiative: number;
  initiativeModifier: number;
  monsterAttack?: MonsterAttackProfile;
  status: {
    currentHp: number;
    isConscious: boolean;
    deathSavesSuccesses: number;
    deathSavesFailures: number;
  };
};

type ResistanceMode = 'none' | 'resist' | 'immune' | 'vulnerable';

type EncounterDraw = {
  partySize: number;
  monsterCount: number;
  monsterMaxHp: number[];
  monsterCurrentHp: number[];
  playerMaxHp: number[];
  playerCurrentHp: number[];
  armorClass: number[];
  initiative: number[];
  initiativeModifier: number[];
  monsterActionUsed: boolean[];
  startAt: number;
  damageAmount: number;
  /** Passed to `DICE_SEED`. The same value replays every `rollDie` in the case. */
  rngSeed: number;
  resistance: ResistanceMode;
};

const encounterArb: fc.Arbitrary<EncounterDraw> = fc.record({
  partySize: fc.integer({ min: 1, max: 4 }),
  monsterCount: fc.integer({ min: 1, max: 6 }),
  monsterMaxHp: fc.array(fc.integer({ min: 1, max: 850 }), { minLength: 6, maxLength: 6 }),
  monsterCurrentHp: fc.array(fc.integer({ min: 0, max: 850 }), { minLength: 6, maxLength: 6 }),
  playerMaxHp: fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 4, maxLength: 4 }),
  playerCurrentHp: fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 4, maxLength: 4 }),
  armorClass: fc.array(fc.integer({ min: 8, max: 22 }), { minLength: 10, maxLength: 10 }),
  initiative: fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 10, maxLength: 10 }),
  initiativeModifier: fc.array(fc.integer({ min: -2, max: 5 }), { minLength: 10, maxLength: 10 }),
  monsterActionUsed: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  startAt: fc.integer({ min: 0, max: 9 }),
  damageAmount: fc.integer({ min: 0, max: 2000 }),
  rngSeed: fc.integer({ min: 1, max: 2147483647 }),
  resistance: fc.constantFrom('none', 'resist', 'immune', 'vulnerable'),
});

/** `NdN` plus a flat bonus, rolled through the seedable module. */
function rollExpression(dice: string, bonus: number): number {
  const match = /^(\d+)d(\d+)$/.exec(dice.trim().toLowerCase());
  if (!match) return Math.max(0, bonus);
  let total = Math.max(0, bonus);
  const count = Number(match[1]);
  const sides = Number(match[2]);
  for (let face = 0; face < count; face += 1) total += rollDie(sides);
  return total;
}

const resistancesFor = (mode: ResistanceMode): ParticipantResistances => {
  if (mode === 'resist') return { damageResistances: ['bludgeoning'] };
  if (mode === 'immune') return { damageImmunities: ['bludgeoning'] };
  if (mode === 'vulnerable') return { damageVulnerabilities: ['bludgeoning'] };
  return {};
};

const fallbackWeapon: WeaponRuleProfile = {
  id: 'unarmed-strike',
  name: 'Unarmed Strike',
  damageDice: '1d1',
  damageType: 'bludgeoning',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
};

function seatOne(
  id: string,
  side: Side,
  maxHp: number,
  currentHp: number,
  armorClass: number,
  initiative: number,
  initiativeModifier: number,
  actionUsed: boolean,
  partySize: number,
): Seated {
  const hp = Math.min(maxHp, Math.max(0, currentHp));
  const seated: Seated = {
    id,
    name: id,
    participantType: side,
    isActive: true,
    maxHp,
    actionUsed,
    armorClass,
    initiative,
    initiativeModifier,
    status: {
      currentHp: hp,
      isConscious: hp > 0,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    },
  };
  if (side === 'monster') {
    const raw = resolveMonsterAttackProfile({ maxHp });
    const scaled = scaleMonsterForParty({
      rawMaxHp: maxHp,
      rawCurrentHp: maxHp,
      attackProfile: raw,
      partySize,
    });
    const fromRaw = deriveAttackFromHitPoints(maxHp);
    const rawBudget = crBandForHitPoints(maxHp).damagePerRound;
    const scaledBudget = crBandForHitPoints(scaled.maxHp).damagePerRound;
    if (!raw.derivation || !scaled.attackProfile?.derivation) {
      throw new Error(`monster ${id} has no HP-derived attack budget`);
    }
    expect(raw.attacks[0]?.damageDice).toBe(fromRaw.damageDice);
    expect(raw.attacks[0]?.damageBonus).toBe(fromRaw.damageBonus);
    expect(raw.attacks[0]?.attackBonus).toBe(fromRaw.attackBonus);
    expect(raw.derivation.fromMaxHp).toBe(maxHp);
    expect(raw.derivation.damagePerRound).toBe(rawBudget);
    expect(scaled.attackProfile.derivation.fromMaxHp).toBe(maxHp);
    expect(scaled.attackProfile.derivation.damagePerRound).toBe(rawBudget);
    expect(scaled.factor).toBe(Math.min(1, Math.max(1, Math.floor(partySize)) / 4));
    expect(scaled.factor).toBeLessThanOrEqual(1);
    expect(scaled.maxHp).toBeLessThanOrEqual(maxHp);
    expect(scaled.maxHp).toBeGreaterThanOrEqual(1);
    if (scaledBudget !== rawBudget) {
      expect(scaled.attackProfile.derivation.damagePerRound).not.toBe(scaledBudget);
    }
    const scaledAttack = scaled.attackProfile.attacks[0];
    const rawAttack = raw.attacks[0];
    if (scaledAttack && rawAttack) {
      expect(averageDamage(scaledAttack)).toBeLessThanOrEqual(averageDamage(rawAttack));
      expect(scaledAttack.attackBonus).toBe(rawAttack.attackBonus);
      if (partySize >= 4) {
        expect(scaled.factor).toBe(1);
        expect(scaled.maxHp).toBe(maxHp);
        expect(scaledAttack.damageDice).toBe(rawAttack.damageDice);
        expect(scaledAttack.damageBonus).toBe(rawAttack.damageBonus);
      }
    }
    seated.monsterAttack = scaled.attackProfile;
  }
  return seated;
}

function seat(draw: EncounterDraw): Seated[] {
  const rows: Seated[] = [];
  for (let index = 0; index < draw.partySize; index += 1) {
    rows.push(
      seatOne(
        `pc-${index}`,
        'player',
        draw.playerMaxHp[index] ?? 1,
        draw.playerCurrentHp[index] ?? 0,
        draw.armorClass[index] ?? 10,
        draw.initiative[index] ?? 1,
        draw.initiativeModifier[index] ?? 0,
        false,
        draw.partySize,
      ),
    );
  }
  for (let index = 0; index < draw.monsterCount; index += 1) {
    rows.push(
      seatOne(
        `mon-${index}`,
        'monster',
        draw.monsterMaxHp[index] ?? 1,
        draw.monsterCurrentHp[index] ?? 0,
        draw.armorClass[draw.partySize + index] ?? 12,
        draw.initiative[draw.partySize + index] ?? 1,
        draw.initiativeModifier[draw.partySize + index] ?? 0,
        draw.monsterActionUsed[index] ?? false,
        draw.partySize,
      ),
    );
  }
  return rows;
}

function asScene(rows: readonly Seated[], leftWhenHpHitsZero: boolean): SceneEndParticipant[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    participantType: row.participantType,
    isActive: leftWhenHpHitsZero ? row.status.currentHp > 0 : row.isActive,
    maxHp: row.maxHp,
    status: {
      currentHp: row.status.currentHp,
      isConscious: leftWhenHpHitsZero ? row.status.currentHp > 0 : row.status.isConscious,
    },
  }));
}

/** The guard's own "one side is gone": no active player, or no live hostile. */
function sideHasLeft(rows: readonly SceneEndParticipant[]): boolean {
  const partyHere = rows.some((row) => row.participantType === 'player' && row.isActive);
  const hostileUp = rows.some(
    (row) =>
      row.participantType === 'monster' &&
      row.isActive &&
      (row.status?.currentHp ?? 0) > 0 &&
      row.status?.isConscious !== false,
  );
  return !partyHere || !hostileUp;
}

function expectEndGuardMatches(rows: readonly SceneEndParticipant[]): void {
  const ended = evaluateSceneEnd(rows, []).allowed || partyHasLeftTheFight(rows);
  expect(ended).toBe(sideHasLeft(rows));
}

/**
 * Seated rows keep `isActive` as seated. A player at 0 HP who is still active has
 * not left, so a live hostile keeps the fight open. A second roster ties leaving
 * the turn order to 0 HP (a dead monster, a player who has exited). That roster
 * is not the seated one.
 */
function fightEndMatchesTheGuard(rows: readonly Seated[]): void {
  expectEndGuardMatches(asScene(rows, false));
  expectEndGuardMatches(asScene(rows, true));
}

function applyHit(target: Seated, damageAmount: number, mode: ResistanceMode): number {
  const result = HPMechanics.calculateDamageResult(
    target.id,
    {
      currentHp: target.status.currentHp,
      maxHp: target.maxHp,
      tempHp: 0,
      isConscious: target.status.isConscious,
      deathSavesSuccesses: target.status.deathSavesSuccesses,
      deathSavesFailures: target.status.deathSavesFailures,
    },
    resistancesFor(mode),
    {
      damageAmount,
      damageType: 'bludgeoning',
      isCriticalHit: false,
      targetIsPlayer: target.participantType === 'player',
    },
  );
  expect(result.newCurrentHp).toBeGreaterThanOrEqual(0);
  target.status.currentHp = result.newCurrentHp;
  target.status.isConscious = result.isConscious;
  target.status.deathSavesFailures = result.newDeathSavesFailures;
  target.status.deathSavesSuccesses =
    result.newDeathSavesSuccesses ?? target.status.deathSavesSuccesses;
  return result.newCurrentHp;
}

function nextSeat(rows: Seated[], currentId: string): Seated {
  const order = InitiativeMechanics.sortParticipants(rows);
  const index = order.findIndex((row) => row.id === currentId);
  return order[(index + 1) % order.length] ?? order[0];
}

describe('combat engine properties', () => {
  it(
    'holds for 500 seated encounters in under 30s',
    async () => {
      // A player at 0 who is still in the turn order has not left. A live hostile
      // keeps the fight open. "Ends iff one side is at 0" below ties isActive to
      // current HP, which is how a dead monster and an exited player leave.
      const dyingPlayer: SceneEndParticipant = {
        id: 'dying-player',
        participantType: 'player',
        isActive: true,
        status: { currentHp: 0, isConscious: false },
      };
      const liveHostile: SceneEndParticipant = {
        id: 'live-hostile',
        participantType: 'monster',
        isActive: true,
        status: { currentHp: 1, isConscious: true },
      };
      expect(evaluateSceneEnd([dyingPlayer, liveHostile], []).allowed).toBe(false);
      expect(partyHasLeftTheFight([dyingPlayer, liveHostile])).toBe(false);

      const started = Date.now();
      await fc.assert(
        fc.asyncProperty(encounterArb, async (draw) => {
          const previousDiceSeed = process.env.DICE_SEED;
          process.env.DICE_SEED = String(draw.rngSeed);
          resetRngFromEnv();
          try {
            const opened = rollDie(20);
            resetRngFromEnv();
            expect(rollDie(20)).toBe(opened);
            resetRngFromEnv();
            const participants = seat(draw);
            fightEndMatchesTheGuard(participants);
            const orderBefore = InitiativeMechanics.sortParticipants(participants).map(
              (row) => row.id,
            );
            const wounded = participants.map((row) => ({
              ...row,
              status: { ...row.status, currentHp: 0 },
            }));
            expect(InitiativeMechanics.sortParticipants(wounded).map((row) => row.id)).toEqual(
              orderBefore,
            );

            for (const row of participants) {
              const probed = applyHit(
                {
                  ...row,
                  status: { ...row.status },
                },
                draw.damageAmount,
                draw.resistance,
              );
              expect(probed).toBeGreaterThanOrEqual(0);
              if (row.participantType !== 'monster') continue;
              const attack = row.monsterAttack?.attacks[0];
              expect(attack).toBeTruthy();
              if (!attack) continue;
              const rules = resolveAttackRules({
                strength: 10,
                dexterity: 10,
                level: 1,
                baseTargetAc: row.armorClass,
                weapon: {
                  ...fallbackWeapon,
                  id: `budget:${row.id}`,
                  damageDice: attack.damageDice,
                  fixedAttackBonus: attack.attackBonus,
                  fixedDamageBonus: attack.damageBonus,
                },
              });
              expect(rules.legal).toBe(true);
              expect(rules.targetAc).toBe(row.armorClass);
              expect(rules.attackBonus).toBe(attack.attackBonus);
            }

            const state: {
              encounter: { id: string; sessionId: string; status: string; currentRound: number };
              participants: Seated[];
              currentParticipant: Seated | null;
            } = {
              encounter: {
                id: 'encounter-1',
                sessionId: 'session-1',
                status: 'active',
                currentRound: 1,
              },
              participants,
              currentParticipant: null,
            };
            const order = InitiativeMechanics.sortParticipants(participants);
            state.currentParticipant = order[draw.startAt % order.length] ?? null;
            const expectedHits: boolean[] = [];
            const intents: Array<Record<string, unknown>> = [];
            const dependencies: NpcTurnRunnerDependencies = {
              getCombatState: async () => state as never,
              getDefaultWeapon: async () => fallbackWeapon,
              executeIntent: async (_encounterId, intent) => {
                const record = intent as {
                  type?: string;
                  actorId?: string;
                  targetId?: string;
                  actionId?: string;
                };
                intents.push(record);
                const actor = participants.find((row) => row.id === record.actorId);
                if (record.type === 'attack' && actor && record.targetId) {
                  const target = participants.find((row) => row.id === record.targetId);
                  if (!target) return { hit: false };
                  const attack =
                    actor.monsterAttack?.attacks[0] ?? deriveAttackFromHitPoints(actor.maxHp);
                  const roll = rollDie(20);
                  const rolledDamage = rollExpression(attack.damageDice, attack.damageBonus);
                  const rules = resolveAttackRules({
                    strength: 10,
                    dexterity: 10,
                    level: 1,
                    baseTargetAc: target.armorClass,
                    weapon: {
                      ...fallbackWeapon,
                      damageDice: attack.damageDice,
                      damageType: attack.damageType,
                      fixedAttackBonus: attack.attackBonus,
                      fixedDamageBonus: attack.damageBonus,
                    },
                  });
                  const hit = roll + rules.attackBonus >= rules.targetAc;
                  expectedHits.push(hit);
                  const newHp = hit
                    ? applyHit(target, rolledDamage, draw.resistance)
                    : target.status.currentHp;
                  actor.actionUsed = true;
                  state.currentParticipant = nextSeat(participants, actor.id);
                  return {
                    hit,
                    finalDamage: hit ? rolledDamage : 0,
                    targetNewHp: newHp,
                    damageType: attack.damageType,
                  };
                }
                const boundary = String(record.actionId ?? '').endsWith(':boundary');
                if (!boundary && actor) {
                  actor.actionUsed = true;
                  state.currentParticipant = nextSeat(participants, actor.id);
                }
                return { turnAlreadyEnded: true, currentParticipant: state.currentParticipant };
              },
            };

            const first = await advanceNpcTurns('encounter-1', 'user-1', dependencies);
            const attackResults = first.results.filter(
              (result) => result.action.action_type === 'attack',
            );
            const otherResults = first.results.filter(
              (result) => result.action.action_type !== 'attack',
            );
            expect(attackResults.every((result) => result.outcomes.length === 1)).toBe(true);
            expect(attackResults.map((result) => result.outcomes[0]?.hit)).toEqual(expectedHits);
            expect(otherResults.every((result) => result.outcomes.length === 0)).toBe(true);
            expect(intents.filter((intent) => intent.type === 'attack')).toHaveLength(
              attackResults.length,
            );
            expect(first.results.every((result) => result.round === 1)).toBe(true);
            for (const result of attackResults) {
              const newHp = result.outcomes[0]?.newHp;
              if (typeof newHp === 'number') expect(newHp).toBeGreaterThanOrEqual(0);
            }
            expect(InitiativeMechanics.sortParticipants(participants).map((row) => row.id)).toEqual(
              orderBefore,
            );
            fightEndMatchesTheGuard(participants);

            for (const row of participants) {
              if (row.participantType !== 'monster') continue;
              row.actionUsed = true;
              // A monster at 0 HP cannot act because it is down, which would hide
              // the spent-action case. Put it on its feet so the only reason it
              // does not attack is actionUsed.
              if (row.status.currentHp <= 0) {
                row.status.currentHp = 1;
                row.status.isConscious = true;
              }
            }
            const standingMonster = participants.find((row) => row.participantType === 'monster');
            expect(standingMonster).toBeTruthy();
            state.currentParticipant = standingMonster ?? null;
            const beforeSpent = intents.length;
            const spent = await advanceNpcTurns('encounter-1', 'user-1', dependencies);
            const spentIntents = intents.slice(beforeSpent);
            expect(spent.results.some((result) => result.action.action_type === 'attack')).toBe(
              false,
            );
            expect(spent.results.every((result) => result.outcomes.length === 0)).toBe(true);
            expect(spentIntents.some((intent) => intent.type === 'attack')).toBe(false);
            expect(spent.results.some((result) => result.action.action_type === 'end_turn')).toBe(
              true,
            );
          } finally {
            if (previousDiceSeed === undefined) delete process.env.DICE_SEED;
            else process.env.DICE_SEED = previousDiceSeed;
            resetRngFromEnv();
          }
        }),
        { numRuns: RUNS, seed: 662 },
      );
      expect(Date.now() - started).toBeLessThan(TIME_BUDGET_MS);
    },
    TIME_BUDGET_MS,
  );
});
