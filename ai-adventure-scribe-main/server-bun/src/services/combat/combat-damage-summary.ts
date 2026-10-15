/**
 * End-of-combat damage totals for the Combat Summary card (#570).
 *
 * The client's in-memory encounter cannot produce these numbers in the authoritative
 * (server-driven) path: `mapAuthoritativeCombat` sets `actions: []`, and the final HP
 * state is discarded when the server ends the fight in the same read as the killing blow
 * (`applyAuthoritativeCombat` dispatches END_COMBAT on the `combat_ended` broadcast and
 * returns null). So the summary is aggregated here, from `combat_damage_log` — every
 * damage application writes one row with its source participant — plus the encounter's
 * final roster for names, rounds and status.
 */
import { CombatEncounterService } from './combat-encounter-service.js';
import { getDamageLog } from './hp-data-access.js';

import type { VitalState } from './vital-state.js';
import type { CombatParticipant } from '../../types/combat.js';

export interface CombatDamageSummaryParticipant {
  participantId: string;
  name: string;
  damageDealt: number;
  damageTaken: number;
  status: 'dead' | 'unconscious' | 'ok';
}

export interface CombatDamageSummary {
  encounterId: string;
  rounds: number;
  totalDamage: number;
  participants: CombatDamageSummaryParticipant[];
}

function summaryStatus(vitalState: VitalState | undefined): CombatDamageSummaryParticipant['status'] {
  if (vitalState === 'dead') return 'dead';
  if (vitalState === 'dying' || vitalState === 'stabilized') return 'unconscious';
  return 'ok';
}

export async function getCombatDamageSummary(
  encounterId: string,
  userId: string,
): Promise<CombatDamageSummary> {
  // The route's verifyEncounterOwnership (resolve/onBeforeHandle in status.ts) already
  // enforces ownership before this runs, so the damage log is fetched by encounterId
  // alone. getCombatState keeps its userId check for the roster.
  const [logs, combat] = await Promise.all([
    getDamageLog(encounterId),
    CombatEncounterService.getCombatState(encounterId, userId),
  ]);
  const dealt = new Map<string, number>();
  const taken = new Map<string, number>();
  for (const log of logs) {
    taken.set(log.participantId, (taken.get(log.participantId) ?? 0) + log.damageAmount);
    if (log.sourceParticipantId) {
      dealt.set(
        log.sourceParticipantId,
        (dealt.get(log.sourceParticipantId) ?? 0) + log.damageAmount,
      );
    }
  }
  // getCombatState stamps `vitalState` onto each participant at runtime (#2518); the
  // CombatState type does not carry it, so it is read through a widened local type.
  const participants = combat.participants.map(
    (participant: CombatParticipant & { vitalState?: VitalState }) => ({
      participantId: participant.id,
      name: participant.name,
      damageDealt: dealt.get(participant.id) ?? 0,
      damageTaken: taken.get(participant.id) ?? 0,
      status: summaryStatus(participant.vitalState),
    }),
  );
  return {
    encounterId,
    rounds: combat.encounter.currentRound ?? 1,
    totalDamage: participants.reduce((sum, p) => sum + p.damageDealt, 0),
    participants,
  };
}
