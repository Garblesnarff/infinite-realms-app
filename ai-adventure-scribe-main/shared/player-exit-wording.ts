/**
 * The words that let the DM declare a player's exit from a fight (#749).
 *
 * Free-text movement — "I back away", "I step back", "I edge toward Kaelen", "I retreat a few
 * steps toward the door" — is movement. It must never be read as a flee, a yield, or a
 * disengage: those end or spend the player's part in the encounter, and the player did not say
 * they wanted that. Only an explicit word in the player's own text can authorise the exit.
 */
export type PlayerExitKind = 'flee' | 'yield' | 'disengage';

/**
 * #1208: the one flee vocabulary. The typed-flee intent parser (`detectDeclaredDefense` in
 * server-bun combat-intent-gate.ts) anchors it to the whole input, so a compound ("I flee and
 * attack") still falls through to the attack parser; the #749 wording gate below reads it
 * unanchored. A sentence the parser takes as a flee can therefore never be refused by the gate.
 * A regex source, not a RegExp: each reader adds its own anchors and flags.
 */
export const FLEE_DECLARATION_SOURCE = 'flee[sd]?|fled|run away|run from the fight';

const EXIT_WORDING: Record<PlayerExitKind, RegExp> = {
  // #1199: "I run from the fight" names the departure as plainly as "I run away" —
  // without it the #749 gate skips the DM-declared flee the directive produces.
  // The extra words are wording-gate only: they authorise a DM-declared flee inside a longer
  // sentence ("I bolt for the door") but are not a typed flee declaration on their own.
  flee: new RegExp(
    `\\b(?:${FLEE_DECLARATION_SOURCE}|fleeing|run for|escape|bolt for|make a run for)\\b`,
    'i',
  ),
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
