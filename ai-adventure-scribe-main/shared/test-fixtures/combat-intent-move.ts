/**
 * Exact Move body the executor sends through the DM dialect (#51,
 * AGENTS.md §4). One shared fixture, the way `combat-dash-intent.ts` holds
 * the Dash body: the client test asserts the executor sends exactly this
 * body, and the server test posts it through the real route — so the wire
 * body the server approves is the one the client actually sends, not a
 * hand-built copy (#2250 approved a mocked body that 422'd live, #2280).
 */
import { DASH_ACTOR_ID } from './combat-dash-intent';

/** The header the executor sends its idempotency key under. */
export const COMBAT_INTENT_REQUEST_ID_HEADER = 'x-request-id';

export const combatIntentMoveBody = (
  actorId: string = DASH_ACTOR_ID,
  x: number,
  y: number,
  dmStartedAt: number = 1_700_000_000_000,
) => ({
  intent: { type: 'move' as const, actorId, x, y },
  source: 'dm' as const,
  dmStartedAt,
  origin: 'typed' as const,
});
