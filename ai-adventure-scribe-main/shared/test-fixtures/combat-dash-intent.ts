/** Exact More-menu body sent by the Dash action-bar chip through the DM dialect. */
export const DASH_ACTOR_ID = 'dash-pc-1';

export const dashIntentBody = (actorId: string = DASH_ACTOR_ID) => ({
  intent: { type: 'dash' as const, actorId },
  source: 'dm' as const,
  dmStartedAt: 1_700_000_000_000,
  origin: 'typed' as const,
});
