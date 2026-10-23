/**
 * #975: a Second Wind declared in a combat turn, resolved before the DM
 * narrates.
 *
 * The typed-intent parser never learned the feature, so "I use Second Wind"
 * fell through: no healing, no refusal, no use spent — the DM invented or
 * ignored the outcome. The tray button worked because it posts the
 * `second_wind` combat intent directly; this module gives the typed words
 * the same path: detect the declaration, execute that very intent (which
 * claims the bonus action, spends the tracked use, heals the participant
 * write-through, and records the engine fact the chat line renders from),
 * and return a DM directive carrying the engine's truth — the resolution or
 * the refusal — so the player always hears what happened.
 *
 * Runs pre-generation, like the declared Lay on Hands resolution. A failed
 * run is logged and yields no directive; it never costs the player their
 * turn.
 *
 * @module server/services/dm/combat-second-wind
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { logger } from '../../lib/logger.js';
import { detectDeclaredSecondWind } from '../combat/combat-intent-gate.js';

import type { SecondWindResult } from '../combat/fighter-features-service.js';

/**
 * Detect a typed Second Wind in an active combat encounter and execute it
 * through the combat intent. Returns the DM directive carrying the engine's
 * outcome — the heal, or the refusal (no uses left, already at full health,
 * not the fighter's turn) — or null when the input declares nothing or the
 * resolution cannot run at all (fail open: the DM narrates without engine
 * truth and nothing is spent).
 */
export async function resolveCombatSecondWind(input: {
  playerInput: string;
  sessionId: string;
  userId: string;
}): Promise<string | null> {
  const { playerInput, sessionId, userId } = input;
  if (!detectDeclaredSecondWind(playerInput)) return null;

  try {
    const { CombatEncounterService } = await import('../combat/combat-encounter-service.js');
    const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
    if (!encounter) return null;
    const character = await ownedSessionCharacter(sessionId, userId);
    if (!character) return null;

    const { SECOND_WIND_NAME, FIGHTER_CLASS } = await import(
      '../combat/fighter-features-service.js'
    );
    const { featureSpentSinceMessage } = await import(
      '../progression/paladin-features-service.js'
    );
    const { playerMessage } = await import('./story-spell-slots.js');
    // A Retry replays the same saved player message without saving a new
    // one. A Second Wind usage-log row at or after that message means this
    // message already resolved — the Lay on Hands rule — so the replay
    // resolves nothing again. The lookup must name the Fighter class:
    // featureSpentSinceMessage defaults to the Paladin library, where
    // 'Second Wind' resolves to no row and the guard would never fire.
    const message = await playerMessage(sessionId);
    if (
      await featureSpentSinceMessage({
        characterId: character.id,
        featureName: SECOND_WIND_NAME,
        sessionId,
        since: message?.createdAt ?? null,
        className: FIGHTER_CLASS,
      })
    ) {
      logger.info({ msg: 'COMBAT_SECOND_WIND_ALREADY_SPENT', sessionId });
      return null;
    }

    const state = await CombatEncounterService.getCombatState(encounter.id, userId);
    const playerParticipant = state.participants.find(
      (participant) =>
        participant.characterId === character.id && participant.participantType === 'player',
    );
    if (!playerParticipant) {
      logger.warn({ msg: 'COMBAT_SECOND_WIND_NO_PARTICIPANT', sessionId });
      return null;
    }

    const { executeCombatIntent } = await import('../combat/combat-intent-service.js');
    try {
      const rawResult = await executeCombatIntent(
        encounter.id,
        {
          type: 'second_wind',
          actorId: playerParticipant.id,
          expectedVersion: state.encounter.version,
        },
        userId,
        'player',
        undefined,
        'typed',
        playerInput,
      );
      // executeCombatIntent does not always throw on a non-resolution: an
      // encounter that concluded between the active check above and the
      // intent's own state read RETURNS an { encounterAlreadyConcluded }
      // shape instead. Interpolating that into the directive would print
      // "regained undefined HP" — a fabricated engine truth. Validate the
      // resolution's shape; anything else fails open (no directive).
      const result = rawResult as Partial<SecondWindResult> | null;
      if (
        !result ||
        result.applied !== true ||
        !Number.isFinite(result.healed) ||
        !Number.isFinite(result.newHp) ||
        !Number.isFinite(result.maxHp)
      ) {
        logger.warn({ msg: 'COMBAT_SECOND_WIND_UNEXPECTED_RESULT', sessionId });
        return null;
      }
      return secondWindDirective(
        `The engine has already resolved it: ${character.name || 'The fighter'} used Second Wind and regained ${result.healed} HP (now ${result.newHp}/${result.maxHp}). Do NOT invent a different amount of healing. Narrate the recovery truthfully as part of the turn.`,
      );
    } catch (error) {
      const { BusinessLogicError } = await import('../../lib/errors.js');
      if (error instanceof BusinessLogicError) {
        // A version-skew refusal means the intent was never adjudicated —
        // a concurrent write moved the encounter between the state read
        // and the claim. Nothing was spent; fail open instead of telling
        // the player the feature itself failed.
        if (error.message === 'Combat state changed; refresh and retry') {
          logger.info({ msg: 'COMBAT_SECOND_WIND_VERSION_SKEW', sessionId });
          return null;
        }
        return secondWindDirective(
          `The engine refused it: ${error.message} Narrate the failure clearly. Do NOT narrate any healing from Second Wind this turn.`,
        );
      }
      throw error;
    }
  } catch (error) {
    logger.warn({ msg: 'COMBAT_SECOND_WIND_FAILED', sessionId, error });
    return null;
  }
}

function secondWindDirective(truth: string): string {
  return `<second_wind>The player declared Second Wind. ${truth}</second_wind>`;
}
