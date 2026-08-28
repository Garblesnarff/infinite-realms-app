import { BusinessLogicError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

import type { SessionEntityIndex } from './session-entity-index.js';
import type { CombatState } from '../../types/combat.js';

/**
 * The shared turn gate for player and companion intents.
 *
 * An unknown participant id is a 404; a known participant acting before the
 * current participant is a 422. Keeping that distinction at the gateway is
 * what lets a companion use the same intent endpoint as a human player.
 */
export function assertActorTurn(state: CombatState, actorId: string, index: SessionEntityIndex) {
  const current = state.currentParticipant;
  const known = state.participants.some((participant) => participant.id === actorId);
  const currentContext = {
    encounterId: state.encounter.id,
    sessionId: state.encounter.sessionId,
    actorId,
    currentParticipantId: current?.id ?? null,
    currentParticipantSlug: index.slugFor(current?.id) ?? null,
  };
  if (!known) {
    logger.warn({ msg: 'COMBAT_INTENT_UNKNOWN_ACTOR', ...currentContext, roster: index.roster() });
    throw new NotFoundError('Combat participant', actorId);
  }
  if (!current || current.id !== actorId) {
    logger.warn({ msg: 'COMBAT_INTENT_OUT_OF_TURN', ...currentContext });
    throw new BusinessLogicError('Actor is not the current-turn participant', {
      ...currentContext,
      roster: index.roster(),
    });
  }
  return { actor: current, encounter: state.encounter };
}
