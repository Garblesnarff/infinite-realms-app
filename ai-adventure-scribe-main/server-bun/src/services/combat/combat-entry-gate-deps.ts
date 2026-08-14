/**
 * Production wiring for the combat entry gate.
 *
 * Kept apart from `combat-entry-gate.ts` so the decision logic can be unit-tested without
 * dragging in the database, the tactical generator, or the websocket publisher.
 */
import { CombatEncounterService } from './combat-encounter-service.js';
import { trackCombatEvent } from './combat-events.js';
import { publishCombatState } from './combat-sync-service.js';
import { sanitizeSceneSpec } from './scene-spec-sanitizer.js';
import { createTacticalCombatMap } from './tactical-combat-lifecycle.js';
import { combatLogger } from '../../lib/logger.js';
import { verifySessionOwnership } from '../../routes/v1/combat/helpers.js';

import type { CombatEntryGateDeps } from './combat-entry-gate.js';
import type { EntitySize, SceneSpec } from '../../tactical/types.js';
import type { CreateParticipantInput } from '../../types/combat.js';

export const combatEntryGateDeps: CombatEntryGateDeps = {
  getActiveEncounter: (sessionId, userId) =>
    CombatEncounterService.getActiveEncounter(sessionId, userId),
  verifySessionOwnership: (sessionId, userId) => verifySessionOwnership(sessionId, userId),
  startCombat: (sessionId, participants, surpriseRound, userId) =>
    CombatEncounterService.startCombat(
      sessionId,
      participants as CreateParticipantInput[],
      surpriseRound,
      userId,
    ),
  createTacticalCombatMap: (sessionId, participants, sceneSpec, participantSizes) =>
    createTacticalCombatMap(
      sessionId,
      participants as Parameters<typeof createTacticalCombatMap>[1],
      sceneSpec as SceneSpec,
      (participantSizes ?? {}) as Record<string, EntitySize>,
    ),
  sanitizeSceneSpec,
  trackCombatEvent: (event, properties) =>
    trackCombatEvent(event as Parameters<typeof trackCombatEvent>[0], properties),
  publishCombatState,
  logger: combatLogger,
};
