/**
 * Where a combatant stands: the pure, import-free half of the dying-and-death rules, so the
 * encounter service can stamp it on every participant it serves without importing the module
 * that imports the encounter service.
 *
 * @module server/services/combat/vital-state
 */

/** Where a combatant stands, as the fight-over check and the DM digest both need to ask it. */
export type VitalState = 'standing' | 'dying' | 'stabilized' | 'dead';

/** The three successes / three failures thresholds, named so no call site spells them. */
export const DEATH_SAVE_SUCCESSES_TO_STABILIZE = 3;
export const DEATH_SAVE_FAILURES_TO_DIE = 3;

/** The subset of a hydrated combat participant this module reads. */
export interface VitalsInput {
  participantType: string;
  maxHp: number;
  status?: {
    currentHp: number;
    isConscious: boolean;
    deathSavesSuccesses: number;
    deathSavesFailures: number;
  } | null;
}

export const isPlayerParticipant = (participantType: string): boolean =>
  participantType === 'player';

/**
 * Classifies one combatant.
 *
 * Only player characters get the dying state. That is 5E as written — a monster reduced to 0
 * hit points simply dies (MM p.6) — and it is also what keeps the fight-over check meaningful:
 * if a felled monster counted as "dying", no fight would ever end in victory.
 */
export function vitalStateOf(participant: VitalsInput): VitalState {
  const currentHp = participant.status?.currentHp ?? participant.maxHp;
  if (currentHp > 0) return 'standing';
  if (!isPlayerParticipant(participant.participantType)) return 'dead';
  const failures = participant.status?.deathSavesFailures ?? 0;
  const successes = participant.status?.deathSavesSuccesses ?? 0;
  if (failures >= DEATH_SAVE_FAILURES_TO_DIE) return 'dead';
  if (successes >= DEATH_SAVE_SUCCESSES_TO_STABILIZE) return 'stabilized';
  return 'dying';
}
