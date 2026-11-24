export const COMBAT_OBJECT_ACTOR_ID = 'e7e569df-0000-4000-8000-000000000002';
export const COMBAT_OBJECT_STARTED_AT = 1_700_000_000_000;

export const combatObjectIntentBody = (actorId: string, objectName?: string) => ({
  intent: { type: 'use_object', actorId, ...(objectName ? { objectName } : {}) },
  source: 'dm',
  dmStartedAt: COMBAT_OBJECT_STARTED_AT,
  origin: 'typed',
});
