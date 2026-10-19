/**
 * The words that let the DM declare a player's exit from a fight (#749).
 *
 * Free-text movement — "I back away", "I step back", "I edge toward Kaelen", "I retreat a few
 * steps toward the door" — is movement. It must never be read as a flee, a yield, or a
 * disengage: those end or spend the player's part in the encounter, and the player did not say
 * they wanted that. Only an explicit word in the player's own text can authorise the exit.
 */
export type PlayerExitKind = 'flee' | 'yield' | 'disengage';

const EXIT_WORDING: Record<PlayerExitKind, RegExp> = {
  flee: /\b(flee|flees|fleeing|run away|escape|bolt for|make a run for)\b/i,
  yield: /\b(yield|surrender|give up)\b/i,
  disengage: /\bdisengag/i,
};

/** Whether the player's own text explicitly declares the given exit. */
export function playerTextDeclares(kind: PlayerExitKind, text: string): boolean {
  return EXIT_WORDING[kind].test(text);
}

/**
 * Whether the player's own text explicitly says they are leaving: flee, run, leave, or escape.
 *
 * The edge rule (#749) reads this: a Disengaged move that ends on the board's outer ring is only
 * a flee when the player's words named a departure. "I step back" is a move, however close to the
 * door it lands.
 */
const LEAVING_WORDING =
  /\b(flee|flees|fleeing|run|runs|running|leave|leaves|leaving|escape|escapes)\b/i;

/** Whether the player's own text explicitly asks to leave the fight. */
export function playerTextDeclaresLeaving(text: string): boolean {
  return LEAVING_WORDING.test(text);
}
