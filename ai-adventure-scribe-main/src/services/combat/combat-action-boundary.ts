import type { ResolvedTargetDamage } from './combat-action-executor';

export type CombatActionBoundary = 'combat_ended' | 'encounter_already_concluded' | null;

export interface StructuredCombatActionExecution {
  outcomes: ResolvedTargetDamage[];
  /** A batch must drop every action after either kind of combat boundary. */
  boundary: CombatActionBoundary;
}

/** Boundary metadata returned by the server without coupling the browser to server types. */
export function combatBoundaryFromResult(
  result: unknown,
): Exclude<CombatActionBoundary, null> | null {
  if (!result || typeof result !== 'object') return null;
  const boundary = result as {
    combatEnded?: unknown;
    encounterAlreadyConcluded?: unknown;
  };
  if (boundary.encounterAlreadyConcluded === true) return 'encounter_already_concluded';
  if (boundary.combatEnded === true) return 'combat_ended';
  return null;
}
