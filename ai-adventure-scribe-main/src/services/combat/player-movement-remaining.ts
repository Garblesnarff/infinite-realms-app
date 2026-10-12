import { getAuthHeaders } from '@/services/auth/TokenService';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';

interface TacticalEntityLike {
  id: string;
  movementRemaining?: number | null;
}

interface TacticalMapLike {
  entities?: TacticalEntityLike[];
}

/**
 * Movement the actor still has on the tactical board, or `null` when the board cannot say
 * (no session, no active map, fetch failed, entity absent).
 *
 * `null` means "unknown": callers keep the pre-#263 behavior rather than stranding a turn
 * open on a failed fetch. A resolved attack ends the player's turn only when they have
 * nothing left to do, and a level 1 Fighter who just swung still has movement (#263 CB-011).
 */
export async function actorMovementRemaining(
  sessionId: string | undefined,
  actorId: string,
): Promise<number | null> {
  if (!sessionId) return null;
  try {
    const response = await fetch(
      `${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map`,
      { headers: getAuthHeaders({ includeEmptyToken: true }) },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { map?: TacticalMapLike | null } | null;
    const map: TacticalMapLike | null =
      payload && typeof payload === 'object' ? (payload.map ?? null) : null;
    const entity = map?.entities?.find((candidate) => candidate.id === actorId);
    return typeof entity?.movementRemaining === 'number' ? entity.movementRemaining : null;
  } catch {
    return null;
  }
}
