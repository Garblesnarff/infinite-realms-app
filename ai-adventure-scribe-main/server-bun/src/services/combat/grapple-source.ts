/**
 * How a grapple written by a mid-combat check is recognised on a participant (#2420). No
 * imports: the NPC runner reads it, and must stay loadable without the database.
 */

/** Written into a condition's `source_description` so the engine can tell its own rows apart. */
export const CHECK_CONDITION_SOURCE = 'combat_check';
export const GRAPPLER_MARKER = `${CHECK_CONDITION_SOURCE}:grappler:`;

/** The source a grapple writes, naming who holds the target. */
export const grappleSource = (grapplerId: string): string => `${GRAPPLER_MARKER}${grapplerId}`;

type ConditionRow = {
  id: string;
  isActive?: boolean;
  sourceDescription?: string | null;
  condition?: { name?: string } | null;
};

/**
 * The grapple a check wrote on this participant: which condition row holds it and who the
 * grappler is. Null when the participant is not grappled by a check.
 */
export function grappleOf(
  participant: unknown,
): { conditionId: string; grapplerId: string } | null {
  for (const entry of (participant as { conditions?: ConditionRow[] }).conditions ?? []) {
    const source = entry.sourceDescription ?? '';
    if (entry.isActive === false || entry.condition?.name !== 'Grappled') continue;
    if (!source.startsWith(GRAPPLER_MARKER)) continue;
    return { conditionId: entry.id, grapplerId: source.slice(GRAPPLER_MARKER.length) };
  }
  return null;
}
