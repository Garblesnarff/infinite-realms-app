/** Exact More-menu body sent by the Dash action-bar chip through the DM dialect. */
export const DASH_ACTOR_ID = '11111111-2222-4333-8444-555555555555';

export const dashIntentBody = (actorId: string = DASH_ACTOR_ID) => ({
  intent: { type: 'dash' as const, actorId },
  source: 'dm' as const,
  dmStartedAt: 1_700_000_000_000,
  origin: 'typed' as const,
});
