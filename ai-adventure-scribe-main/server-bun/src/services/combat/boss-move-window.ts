/**
 * The Boss Move window: runs once, right after a hero's turn ends, before the next creature acts.
 *
 * `boss-moves.ts` decides; this file loads and saves the fight's Boss Move state, rolls with the
 * engine's seedable dice, applies damage through `CombatHPService` (the one HP path attacks use),
 * and writes the combat-log line `Boss Move: <name> (<slot>)`.
 */
import { and, eq, sql } from 'drizzle-orm';

import { CombatHPService } from '../combat-hp-service.js';
import {
  applyDefyToAttack,
  chooseRoundBossMove,
  bossMoveDamage,
  defyStartingCount,
  moveKey,
  rollBossMoveDamage,
  type AuthoredBossMove,
  type BossMoveFightState,
  type BossMoveHero,
} from './boss-moves.js';
import { getActiveConditionNames, getParticipantAbilityProfile } from './data-access.js';
import { writeEngineLineRow, type NpcEngineRow } from './npc-engine-row.js';
import { db } from '../../../../db/client';
import {
  combatBossState,
  combatParticipantConditions,
  combatParticipantStatus,
  combatParticipants,
  conditionsLibrary,
} from '../../../../db/schema/index';
import { rollD20 } from '../../lib/dice.js';
import { logger } from '../../lib/logger.js';

import type { MonsterAttack, MonsterAttackProfile } from './monster-attack-profile.js';
import type { CombatState, DamageType } from '../../types/combat.js';

export type BossMoveWindowResult = {
  lines: string[];
  engineRows: NpcEngineRow[];
};

const NO_WINDOW: BossMoveWindowResult = { lines: [], engineRows: [] };

type Row = {
  participant: typeof combatParticipants.$inferSelect;
  status: typeof combatParticipantStatus.$inferSelect | null;
};

const standingHp = (row: Row): number => row.status?.currentHp ?? row.participant.maxHp;

const isHostileStanding = (row: Row): boolean =>
  row.participant.isActive && row.participant.participantType !== 'player' && standingHp(row) > 0;

async function loadBossState(encounterId: string, heroCount: number) {
  await db
    .insert(combatBossState)
    .values({ encounterId, defyLeft: defyStartingCount(heroCount) })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(combatBossState)
    .where(eq(combatBossState.encounterId, encounterId));
  if (!row) throw new Error(`Boss Move state missing for encounter ${encounterId}`);
  return row;
}

const attackOf = (participant: Row['participant']): MonsterAttack | undefined => {
  const profile = participant.monsterAttack as MonsterAttackProfile | null;
  return profile?.attacks?.[0];
};

/** One Boss Move against the hero. Returns the combat-log line for it. */
async function fireMove(params: {
  encounterId: string;
  userId: string;
  boss: Row;
  hero: Row;
  move: AuthoredBossMove;
  defyArmed: boolean;
  round: number;
}): Promise<{ line: string; defySpent: boolean }> {
  const { encounterId, userId, boss, hero, move, defyArmed, round } = params;
  const header = `Boss Move: ${move.name} (${move.slot})`;
  const attack = attackOf(boss.participant);
  const effect = move.effect;

  if (effect.kind === 'strike') {
    if (!attack) return { line: `${header} — no attack to strike with`, defySpent: false };
    const first = rollD20();
    // Defy reroll: a boss attack is rerolled and the lower of the two d20s is taken.
    const d20 = defyArmed ? applyDefyToAttack(first, rollD20()) : first;
    const armorClass = hero.participant.armorClass ?? 10;
    const total = d20 + attack.attackBonus;
    const hit = d20 === 20 || (d20 !== 1 && total >= armorClass);
    if (!hit) return { line: `${header} — misses ${hero.participant.name}`, defySpent: defyArmed };
    const damage = bossMoveDamage(attack, move.slot, hero.status?.maxHp ?? hero.participant.maxHp);
    const amount = rollBossMoveDamage(damage);
    await applyHeroDamage(encounterId, userId, hero, boss, amount, attack.damageType, move.name);
    return {
      line: `${header} — hits ${hero.participant.name} for ${amount} ${attack.damageType}`,
      defySpent: defyArmed,
    };
  }

  // Save effects: the DC is 8 + the boss's attack bonus (house rule for Boss Moves).
  const dc = 8 + (attack?.attackBonus ?? 0);
  const profile = await getParticipantAbilityProfile(hero.participant);
  const bonus = profile.saveBonuses?.[effect.ability] ?? 0;
  const first = rollD20();
  const roll = defyArmed ? rollD20() : first;
  const saved = roll + bonus >= dc;

  if (effect.kind === 'burst') {
    if (!attack) return { line: `${header} — no attack to base damage on`, defySpent: false };
    const attackDamage = attack;
    const damage = bossMoveDamage(
      attackDamage,
      move.slot,
      hero.status?.maxHp ?? hero.participant.maxHp,
    );
    const full = rollBossMoveDamage(damage);
    const amount = saved ? Math.floor(full / 2) : full;
    if (amount > 0) {
      await applyHeroDamage(
        encounterId,
        userId,
        hero,
        boss,
        amount,
        attackDamage.damageType,
        move.name,
      );
    }
    const outcome = saved ? `saves, takes ${amount}` : `fails, takes ${amount}`;
    return {
      line: `${header} — ${hero.participant.name} ${outcome} ${attackDamage.damageType}`,
      defySpent: defyArmed,
    };
  }

  // frighten: a failed save leaves the hero frightened for one round. Never longer (SRD 5.1 / house).
  if (!saved) {
    const [frightened] = await db
      .select({ id: conditionsLibrary.id })
      .from(conditionsLibrary)
      .where(eq(conditionsLibrary.name, 'frightened'));
    if (frightened) {
      await db.insert(combatParticipantConditions).values({
        participantId: hero.participant.id,
        conditionId: frightened.id,
        durationType: 'rounds',
        durationValue: 1,
        saveDc: dc,
        saveAbility: effect.ability,
        appliedAtRound: round,
        expiresAtRound: round + 1,
        sourceDescription: `Boss Move: ${move.name}`,
      });
    } else {
      logger.warn({ msg: 'BOSS_MOVE_CONDITION_MISSING', encounterId, condition: 'frightened' });
    }
  }
  return {
    line: `${header} — ${hero.participant.name} ${saved ? 'resists' : 'is frightened'}`,
    defySpent: defyArmed,
  };
}

async function applyHeroDamage(
  encounterId: string,
  userId: string,
  hero: Row,
  boss: Row,
  amount: number,
  damageType: string,
  moveName: string,
): Promise<void> {
  await CombatHPService.applyDamage(
    hero.participant.id,
    encounterId,
    {
      damageAmount: amount,
      damageType: damageType as DamageType,
      sourceParticipantId: boss.participant.id,
      sourceDescription: `Boss Move: ${moveName}`,
    },
    userId,
  );
}

/**
 * Runs the Boss Move window for this fight. At most one move per round across every boss, each
 * move once per fight. Writes the combat-log rows keyed by action, so a replayed drain does not
 * write a line twice.
 */
export async function runBossMoveWindow(params: {
  encounterId: string;
  userId: string;
  state: CombatState;
}): Promise<BossMoveWindowResult> {
  const { encounterId, userId, state } = params;
  const round = state.encounter.currentRound;

  const rows: Row[] = await db
    .select({ participant: combatParticipants, status: combatParticipantStatus })
    .from(combatParticipants)
    .leftJoin(
      combatParticipantStatus,
      eq(combatParticipantStatus.participantId, combatParticipants.id),
    )
    .where(eq(combatParticipants.encounterId, encounterId));

  const heroes = rows.filter(
    (row) => row.participant.participantType === 'player' && row.participant.isActive,
  );
  const hero = heroes.find((row) => standingHp(row) > 0);
  const bosses = rows
    .filter((row) => isHostileStanding(row) && (row.participant.bossMoves?.length ?? 0) > 0)
    .sort((a, b) => a.participant.turnOrder - b.participant.turnOrder);
  if (!hero || bosses.length === 0) return NO_WINDOW;

  const stateRow = await loadBossState(encounterId, heroes.length);
  const hostileCount = rows.filter(isHostileStanding).length;
  const conditions = await getActiveConditionNames(hero.participant.id);
  const heroState: BossMoveHero = {
    currentHp: standingHp(hero),
    maxHp: hero.status?.maxHp ?? hero.participant.maxHp,
    conditions,
    isDodging: hero.participant.isDodging,
    surrounded: hostileCount >= 4,
  };
  // Count this hero turn atomically: a column increment, not a read-modify-write of the row.
  const [turns] = await db
    .update(combatBossState)
    .set({ heroTurnsEnded: sql`${combatBossState.heroTurnsEnded} + 1`, updatedAt: new Date() })
    .where(eq(combatBossState.encounterId, encounterId))
    .returning({ heroTurnsEnded: combatBossState.heroTurnsEnded });
  const fight: BossMoveFightState = {
    round,
    lastFiredRound: stateRow.lastFiredRound,
    heroTurnsEnded: turns?.heroTurnsEnded ?? stateRow.heroTurnsEnded + 1,
    movesUsed: stateRow.movesUsed,
    finaleTelegraph: stateRow.finaleTelegraph,
  };

  const lines: string[] = [];
  const engineRows: NpcEngineRow[] = [];
  const choice = chooseRoundBossMove(
    bosses.map((boss) => ({
      id: boss.participant.id,
      moves: (boss.participant.bossMoves ?? []) as AuthoredBossMove[],
    })),
    fight,
    heroState,
  );
  if (!choice) return { lines, engineRows };

  const boss = bosses.find((candidate) => candidate.participant.id === choice.bossId);
  if (!boss) throw new Error(`Boss Move window chose unknown boss ${choice.bossId}`);
  const { decision } = choice;
  const { move } = decision;
  const key = moveKey(boss.participant.id, move.slot);

  // Claim the round before any effect. The gate is one conditional UPDATE: a concurrent drain that
  // decided the same window loses the claim and does nothing, so one round cannot fire twice. A
  // crash after the claim loses the move; it can never repeat it.
  const claimed = await db
    .update(combatBossState)
    .set({ lastFiredRound: round, updatedAt: new Date() })
    .where(
      and(
        eq(combatBossState.encounterId, encounterId),
        sql`${combatBossState.lastFiredRound} IS DISTINCT FROM ${round}`,
      ),
    )
    .returning({ encounterId: combatBossState.encounterId });
  if (claimed.length === 0) return { lines, engineRows };

  if (decision.kind === 'telegraph') {
    await db
      .update(combatBossState)
      .set({
        finaleTelegraph: sql`${combatBossState.finaleTelegraph} || ${JSON.stringify({ [boss.participant.id]: round })}::jsonb`,
      })
      .where(eq(combatBossState.encounterId, encounterId));
  } else {
    await db
      .update(combatBossState)
      .set({ movesUsed: sql`array_append(${combatBossState.movesUsed}, ${key})` })
      .where(eq(combatBossState.encounterId, encounterId));
  }

  let line: string;
  if (decision.kind === 'telegraph') {
    line = `Boss Move telegraph: ${move.name} (${move.slot}) — ${move.telegraph ?? ''}`;
  } else if (decision.kind === 'countered') {
    line = `Boss Move: ${move.name} (${move.slot}) — countered: ${move.counterplay}`;
  } else {
    const fired = await fireMove({
      encounterId,
      userId,
      boss,
      hero,
      move,
      defyArmed: stateRow.defyArmed && stateRow.defyLeft > 0,
      round,
    });
    // Consume only the Defy this roll read as armed. A Defy armed during the roll stays armed.
    if (fired.defySpent) {
      await db
        .update(combatBossState)
        .set({
          defyLeft: sql`${combatBossState.defyLeft} - 1`,
          defyArmed: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(combatBossState.encounterId, encounterId),
            eq(combatBossState.defyArmed, true),
            sql`${combatBossState.defyLeft} > 0`,
          ),
        );
    }
    line = fired.line;
  }
  lines.push(line);
  engineRows.push(
    ...(await writeEngineLineRow(
      state,
      `boss:${encounterId}:${round}:${boss.participant.id}:${move.slot}`,
      line,
      userId,
    )),
  );
  logger.info({
    msg: 'BOSS_MOVE_WINDOW',
    encounterId,
    round,
    slot: move.slot,
    decision: decision.kind,
  });
  return { lines, engineRows };
}

/**
 * The Defy button: arms the solo hero's one Defy for this fight. It is spent by the next Boss Move
 * roll against the hero. Returns false when there is none left to arm.
 *
 * The button can fire before the Opener, so the boss-state row may not exist yet — `loadBossState`
 * only creates it when the first window runs, which happens after the hero's first end_turn. Create
 * the row here with insert-on-conflict (never check-then-insert), seeded with the same starting
 * Defy count `loadBossState` would use, then arm it with the conditional UPDATE.
 */
export async function armDefy(encounterId: string): Promise<boolean> {
  const heroes = await db
    .select({ id: combatParticipants.id })
    .from(combatParticipants)
    .where(
      and(
        eq(combatParticipants.encounterId, encounterId),
        eq(combatParticipants.participantType, 'player'),
        eq(combatParticipants.isActive, true),
      ),
    );
  await db
    .insert(combatBossState)
    .values({ encounterId, defyLeft: defyStartingCount(heroes.length) })
    .onConflictDoNothing();
  const [row] = await db
    .update(combatBossState)
    .set({ defyArmed: true, updatedAt: new Date() })
    .where(
      and(
        eq(combatBossState.encounterId, encounterId),
        eq(combatBossState.defyArmed, false),
        sql`${combatBossState.defyLeft} > 0`,
      ),
    )
    .returning();
  return row !== undefined;
}
