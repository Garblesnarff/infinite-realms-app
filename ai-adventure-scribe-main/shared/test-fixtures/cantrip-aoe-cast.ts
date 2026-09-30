/**
 * The sheet's Cast for Acid Splash in run M9 (#2374, #2375), on both sides of the wire.
 *
 * The DM declares the cantrip as an area spell and writes `slot_level: 0` (a cantrip has no
 * slot). The client used to forward that as `slotLevel: 0`, and the route's `minimum: 1` refused
 * it with a 422. The client test asserts it now sends `cantripAoECastWireBody`; the server test
 * posts that same body, and the production body below, through the real route.
 */

/** The DM's declaration, as it reaches `executeAoECombatAction`. */
export const dmCantripAoEAction = {
  actor_id: 'the-apprentice',
  action_type: 'cast_spell' as const,
  spell_id: 'acid-splash',
  origin: { x: 1, y: 1 },
  direction: { x: 2, y: 2 },
  slot_level: 0,
};

/** The body that 422'd in production (nginx 422 at 00:58:46Z, `request.error` on body). */
export const productionRefusedCantripBody = {
  phase: 'propose',
  actorId: 'the-apprentice',
  spellId: 'acid-splash',
  origin: { x: 1, y: 1 },
  direction: { x: 2, y: 2 },
  slotLevel: 0,
  actionOrigin: 'sheet_cast',
};

/** What the client sends for the same declaration: a cantrip spends no slot, so `null`. */
export const cantripAoECastWireBody = { ...productionRefusedCantripBody, slotLevel: null };
