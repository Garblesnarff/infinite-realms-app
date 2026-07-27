/**
 * Party-size-aware monster scaling.
 *
 * Every number this product reads about a monster — the DMG's CR table, the SRD catalog, and
 * the hit points a campaign bible writes down — was authored against A PARTY OF FOUR
 * ADVENTURERS. That assumption is invisible in the numbers themselves and wrong in both
 * directions for a solo game:
 *
 *   damage  the CR table budgets a creature's damage-per-round to be SHARED by four bodies.
 *           Run 17's Unwashed Dish (100 HP -> CR 2 -> 17 dmg/round) landed 11, 15, 21 and a
 *           crit for 31 against an 11 HP character. Four deaths in five encounters. Nothing
 *           misfired; the budget simply arrived at one target instead of four.
 *
 *   hit     a 100 HP creature is sized against four characters' combined output. One
 *   points  character needs ~14 landed hits to fell it, which is not a fight, it is a queue.
 *
 * Both are the same error, so both take the same correction. A party of N deals N/4 of the
 * damage the stat block was priced against and absorbs 4/N times as much of what it deals, so
 * multiplying BOTH the creature's hit points and its damage output by `N / 4` restores the
 * designed experience exactly: the same number of rounds, and the same fraction of a
 * character's hit points lost per round, as the four-person table the block was written for.
 *
 * That is arithmetic rather than taste, which is the reason it is the factor chosen. Scaling
 * only damage — the obvious half-fix — leaves the solo player grinding fourteen rounds through
 * a creature that can no longer threaten them, trading a coin flip for a slog.
 *
 * The factor is derived from the encounter's own living player-type participants and never
 * hard-codes 1. When AI party members ship, an encounter with three of them reads 4, the
 * factor becomes 1.00, and the stat blocks are used exactly as printed with no code change.
 *
 *   party of 1  ->  factor 0.25
 *   party of 2  ->  factor 0.50
 *   party of 4  ->  factor 1.00  (the printed block, untouched)
 *
 * The factor is capped at 1.00. A party of six does not make monsters stronger than their
 * authors wrote them: inflating a printed stat block invents numbers nobody set down, which is
 * the class of silent fabrication this codebase has spent weeks removing. Larger parties get
 * an easier fight, and that is a visible, honest outcome rather than an invented one.
 *
 * @module server/services/combat/party-scaling
 */

import type { MonsterAttack, MonsterAttackProfile } from './monster-attack-profile.js';

/**
 * The party size every published D&D stat block, and the DMG's CR table above all, is priced
 * against. DMG p.274 budgets damage-per-round for four adventurers of the creature's tier.
 */
export const PARTY_SIZE_BASELINE = 4;

/**
 * `partySize / 4`, never above 1.
 *
 * A non-finite or non-positive size resolves to 1 rather than throwing: a scaling factor is a
 * safety adjustment, and a bad count must produce the *most* protective answer, not an
 * exception in the middle of starting a fight.
 */
export function partyScaleFactor(partySize: number): number {
  const size = Number.isFinite(partySize) ? Math.floor(partySize) : 1;
  return Math.min(1, Math.max(1, size) / PARTY_SIZE_BASELINE);
}

/** Hit points for the party actually present. Never below 1 — a 0 HP combatant is a corpse. */
export function scaleHitPoints(rawMaxHp: number, factor: number): number {
  if (!Number.isFinite(rawMaxHp) || rawMaxHp <= 0) return Math.max(1, Math.round(rawMaxHp || 1));
  return Math.max(1, Math.round(rawMaxHp * factor));
}

const DICE = /^(\d+)d(\d+)$/;

/**
 * Rewrites one attack's damage to a fraction of its printed average.
 *
 * Kept as dice rather than collapsed to a flat number so damage still varies, and so a
 * critical hit still has dice to double. The die SIZE is preserved — a golem's slam stays a d8
 * — and the count and flat bonus are re-fitted to the scaled average.
 *
 * One deliberate floor: a scaled attack never drops below a single die of its original size.
 * `1d8+1` at a quarter would want an average of 1.4, which no d8 expression can produce, and
 * substituting a smaller die to chase the average would mean reporting a weapon nobody wrote.
 * Weak creatures therefore scale less than the factor asks, which errs toward the player
 * taking a *little* more damage than the arithmetic wants, from creatures that were never the
 * problem.
 */
export function scaleAttackDamage(attack: MonsterAttack, factor: number): MonsterAttack {
  const match = DICE.exec(attack.damageDice.trim().toLowerCase());
  if (!match || factor >= 1) return attack;

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const averagePerDie = (sides + 1) / 2;
  const rawAverage = count * averagePerDie + attack.damageBonus;
  const target = Math.max(1, Math.round(rawAverage * factor));
  if (target >= rawAverage) return attack;

  const scaledCount = Math.max(1, Math.floor(target / averagePerDie));
  const scaledBonus = Math.max(0, Math.round(target - scaledCount * averagePerDie));
  return { ...attack, damageDice: `${scaledCount}d${sides}`, damageBonus: scaledBonus };
}

/** The average a damage expression rolls, for logs and for the harness's raw-vs-scaled table. */
export function averageDamage(attack: Pick<MonsterAttack, 'damageDice' | 'damageBonus'>): number {
  const match = DICE.exec(attack.damageDice.trim().toLowerCase());
  if (!match) return attack.damageBonus;
  return (Number(match[1]) * (Number(match[2]) + 1)) / 2 + attack.damageBonus;
}

/** What a scaled profile records about the adjustment, so a log reader can undo the arithmetic. */
export interface PartyScalingRecord {
  partySize: number;
  baseline: number;
  factor: number;
  rawMaxHp: number;
  scaledMaxHp: number;
  /** `"3d8+6 (avg 19.5)"` per attack, in the profile's own attack order. */
  rawAttacks: string[];
}

const describeAttack = (attack: MonsterAttack): string =>
  `${attack.damageDice}${attack.damageBonus ? `+${attack.damageBonus}` : ''} (avg ${averageDamage(
    attack,
  )})`;

export interface ScaledMonster {
  factor: number;
  partySize: number;
  maxHp: number;
  currentHp: number;
  attackProfile: MonsterAttackProfile | null;
  scaling: PartyScalingRecord;
}

/**
 * Applies the party factor to one monster's hit points and attack output together.
 *
 * Order matters and is load-bearing: the derived attack rung infers a creature's CR band from
 * its hit points, so the profile must already have been resolved from the RAW hit points
 * before anything is scaled. Scaling the hit points first and then deriving would read the
 * Unwashed Dish's 25 scaled HP as CR 1/8 and budget it 2 damage a round — the same mistake
 * twice, compounding.
 */
export function scaleMonsterForParty(input: {
  rawMaxHp: number;
  rawCurrentHp: number;
  attackProfile: MonsterAttackProfile | null;
  partySize: number;
}): ScaledMonster {
  const { rawMaxHp, rawCurrentHp, attackProfile, partySize } = input;
  const factor = partyScaleFactor(partySize);
  const maxHp = scaleHitPoints(rawMaxHp, factor);
  const currentHp = Math.min(maxHp, Math.max(1, Math.round(rawCurrentHp * factor)));
  const scaling: PartyScalingRecord = {
    partySize: Math.max(1, Math.floor(partySize) || 1),
    baseline: PARTY_SIZE_BASELINE,
    factor,
    rawMaxHp,
    scaledMaxHp: maxHp,
    rawAttacks: (attackProfile?.attacks ?? []).map(describeAttack),
  };
  return {
    factor,
    partySize: scaling.partySize,
    maxHp,
    currentHp,
    attackProfile: attackProfile
      ? {
          ...attackProfile,
          attacks: attackProfile.attacks.map((attack) => scaleAttackDamage(attack, factor)),
          partyScaling: scaling,
        }
      : null,
    scaling,
  };
}
