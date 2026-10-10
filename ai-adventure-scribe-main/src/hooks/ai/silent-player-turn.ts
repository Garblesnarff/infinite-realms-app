/**
 * The combat turn the engine had nothing to say about (#2342).
 *
 * Run M8, round 3: the player typed "I try to talk the elemental down". No action was declared
 * and none was refused, so the engine printed no line — and the DM, given no statement about the
 * mechanics, narrated the fight it expected: "Your spell connects… it strikes you hard. You are
 * wounded." No spell was cast, no attack was rolled, hit points never moved. #2312 covers the
 * refusal, where the engine says "not resolved"; this is the same statement for the silence.
 */

/** Same wording family as `refusedActionsNote`: what did not happen, then whose turn it is. */
export const SILENT_PLAYER_TURN_NOTE =
  "The player's action had no mechanical effect this turn. No spell was cast, no attack was " +
  "made, no damage was dealt or taken. Describe the attempt and the creature's reaction " +
  "without any hit, damage, wound or spell. It is still the player's turn.";

/**
 * The same statement scoped to the player's own action, for a pass that also carries engine
 * results (NPC turns resolved in the pre-flight). Those results stand, so the note must not say
 * that no damage was dealt or taken by anyone.
 */
export const SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES =
  "The player's own action had no mechanical effect this turn: the player cast no spell and made " +
  'no attack. Describe the attempt without any hit, damage, wound or spell from the player. The ' +
  "authoritative engine results supplied stand as written. It is still the player's turn.";

/**
 * The narration pass's setup line. The DM's first-pass prose is withheld here for the reason the
 * refusal path withholds its own: it is the one place a hit that never happened can be read back
 * as established fact.
 */
export const SILENT_PLAYER_TURN_SETUP =
  "The player's message declared no combat action, so the engine resolved nothing for it. Narrate " +
  'only the attempt described in the player message and any authoritative results supplied; ' +
  "state that it is still the player's turn.";

/** The fields the narration payload carries for a silent turn. */
export function silentPlayerTurnPayload(
  playerMessage: string,
  hadEngineLines: boolean,
): Record<string, string> {
  return {
    playerAttempt: playerMessage.trim(),
    silentPlayerTurnNote: hadEngineLines
      ? SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES
      : SILENT_PLAYER_TURN_NOTE,
  };
}

export {
  contradictsEngineOutcome,
  fabricatedOutcomeClaims,
  suspectsFabricatedOutcome,
} from '../../../shared/narration-harm';
export type { EngineOutcome } from '../../../shared/narration-harm';
