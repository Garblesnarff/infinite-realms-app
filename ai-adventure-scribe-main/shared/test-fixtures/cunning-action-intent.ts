/** #1635: the exact body the client's Cunning Action chip sends through the DM dialect. */
export const CUNNING_ACTOR_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

export const cunningActionIntentBody = (
  mode: 'dash' | 'disengage' | 'hide',
  actorId: string = CUNNING_ACTOR_ID,
) => ({
  intent: { type: 'cunning_action' as const, actorId, mode },
  source: 'dm' as const,
  dmStartedAt: 1_700_000_000_000,
  origin: 'typed' as const,
});
