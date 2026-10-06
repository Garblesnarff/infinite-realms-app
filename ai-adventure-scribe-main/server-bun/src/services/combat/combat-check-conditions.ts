/**
 * When the conditions a mid-combat check applies end (#2420, SRD 5.1).
 *
 * - **Prone** ends when the creature stands: it spends half its movement on its own turn to get
 *   up, so it is no longer prone once that turn begins. The 1-round duration the check writes is
 *   the backstop that expires it at the next round if the turn boundary was never reached.
 * - **Grappled** ends when the grappler is incapacitated or the target is moved out of the
 *   grappler's reach, handled here, or when the grappled creature escapes with its action, which
 *   `combat-check-service` resolves.
 *
 * Called from the one place every turn boundary passes through, `advanceTurn`, so the player's
 * end-turn, an NPC's end-turn and the death-save skip all settle the same way.
 */
import { CombatEncounterService } from './combat-encounter-service.js';
import { CHECK_CONDITION_SOURCE, GRAPPLER_MARKER } from './grapple-source.js';
import { recordDmTacticalFact } from './tactical-action-service.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { combatLogger } from '../../lib/logger.js';
import { getDistance } from '../../tactical/engine.js';
import { ConditionsService } from '../conditions-service.js';

/** A grapple needs the grappler to reach the target; the SRD default reach is 5 feet. */
export const GRAPPLE_REACH_FEET = 5;

const INCAPACITATING = new Set([
  'Incapacitated',
  'Paralyzed',
  'Petrified',
  'Stunned',
  'Unconscious',
]);

type ConditionRow = {
  id: string;
  isActive?: boolean;
  sourceDescription?: string | null;
  condition?: { name?: string } | null;
};
type ParticipantRow = {
  id: string;
  name?: string | null;
  isActive?: boolean;
  status?: { currentHp: number } | null;
  conditions?: ConditionRow[];
};

const activeConditions = (participant: ParticipantRow): ConditionRow[] =>
  (participant.conditions ?? []).filter((entry) => entry.isActive !== false);

const isIncapacitated = (participant: ParticipantRow): boolean =>
  (participant.status?.currentHp ?? 1) <= 0 ||
  activeConditions(participant).some((entry) => INCAPACITATING.has(entry.condition?.name ?? ''));

/**
 * Settle the check-applied conditions as a turn begins.
 *
 * `newRound` is true when this boundary started a new round, which is when time-limited
 * conditions expire. It expires EVERY rounds-type condition in the encounter whose round has
 * come, not only the ones a check wrote.
 */
export async function settleCheckConditionsForTurn(params: {
  encounterId: string;
  sessionId: string;
  startingParticipantId: string;
  roundNumber: number;
  newRound: boolean;
}): Promise<void> {
  const { encounterId, sessionId, startingParticipantId, roundNumber, newRound } = params;
  try {
    if (newRound) await ConditionsService.advanceConditionDurations(encounterId, roundNumber);

    const state = await CombatEncounterService.getCombatState(encounterId);
    const participants = state.participants as unknown as ParticipantRow[];
    const map = await loadActiveTacticalMap(sessionId);
    const nameOf = (participant: ParticipantRow) => participant.name ?? 'The creature';

    for (const participant of participants) {
      if (participant.isActive === false) continue;
      for (const entry of activeConditions(participant)) {
        const source = entry.sourceDescription ?? '';
        if (!source.startsWith(CHECK_CONDITION_SOURCE)) continue;
        const name = entry.condition?.name;

        if (name === 'Prone' && participant.id === startingParticipantId) {
          await ConditionsService.removeCondition(entry.id, encounterId);
          await recordDmTacticalFact(
            sessionId,
            `${nameOf(participant)} spends half its movement to stand up and is no longer prone.`,
          );
        }

        if (name === 'Grappled' && source.startsWith(GRAPPLER_MARKER)) {
          const grappler = participants.find(
            (candidate) => candidate.id === source.slice(GRAPPLER_MARKER.length),
          );
          const grapplerEntity = map?.entities.find((entity) => entity.id === grappler?.id);
          const heldEntity = map?.entities.find((entity) => entity.id === participant.id);
          const reason =
            !grappler || grappler.isActive === false || isIncapacitated(grappler)
              ? 'its grappler is incapacitated'
              : grapplerEntity &&
                  heldEntity &&
                  getDistance(grapplerEntity, heldEntity) > GRAPPLE_REACH_FEET
                ? 'it is out of its grappler’s reach'
                : null;
          if (!reason) continue;
          await ConditionsService.removeCondition(entry.id, encounterId);
          await recordDmTacticalFact(
            sessionId,
            `${nameOf(participant)} is no longer grappled: ${reason}.`,
          );
        }
      }
    }
  } catch (error) {
    // A condition that fails to expire must not stop the fight from advancing.
    combatLogger.warn({
      msg: 'COMBAT_CHECK_CONDITIONS_SETTLE_FAILED',
      encounterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
