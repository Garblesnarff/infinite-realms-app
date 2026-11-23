export const HELP_REFUSAL = 'Help needs an ally to help; there is none in this fight.';
export const READY_REFUSAL = 'Ready is not supported yet; choose another action.';

export function objectCombatIntent(actorId: string, objectName?: string) {
  const name = objectName?.trim().slice(0, 255);
  return { type: 'use_object' as const, actorId, ...(name ? { objectName: name } : {}) };
}
