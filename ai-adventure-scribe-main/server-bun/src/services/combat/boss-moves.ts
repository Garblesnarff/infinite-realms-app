/**
 * Boss Moves: three scripted moves per authored boss (Opener, Turnabout, Finale).
 *
 * Pure rules only. Nothing here reads or writes the database; the window in
 * `boss-move-window.ts` loads state, asks these functions what happens, and applies the result
 * through the engine's own damage and condition paths.
 *
 * Rules (house rules where noted; saves and conditions follow SRD 5.1):
 *   - A boss uses at most one Boss Move per round, each move once per fight, right after the
 *     hero's turn ends. Telegraph counts as the round's move.
 *   - Opener: after the hero's first turn ends.
 *   - Turnabout: when the hero is grappled, restrained or frightened, is surrounded, or is at
 *     50% HP or less.
 *   - Finale: once the hero is bloodied (50% HP or less) or from round 3. It is telegraphed one
 *     round early, and it fires on the next round unless the hero spent counterplay (dodging)
 *     while it was telegraphed, which disrupts it.
 *   - Damage is the boss's resolved attack, scaled by the move (Opener 0.5x, Turnabout 1x,
 *     Finale 1.5x) and capped at 40% of the hero's max HP on average (house rule).
 *   - A solo hero gets one Defy per fight (house rule).
 */

import { rollDie } from '../../lib/rng.js';

import type { MonsterAttack } from './monster-attack-profile.js';
import type { CombatState } from '../../types/combat.js';

export const BOSS_MOVE_SLOTS = ['Opener', 'Turnabout', 'Finale'] as const;
export type BossMoveSlot = (typeof BOSS_MOVE_SLOTS)[number];

export const BOSS_MOVE_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type BossMoveAbility = (typeof BOSS_MOVE_ABILITIES)[number];

/** The closed list of what a Boss Move can do. Anything else is refused by the parser. */
export type BossMoveEffect =
  | { kind: 'strike' }
  | { kind: 'burst'; ability: BossMoveAbility }
  | { kind: 'frighten'; ability: BossMoveAbility };

export interface AuthoredBossMove {
  slot: BossMoveSlot;
  name: string;
  effect: BossMoveEffect;
  tell: string;
  /** The line shown one round early. Null when the author wrote `none`. Required for Finale. */
  telegraph: string | null;
  counterplay: string;
}

/** Damage multiplier on the boss's resolved attack, per slot. */
export const BOSS_MOVE_MULTIPLIER: Record<BossMoveSlot, number> = {
  Opener: 0.5,
  Turnabout: 1,
  Finale: 1.5,
};

/** No Boss Move deals more than this fraction of the hero's max HP on average. */
export const BOSS_MOVE_MAX_AVERAGE_FRACTION = 0.4;

/** Turnabout and Finale's bloodied threshold: 50% of max HP or less. */
export const BLOODIED_FRACTION = 0.5;

/** The Finale is also available from this round, bloodied or not. */
export const FINALE_ROUND = 3;

/** The Turnabout conditions that trigger it, per the authored brief. */
const TURNABOUT_CONDITIONS = ['grappled', 'restrained', 'frightened'] as const;

export interface BossMoveHero {
  currentHp: number;
  maxHp: number;
  conditions: readonly string[];
  isDodging: boolean;
  /** Three or more other hostile creatures still stand in the fight. House proxy for "surrounded". */
  surrounded: boolean;
}

export interface BossMoveFightState {
  round: number;
  /** The round a Boss Move (or telegraph) last used the window; one per round across all bosses. */
  lastFiredRound: number | null;
  /** Hero turns ended in this fight. Opener needs at least one. */
  heroTurnsEnded: number;
  /** Keys `${bossId}:${slot}` already spent. */
  movesUsed: readonly string[];
  /** Per boss id: the round its Finale was telegraphed. */
  finaleTelegraph: Readonly<Record<string, number>>;
}

export type BossMoveDecision =
  | { kind: 'none' }
  /** The Finale was announced this round; it fires next round. */
  | { kind: 'telegraph'; move: AuthoredBossMove }
  /** The Finale fires against a hero who is not counterplaying. */
  | { kind: 'fire'; move: AuthoredBossMove }
  /** A telegraphed Finale that the hero spent counterplay against: spent, no damage. */
  | { kind: 'countered'; move: AuthoredBossMove };

export const moveKey = (bossId: string, slot: BossMoveSlot): string => `${bossId}:${slot}`;

export const isBloodied = (hero: Pick<BossMoveHero, 'currentHp' | 'maxHp'>): boolean =>
  hero.currentHp <= hero.maxHp * BLOODIED_FRACTION;

export function finaleEligible(state: BossMoveFightState, hero: BossMoveHero): boolean {
  return isBloodied(hero) || state.round >= FINALE_ROUND;
}

export function turnaboutTriggered(hero: BossMoveHero): boolean {
  if (hero.surrounded || isBloodied(hero)) return true;
  return hero.conditions.some((condition) =>
    (TURNABOUT_CONDITIONS as readonly string[]).includes(condition),
  );
}

/**
 * Decides what one boss does in this window. `moves` is that boss's authored list; a boss whose
 * move list lacks a slot simply never uses it.
 */
export function decideBossMove(
  boss: { id: string; moves: readonly AuthoredBossMove[] },
  state: BossMoveFightState,
  hero: BossMoveHero,
): BossMoveDecision {
  const move = (slot: BossMoveSlot) => boss.moves.find((candidate) => candidate.slot === slot);
  const spent = (slot: BossMoveSlot) => state.movesUsed.includes(moveKey(boss.id, slot));

  // A telegraphed Finale that is due fires first. Then the moves that fire now, and only then a new
  // telegraph: announcing a Finale spends no move, so it waits for a round with no other move.
  const finale = move('Finale');
  const telegraphRound = state.finaleTelegraph[boss.id];
  if (finale && !spent('Finale') && telegraphRound !== undefined && telegraphRound < state.round) {
    return hero.isDodging ? { kind: 'countered', move: finale } : { kind: 'fire', move: finale };
  }

  const turnabout = move('Turnabout');
  if (turnabout && !spent('Turnabout') && turnaboutTriggered(hero)) {
    return { kind: 'fire', move: turnabout };
  }

  const opener = move('Opener');
  if (opener && !spent('Opener') && state.heroTurnsEnded >= 1) {
    return { kind: 'fire', move: opener };
  }

  if (finale && !spent('Finale') && telegraphRound === undefined && finaleEligible(state, hero)) {
    return { kind: 'telegraph', move: finale };
  }

  return { kind: 'none' };
}

/**
 * The round's one Boss Move window: the first boss, in the order given, that has something to do.
 * Null when the window is already used this round or no boss acts. Never more than one result.
 */
export function chooseRoundBossMove(
  bosses: readonly { id: string; moves: readonly AuthoredBossMove[] }[],
  state: BossMoveFightState,
  hero: BossMoveHero,
): { bossId: string; decision: Exclude<BossMoveDecision, { kind: 'none' }> } | null {
  if (state.lastFiredRound === state.round) return null;
  for (const boss of bosses) {
    const decision = decideBossMove(boss, state, hero);
    if (decision.kind !== 'none') return { bossId: boss.id, decision };
  }
  return null;
}

export interface BossMoveDamage {
  damageDice: string;
  damageBonus: number;
  /** The average this move deals after the cap. Never above the cap. */
  average: number;
  capped: boolean;
}

const DICE_FORM = /^(\d+)d(\d+)$/i;

/**
 * The move's damage: the boss's attack average times the slot multiplier, capped at 40% of the
 * hero's max HP on average. Returned as dice the engine can roll, so the roll stays seedable.
 */
export function bossMoveDamage(
  attack: Pick<MonsterAttack, 'damageDice' | 'damageBonus'>,
  slot: BossMoveSlot,
  heroMaxHp: number,
): BossMoveDamage {
  const match = DICE_FORM.exec(attack.damageDice.trim());
  if (!match) throw new Error(`Boss Move needs NdN damage dice, got "${attack.damageDice}"`);
  const sides = Number(match[2]);
  const avgPerDie = (sides + 1) / 2;
  const baseAverage = Number(match[1]) * avgPerDie + attack.damageBonus;

  const raw = baseAverage * BOSS_MOVE_MULTIPLIER[slot];
  const cap = heroMaxHp * BOSS_MOVE_MAX_AVERAGE_FRACTION;
  const target = Math.min(raw, cap);

  // Whole dice first, then a flat bonus that never pushes the average past the target.
  const count = Math.floor(target / avgPerDie);
  if (count >= 1) {
    const bonus = Math.max(0, Math.floor(target - count * avgPerDie));
    return {
      damageDice: `${count}d${sides}`,
      damageBonus: bonus,
      average: count * avgPerDie + bonus,
      capped: raw > cap,
    };
  }
  // Below one die's average the target is too small for the attack's own die: fall to d4, then to
  // a flat 1. A hero whose cap is under 1 takes no damage, so the 40% rule holds even at 1-2 max HP.
  if (target >= 2.5) {
    const bonus = Math.floor(target - 2.5);
    return { damageDice: '1d4', damageBonus: bonus, average: 2.5 + bonus, capped: raw > cap };
  }
  if (target < 1) return { damageDice: '0d1', damageBonus: 0, average: 0, capped: true };
  return { damageDice: '1d1', damageBonus: 0, average: 1, capped: raw > cap };
}

/** Rolls a `NdN+N` expression with the engine's seedable RNG. */
export function rollBossMoveDamage(damage: BossMoveDamage): number {
  const sides = Number(/d(\d+)$/i.exec(damage.damageDice)?.[1] ?? 1);
  const count = Number(/^(\d+)/.exec(damage.damageDice)?.[1] ?? 1);
  let total = damage.damageBonus;
  for (let index = 0; index < count; index += 1) total += rollDie(sides);
  return total;
}

/**
 * Mook group attack: up to four mooks attacking together get +1 to hit for each extra mook, to a
 * maximum of +3 (house rule).
 */
export function mookGroupAttackBonus(attackingMooks: number): number {
  const grouped = Math.min(attackingMooks, 4);
  return Math.min(3, Math.max(0, grouped - 1));
}

/**
 * Defy is a solo-hero helper: one per fight, armed by the hero's button before the boss move
 * rolls. Armed, the next roll against the hero is rerolled: a save takes the new roll, an attack
 * takes the lower of the two d20s.
 */
export function defyStartingCount(livingHeroes: number): number {
  return livingHeroes === 1 ? 1 : 0;
}

export function applyDefyToAttack(firstD20: number, rerolledD20: number): number {
  return Math.min(firstD20, rerolledD20);
}

/**
 * True when the creature now holding the turn sits right after a player in initiative order: the
 * hero's turn has just ended. The window only runs then, so an encounter that opens on a creature
 * does not get a Boss Move before any hero has acted.
 */
export function heroTurnJustEnded(state: CombatState): boolean {
  const holder = state.currentParticipant;
  if (!holder || holder.participantType === 'player') return false;
  const order = state.participants
    .filter((participant) => participant.isActive)
    .sort((a, b) => a.turnOrder - b.turnOrder);
  const index = order.findIndex((participant) => participant.id === holder.id);
  if (index < 0 || order.length < 2) return false;
  // The opening creature of round 1 comes before any hero has acted, so there is no turn to follow.
  if (index === 0 && state.encounter.currentRound === 1) return false;
  const previous = order[(index - 1 + order.length) % order.length];
  return previous?.participantType === 'player';
}
