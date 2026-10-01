/**
 * The intent route's answer when an action names a target that is not on the board (#2438).
 *
 * `resolveCombatIntentRefs` throws `NotFoundError('Combat participant', token, { role, intentType,
 * roster })`, and `mapIntentError` returns it as `{ error, details }` with status 404. The client
 * test feeds this body to the real executor; the server test posts the same intent through the
 * real route and asserts the body equals it.
 */

/** A creature the player named that is not seated: the DM copies it as a slug. */
export const UNSEATED_TARGET_TOKEN = 'the-sour-knight';

export const unresolvedTargetRefusalBody = (intentType: 'attack' | 'spell', roster: string) => ({
  error: 'Combat participant not found',
  details: {
    resource: 'Combat participant',
    id: UNSEATED_TARGET_TOKEN,
    role: 'target' as const,
    intentType,
    roster,
  },
});
