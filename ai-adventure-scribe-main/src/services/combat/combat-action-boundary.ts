import type { ResolvedTargetDamage } from './combat-action-executor';

export type CombatActionBoundary = 'combat_ended' | 'encounter_already_concluded' | null;

export interface StructuredCombatActionExecution {
  outcomes: ResolvedTargetDamage[];
  /** The unabridged server result, retained for transcript and resolution-prompt reporting. */
  result?: unknown;
  /** A batch must drop every action after either kind of combat boundary. */
  boundary: CombatActionBoundary;
  /** A DM-declared player exit the player's own words did not support; nothing was sent (#749). */
  skipped?: boolean;
}

/**
 * #570: the server persisted the acting player's own engine row for this result —
 * the shape it returns when the action ended the fight, so the Victory notice could
 * be posted behind the blow. The row already carries the action lines and the end
 * line, so a caller that also printed its own copy would show the blow twice.
 */
export function resultCarriesPersistedPlayerRow(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const rows = (result as { engineRows?: unknown }).engineRows;
  return (
    Array.isArray(rows) &&
    rows.some(
      (row) =>
        Boolean(row) &&
        typeof row === 'object' &&
        (row as { kind?: unknown }).kind === 'player',
    )
  );
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
