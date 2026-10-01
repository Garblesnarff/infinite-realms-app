/**
 * What an NPC with no authored stat block fights with.
 *
 * A bible NPC carries voice, goal and secret and no `HP:`/`AC:`/`Attack:` labels, so the
 * parser reads nothing and the seat is left with whatever the scene text grounded: a catalog
 * weapon (or a role weapon for "captain", "guard") at `attackBonus: 0, damageBonus: 0`. The
 * participant has no ability scores to add to that, so Captain Sarah Reeves swung a longsword
 * at +0 for 1d8 (#2398, run 16). No combat-capable NPC in the three beta bibles has a block,
 * so every NPC who fights landed here.
 *
 * The fix is the house rule monsters already use: read the attack off the hit points
 * (`deriveAttackFromHitPoints`). The weapon the scene named keeps its name, damage type and
 * geometry, so a longbow stays a longbow; only the numbers come from HP.
 */
import {
  crBandForHitPoints,
  deriveAttackFromHitPoints,
  type MonsterAttackProfile,
} from './monster-attack-profile.js';
import { logger } from '../../lib/logger.js';

/**
 * HP used when an NPC has no HP anywhere: no `npcs` row value, no DM-stated `hpMax`. It is
 * the median of the house corpus blocks at CR 1/2 to CR 1 (15 to 22 HP in the beta bibles),
 * rounded to 20. It only feeds the attack derivation; the seat's own HP is unchanged.
 */
export const NPC_DEFAULT_MAX_HP = 20;

export type NpcStatFallbackReason = 'no_authored_block_hp_derived' | 'no_authored_block_default_hp';

export interface NpcStatFallbackSeat {
  npcId: string | null;
  npcName: string;
  reason: NpcStatFallbackReason;
  maxHp: number;
  attack: string;
}

/**
 * The attack an NPC with no authored block fights on, read off its RAW hit points.
 *
 * `knownMaxHp` must be the HP before party scaling: `party-scaling.ts` scales the derived
 * profile afterwards, exactly as it does for a monster, and deriving from already-scaled HP
 * would scale the damage twice.
 */
export function deriveNpcFallbackProfile(input: {
  npcId?: string | null;
  npcName: string;
  /** The seat's raw HP, or `null` when nothing supplied one. */
  knownMaxHp: number | null;
  /** What the scene grounded, if anything. Supplies the attack's name and geometry. */
  grounded: MonsterAttackProfile | null;
}): { profile: MonsterAttackProfile; seat: NpcStatFallbackSeat } {
  const { knownMaxHp, grounded } = input;
  const hasHp = typeof knownMaxHp === 'number' && Number.isFinite(knownMaxHp) && knownMaxHp > 0;
  const maxHp = hasHp ? knownMaxHp : NPC_DEFAULT_MAX_HP;
  const scene = grounded?.attacks[0];
  const band = crBandForHitPoints(maxHp);
  const derived = deriveAttackFromHitPoints(maxHp, scene?.name ?? 'strike');

  return {
    seat: {
      npcId: input.npcId ?? null,
      npcName: input.npcName,
      reason: hasHp ? 'no_authored_block_hp_derived' : 'no_authored_block_default_hp',
      maxHp,
      attack: `${derived.name} +${derived.attackBonus}, ${derived.damageDice}${
        derived.damageBonus ? `+${derived.damageBonus}` : ''
      }`,
    },
    profile: {
      source: 'derived',
      attacks: [
        {
          ...derived,
          ...(scene
            ? {
                damageType: scene.damageType,
                normalRange: scene.normalRange,
                ...(scene.longRange ? { longRange: scene.longRange } : {}),
                ranged: scene.ranged,
              }
            : {}),
        },
      ],
      derivation: {
        fromMaxHp: maxHp,
        challengeRating: band.cr,
        damagePerRound: band.damagePerRound,
      },
    },
  };
}

/**
 * One line per encounter, not one per seat: a scene with five improvised guards is one content
 * gap, and five identical lines would bury the NPCs that matter. `npcId` and `reason` are the
 * first seat's, so the line greps the way #2398 asked; every seat is in `seats`.
 */
export function logNpcStatFallback(encounterId: string, seats: NpcStatFallbackSeat[]): void {
  if (seats.length === 0) return;
  logger.warn({
    msg: 'NPC_STAT_FALLBACK',
    encounterId,
    npcId: seats[0].npcId,
    reason: seats[0].reason,
    seats,
  });
}
