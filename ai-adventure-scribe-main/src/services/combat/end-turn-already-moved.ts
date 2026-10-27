/**
 * #1169: after a player's flee resolves, the turn has already passed to the next creature
 * (flee claims the turn but not the Action). The client then sends its boundary `end_turn` for
 * the player; the server answers 422 `{ error: 'Actor is not the current-turn participant',
 * details: { currentParticipantId: <the creature now acting>, ... } }`. That refusal is not a
 * failure — the turn already moved — so callers refresh turn state instead of surfacing an
 * error. See `isTurnAlreadyMovedRefusal` and `endTurnUnlessAlreadyMoved`.
 */
import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
} from './combat-action-executor';

export function isTurnAlreadyMovedRefusal(
  error: unknown,
  actorId: string,
): error is CombatIntentRefusedError {
  return (
    error instanceof CombatIntentRefusedError &&
    error.status === 422 &&
    typeof error.details?.currentParticipantId === 'string' &&
    (error.details!.currentParticipantId as string).length > 0 &&
    error.details!.currentParticipantId !== actorId
  );
}

/**
 * Mirrors the server's alreadyEndedTurn answer.
 */
export async function endTurnUnlessAlreadyMoved(
  encounterId: string,
  intent: { type: 'end_turn'; actorId: string; actionId?: string },
  source?: 'player' | 'dm',
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    if (signal) {
      return await executeAuthoritativeCombatIntent(
        encounterId,
        intent,
        source ?? 'player',
        undefined,
        undefined,
        signal,
      );
    }
    if (source) {
      return await executeAuthoritativeCombatIntent(encounterId, intent, source);
    }
    return await executeAuthoritativeCombatIntent(encounterId, intent);
  } catch (error) {
    if (isTurnAlreadyMovedRefusal(error, intent.actorId)) {
      return {
        turnAlreadyEnded: true,
        currentParticipant: { id: error.details!.currentParticipantId as string },
      };
    }
    throw error;
  }
}
