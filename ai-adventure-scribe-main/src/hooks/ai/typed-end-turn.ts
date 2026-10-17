/**
 * #784: the typed end-of-turn.
 *
 * The DM model cannot emit `end_turn` — the `combat_actions` vocabulary has no such action type
 * (`server-bun/src/services/combat/combat-intent-service.ts:512`). A typed "I end my turn." that
 * is routed through the DM therefore comes back as a non-action, and the engine answers "that was
 * not a combat action" while the turn stays open. The End turn button posts the intent directly;
 * a message that is nothing else gets the same treatment before the DM is called.
 *
 * Anchored to the whole message: "I pass" ends a turn, "I pass the potion to Mira" does not, and
 * neither does "I wait for the goblin to approach then attack".
 */
const END_TURN_PHRASES = new Set([
  'i end my turn',
  'end my turn',
  'end turn',
  'i pass',
  'pass',
  'i wait',
  'done',
]);

export function isTypedEndTurn(message: string | null | undefined): boolean {
  if (!message) return false;
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:\s]+$/, '');
  return END_TURN_PHRASES.has(normalized);
}
