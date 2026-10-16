/**
 * #712: a Lay on Hands declared in a combat turn, resolved before the DM narrates.
 *
 * The typed-intent parser never learned the feature, so "I call on my Lay on
 * Hands..." fell through: no healing, no refusal, no pool use. This module
 * detects the declaration, resolves it against the pool through
 * PaladinFeaturesService (healing the participant write-through, so the sheet
 * moves), and returns a DM directive carrying the engine's truth: the DM
 * narrates the outcome instead of inventing or ignoring it.
 *
 * Runs pre-generation, like the declared-defense directive. A failed resolution
 * is logged and yields no directive; it never costs the player their turn.
 *
 * @module server/services/dm/combat-lay-on-hands
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { logger } from '../../lib/logger.js';
import { detectDeclaredLayOnHands } from '../combat/combat-intent-gate.js';

import type { LayOnHandsResult } from '../progression/paladin-features-service.js';

const normalizeName = (value: string): string => value.toLowerCase().trim();

/**
 * Detect a typed Lay on Hands in an active combat encounter and resolve it.
 * Returns the DM directive carrying the engine's outcome, or null when the
 * input declares nothing or the resolution cannot run (fail open: the DM
 * narrates without engine truth and the pool is untouched).
 */
export async function resolveCombatLayOnHands(input: {
  playerInput: string;
  sessionId: string;
  userId: string;
}): Promise<string | null> {
  const { playerInput, sessionId, userId } = input;
  const declared = detectDeclaredLayOnHands(playerInput);
  if (!declared) return null;

  try {
    const { CombatEncounterService } = await import('../combat/combat-encounter-service.js');
    const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
    if (!encounter) return null;
    const character = await ownedSessionCharacter(sessionId, userId);
    if (!character) return null;
    const state = await CombatEncounterService.getCombatState(encounter.id, userId);

    const playerParticipant = state.participants.find(
      (participant) =>
        participant.characterId === character.id && participant.participantType === 'player',
    );
    if (!playerParticipant) {
      logger.warn({ msg: 'COMBAT_LAY_ON_HANDS_NO_PARTICIPANT', sessionId });
      return null;
    }

    let targetParticipant = playerParticipant;
    if (!declared.targetIsSelf) {
      const want = normalizeName(declared.target);
      const matches = state.participants.filter((participant) => {
        const name = normalizeName(participant.name ?? '');
        return name === want || name.includes(want) || want.includes(name);
      });
      if (matches.length !== 1 || !matches[0]) {
        logger.warn({
          msg: 'COMBAT_LAY_ON_HANDS_TARGET_UNRESOLVED',
          sessionId,
          target: declared.target,
          matches: matches.length,
        });
        return null;
      }
      targetParticipant = matches[0];
    }

    const { resolveLayOnHands } = await import(
      '../progression/paladin-features-service.js'
    );
    const result = await resolveLayOnHands({
      characterId: character.id,
      userId,
      amount: declared.amount ?? undefined,
      cure: declared.cure ?? undefined,
      participantId: targetParticipant.id,
      encounterId: encounter.id,
      targetCharacterId: targetParticipant.characterId ?? character.id,
      sessionId,
      context: 'combat-turn',
    });
    return layOnHandsDirective(result);
  } catch (error) {
    logger.warn({ msg: 'COMBAT_LAY_ON_HANDS_FAILED', sessionId, error });
    return null;
  }
}

function layOnHandsDirective(result: LayOnHandsResult): string {
  const truth = result.ok
    ? `The engine has already resolved it: ${result.message} Do NOT invent a different amount of healing. Narrate the healing truthfully as part of the turn.`
    : `The engine refused it: ${result.message} Narrate the failure clearly. Do NOT narrate any healing from Lay on Hands this turn.`;
  return (
    `<lay_on_hands>The player declared Lay on Hands. ` +
    `${truth}</lay_on_hands>`
  );
}
