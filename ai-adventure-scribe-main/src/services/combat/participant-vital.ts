import type { CombatParticipant } from '@/types/combat';

/**
 * Where a player character stands on the floor (#2518), read off the participant the tracker and
 * the composer already share. The server owns the state machine (`vitalStateOf`) and stamps it on
 * the wire; `mapAuthoritativeCombat` turns it into these three flags, so this is the one place
 * the client reads them.
 */
export type ParticipantVital = 'standing' | 'dying' | 'stable' | 'dead';

export function participantVital(
  participant: Pick<
    CombatParticipant,
    'participantType' | 'currentHitPoints' | 'isDead' | 'isStable' | 'isUnconscious' | 'deathSaves'
  >,
): ParticipantVital {
  if (participant.participantType !== 'player') return 'standing';
  if (
    participant.isDead ||
    (participant.currentHitPoints <= 0 && participant.deathSaves.failures >= 3)
  ) {
    return 'dead';
  }
  if (participant.isStable) return 'stable';
  if (participant.isUnconscious && participant.currentHitPoints <= 0) return 'dying';
  return 'standing';
}
